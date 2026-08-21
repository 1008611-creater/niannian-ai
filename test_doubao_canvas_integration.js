'use strict';
/**
 * doubao 画布接入模块级集成测试
 * 覆盖：provider_config → video_channels → skill_nodes → doubao_runtime（真实调 FastAPI 9191）
 */
process.env.NIANNIAN_CANVAS_DOUBAO_SUBMIT = 'on';
process.env.NIANNIAN_DOUBAO_API_URL = 'http://127.0.0.1:9191';

const assert = require('node:assert');
const providerConfig = require('./bridge/niannian_canvas_provider_config');
const videoChannels = require('./bridge/niannian_canvas_video_channels');
const skillNodes = require('./bridge/niannian_canvas_skill_nodes');
const {createCanvasDoubaoRuntime} = require('./bridge/niannian_canvas_doubao_runtime');

let pass = 0;
function ok(label, cond, extra) {
  if (!cond) throw new Error('FAIL: ' + label + (extra ? ' ' + JSON.stringify(extra) : ''));
  pass += 1;
  console.log('  ✓', label);
}

(async () => {
  console.log('== 1. provider_config ==');
  const status = providerConfig.publicCanvasProviderStatus();
  ok('doubaoSubmitEnabled', status.doubaoSubmitEnabled === true, status);
  const catalog = providerConfig.publicCanvasModelCatalog();
  const doubaoModel = catalog.models.find(m => m.id === 'doubao-seedance-2-0-fast');
  ok('catalog 含 doubao 模型', !!doubaoModel, doubaoModel);
  ok('doubao 模型 enabled', doubaoModel.enabled === true);
  ok('doubao 模型 priceCredits=3', doubaoModel.priceCredits === 3);
  ok('doubao 模型 providerLabel=豆包', doubaoModel.providerLabel === '豆包');

  console.log('== 2. video_channels ==');
  ok('isDoubaoVideoChannel(doubao-seedance-2-0-fast)', videoChannels.isDoubaoVideoChannel('doubao-seedance-2-0-fast'));
  ok('isDoubaoVideoChannel(doubao)', videoChannels.isDoubaoVideoChannel('doubao'));
  ok('isDoubaoVideoChannel(seedance-2-0-fast)', videoChannels.isDoubaoVideoChannel('seedance-2-0-fast'));
  ok('isDoubaoVideoChannel 不误判 h3', !videoChannels.isDoubaoVideoChannel('h3'));
  ok('isDoubaoVideoChannel 不误判 dola', !videoChannels.isDoubaoVideoChannel('dola-seedance-2-5'));
  ok('resolveVideoChannel(doubao).model', videoChannels.resolveVideoChannel('doubao').model === 'doubao-seedance-2-0-fast');

  console.log('== 3. skill_nodes ==');
  const node = skillNodes.normalizeSkillNode(
    {nodeId: 'n-vid-01', type: 'video', data: {videoChannel: 'doubao-seedance-2-0-fast', prompt: '测试'}},
    {projectId: 'p1'}
  );
  ok('skillKey=doubao-seedance-2-0-fast', node.skillKey === 'doubao-seedance-2-0-fast', node.skillKey);
  ok('skill 已注册', !!skillNodes.SKILLS['doubao-seedance-2-0-fast']);
  ok('skill kinds 含 video', skillNodes.SKILLS['doubao-seedance-2-0-fast'].kinds.includes('video'));
  const h3node = skillNodes.normalizeSkillNode(
    {nodeId: 'n-vid-02', type: 'video', data: {videoChannel: 'h3', prompt: '测试'}},
    {projectId: 'p1'}
  );
  ok('h3 不受影响', h3node.skillKey === 'minimaxh3skill', h3node.skillKey);

  console.log('== 4. doubao_runtime（真实调 FastAPI 9191）==');
  const jobState = {};
  const rt = createCanvasDoubaoRuntime({
    enabled: true,
    baseUrl: 'http://127.0.0.1:9191',
    jobService: {
      getOwned: async () => jobState,
      updateOwned: async (o, p, j, d) => Object.assign(jobState, d)
    },
    assetService: {
      registerBuffer: async (x) => ({asset: {id: 'asset-mock-' + x.originalName}, stored: x})
    }
  });
  Object.assign(jobState, {
    id: 'job-doubao-test-001', ownerId: 'u1', projectId: 'p1', projectKind: 'canvas',
    nodeType: 'video', videoChannel: 'doubao-seedance-2-0-fast',
    prompt: '一只橘猫在夕阳下的屋顶上伸懒腰', aspectRatio: '9:16',
    status: 'awaiting_authorization'
  });
  const dry = await rt.dryRun(jobState);
  ok('dryRun 返回 channel', dry.channel === 'doubao-seedance-2-0-fast', dry);
  ok('dryRun duration=15', dry.durationSeconds === 15);
  const submitted = await rt.submit('u1', 'p1', 'job-doubao-test-001');
  ok('submit 成功 providerTaskId', !!submitted.providerTaskId, submitted);
  ok('submit 状态 queued/accepted', jobState.providerSubmitState === 'accepted', jobState);

  console.log('== 5. reconcile（轮询等 FastAPI 任务完成）==');
  const deadline = Date.now() + 360000; // 最多 6 分钟
  let finalState = null;
  while (Date.now() < deadline) {
    const cur = await rt.reconcile('u1', 'p1', 'job-doubao-test-001');
    finalState = cur;
    console.log(`  · ${new Date().toLocaleTimeString()} providerSubmitState: ${jobState.providerSubmitState} | status: ${jobState.status}`);
    if (jobState.status === 'succeeded' || jobState.status === 'failed' || jobState.status === 'review') break;
    await new Promise(r => setTimeout(r, 10000));
  }
  if (jobState.status === 'succeeded') {
    ok('reconcile 完成并注册资产', jobState.outputAssetIds && jobState.outputAssetIds.length > 0);
    ok('reconcile 有 providerMedia', !!jobState.providerMedia);
    console.log('  · 资产:', JSON.stringify(jobState.outputAssetIds), '| 视频:', JSON.stringify(jobState.providerMedia).slice(0, 200));
  } else {
    throw new Error('任务未成功完成: ' + jobState.status + ' | ' + JSON.stringify(jobState).slice(0, 300));
  }

  console.log(`\n全部通过: ${pass} 项`);
})().catch((e) => {
  console.error('\n测试失败:', e.message);
  process.exit(1);
});
