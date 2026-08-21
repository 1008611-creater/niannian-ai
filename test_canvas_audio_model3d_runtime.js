'use strict';

const assert = require('assert/strict');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const {createCanvasAssetService} = require('./bridge/niannian_canvas_assets');
const {createCanvasGenerationJobService} = require('./bridge/niannian_canvas_generation_jobs');
const {createCanvasAudioRuntime} = require('./bridge/niannian_canvas_audio_runtime');
const {createMiniMaxT2AAdapter} = require('./bridge/niannian_minimax_t2a_adapter');
const {createHunyuan3DAdapter} = require('./bridge/niannian_hunyuan3d_adapter');
const {createCanvasModel3DRuntime} = require('./bridge/niannian_canvas_model3d_runtime');

async function run() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'niannian-canvas-audio-model3d-'));
  try {
    const assets = createCanvasAssetService({indexPath:path.join(root,'assets.json'),storageRoot:path.join(root,'assets')});
    const jobs = createCanvasGenerationJobService({filePath:path.join(root,'jobs.json')});

    // ---- audio node: MiniMax T2A synchronous path ----
    const audioAdapter = createMiniMaxT2AAdapter({
      apiKey:'test-key', groupId:'test-group', submitEnabled:true, model:'speech-02', voiceId:'female-tianmei',
      fetchImpl:async (url, options) => {
        assert.match(url, /\/v1\/text_to_speech\?GroupId=test-group/);
        assert.equal(options.headers.Authorization, 'Bearer test-key');
        const body = JSON.parse(options.body);
        assert.equal(body.text, '你好世界');
        assert.equal(body.model, 'speech-02');
        return {ok:true, status:200, headers:new Map([['content-type','audio/mpeg']]), arrayBuffer:async () => Buffer.from('ID3fakeaudiobytes').buffer};
      }
    });
    const audioRuntime = createCanvasAudioRuntime({jobService:jobs,assetService:assets,enabled:true,adapter:audioAdapter});
    const a1 = await jobs.create({ownerId:'U',projectId:'P',projectKind:'redraw',nodeId:'a-node',nodeType:'audio',model:'minimax-t2a',prompt:'你好世界',idempotencyKey:'audio-runtime-0001'});
    assert.equal(a1.job.nodeType, 'audio');
    assert.equal((await audioRuntime.dryRun(a1.job)).channel, 'minimax-t2a');
    const submitted = await audioRuntime.submit('U','P',a1.job.id);
    assert.equal(submitted.status, 'succeeded', 'T2A 同步生成应直接成功');
    assert.equal(submitted.outputAssetIds.length, 1, '音频资产已回库');
    assert.match(submitted.providerTaskId, /^local-/);
    const asset = await assets.getOwned('U','P',submitted.outputAssetIds[0]);
    assert.equal(asset.kind, 'generated_audio');
    assert.equal(asset.format, 'mp3');
    console.log('PASS: audio 节点同步生成 + 回库');

    // audio 失败路径：网络不确定 -> review
    const audioRuntimeFail = createCanvasAudioRuntime({jobService:jobs,assetService:assets,enabled:true,adapter:createMiniMaxT2AAdapter({
      apiKey:'k', groupId:'g', submitEnabled:true,
      fetchImpl:async () => { throw new Error('boom'); }
    })});
    const a2 = await jobs.create({ownerId:'U',projectId:'P',projectKind:'redraw',nodeId:'a-node2',nodeType:'audio',model:'minimax-t2a',prompt:'测试',idempotencyKey:'audio-runtime-0002'});
    await assert.rejects(() => audioRuntimeFail.submit('U','P',a2.job.id), error => error.code === 'MINIMAX_T2A_NETWORK_UNCERTAIN');
    const a2after = await jobs.getOwned('U','P',a2.job.id);
    assert.equal(a2after.status, 'review', '网络不确定进入 review');
    console.log('PASS: audio 网络不确定 -> review');

    // ---- model3d node: Hunyuan3D async path ----
    let submitCount = 0;
    let queryCount = 0;
    const model3dAdapter = createHunyuan3DAdapter({
      apiKey:'sk-test', submitEnabled:true, model:'3.0',
      fetchImpl:async (url, options) => {
        if (url.includes('cdn.invalid')) {
          return {ok:true, status:200, headers:new Map([['content-type','model/gltf-binary']]), arrayBuffer:async () => Buffer.from('glb-bytes').buffer};
        }
        if (url.endsWith('/v1/ai3d/submit')) {
          assert.equal(options.headers.Authorization, 'sk-test');
          submitCount += 1;
          return {ok:true, status:200, json:async () => ({JobId:'job-3d-001'})};
        }
        if (url.endsWith('/v1/ai3d/query')) {
          queryCount += 1;
          if (queryCount === 1) return {ok:true, status:200, json:async () => ({Status:'RUN'})};
          return {ok:true, status:200, json:async () => ({Status:'DONE', ResultFile3Ds:[{Url:'https://cdn.invalid/m.glb'}]})};
        }
        throw new Error('unexpected url ' + url);
      }
    });
    const model3dRuntime = createCanvasModel3DRuntime({jobService:jobs,assetService:assets,enabled:true,adapter:model3dAdapter});
    const m1 = await jobs.create({ownerId:'U',projectId:'P',projectKind:'redraw',nodeId:'m-node',nodeType:'model3d',model:'hunyuan3d',prompt:'一只小狗',idempotencyKey:'model3d-runtime-0001'});
    assert.equal(m1.job.nodeType, 'model3d');
    assert.equal((await model3dRuntime.dryRun(m1.job)).channel, 'hunyuan3d');
    const msub = await model3dRuntime.submit('U','P',m1.job.id);
    assert.equal(msub.status, 'queued');
    assert.equal(msub.providerTaskId, 'job-3d-001');
    const mr1 = await model3dRuntime.reconcile('U','P',m1.job.id);
    assert.equal(mr1.status, 'running', '首次查询 RUN -> running');
    const mr2 = await model3dRuntime.reconcile('U','P',m1.job.id);
    assert.equal(mr2.status, 'succeeded', '二次查询 DONE -> succeeded');
    assert.equal(mr2.outputAssetIds.length, 1, '3D 资产回库');
    const mAsset = await assets.getOwned('U','P',mr2.outputAssetIds[0]);
    assert.equal(mAsset.kind, 'generated_model3d');
    assert.equal(mAsset.format, 'glb');
    console.log('PASS: model3d 节点异步生成 + 回库');

    console.log('CANVAS_AUDIO_MODEL3D_RUNTIME_CONTRACT_OK');
  } finally {
    await fsp.rm(root,{recursive:true,force:true});
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
