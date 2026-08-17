const assert = require('assert/strict');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const {createNomiRunningHubH3, readImageWorkflowCatalog, targetFor, dualSampleTargetFor, normalizeProviderUsage} = require('./bridge/niannian_nomi_runninghub_h3');
const {validateH3MediaMetadata} = require('./bridge/niannian_h3_media_validation');

function image(index) { return {id:`CAS-${String(index).padStart(24, '0')}`,storedPath:`C:/test/${index}.png`,mimeType:'image/png',originalName:`${index}.png`}; }

async function run() {
  const catalog = {
    1:{workflowId:'2085388519102570497',endpointPath:'/openapi/v2/run/workflow/2085388519102570497',imageNodes:['4'],targetNode:'6',promptNode:'7'},
    5:{workflowId:'2085000000000000001',endpointPath:'/openapi/v2/run/ai-app/2085000000000000001',imageNodes:['4','19','20','21','23'],targetNode:'6',promptNode:'7'}
  };
  const h3 = createNomiRunningHubH3({imageWorkflows:catalog});
  assert.equal(createNomiRunningHubH3().dryRun({mode:'first_last',prompt:'首尾帧通道',images:[image(1),image(2)],audio:[],videos:[]}).workflowId, '2084070256573767682');
  assert.equal(h3.dryRun({mode:'t2v',prompt:'雨夜街头，一人缓慢回头',images:[],audio:[],videos:[]}).mode, 't2v');
  const firstLast = h3.dryRun({mode:'first_last',prompt:'人物缓慢回头',images:[image(1),image(2)],audio:[],videos:[]});
  assert.equal(firstLast.mode, 'first_last');
  assert.equal(firstLast.workflowId, '2084070256573767682');
  assert.deepEqual(firstLast.nodeInfoList.filter(item => item.fieldName === 'image').map(item => item.nodeId), ['6','4']);
  const dualSample = h3.dryRun({mode:'dual_sample',prompt:'参考图中的人物回头，镜头缓慢推进',aspectRatio:'16:9',durationSeconds:7,images:[image(1)],audio:[],videos:[]});
  assert.equal(dualSample.workflowId, '2089232623242670081');
  assert.deepEqual(dualSample.target, {aspectRatio:'16:9',durationSeconds:7,width:null,height:null,exactDimensions:false,resolution:'2k'});
  assert.deepEqual(dualSample.nodeInfoList, [
    {nodeId:'137',fieldName:'image',fieldValue:'DRY_RUN_IMAGE_1'},
    {nodeId:'138',fieldName:'value',fieldValue:'参考图中的人物回头，镜头缓慢推进'},
    {nodeId:'132',fieldName:'value',fieldValue:7},
    {nodeId:'115',fieldName:'aspect_ratio',fieldValue:'16:9 (Widescreen)'},
    {nodeId:'214',fieldName:'aspect_ratio',fieldValue:'16:9 (Widescreen)'}
  ]);
  assert.throws(() => h3.dryRun({mode:'dual_sample',prompt:'x',aspectRatio:'9:16',images:[image(1)],audio:[],videos:[]}), error => error?.code === 'NOMI_H3_DUAL_SAMPLE_ASPECT_RATIO_UNVERIFIED');
  assert.throws(() => h3.dryRun({mode:'dual_sample',prompt:'x',durationSeconds:4,images:[image(1)],audio:[],videos:[]}), error => error?.code === 'NOMI_H3_DUAL_SAMPLE_DURATION_OUT_OF_RANGE');
  const omni = h3.dryRun({mode:'omni_reference',prompt:'人物与道具连续表演',images:Array.from({length:9}, (_, index) => image(index + 1)),audio:[1,2,3],videos:[1,2,3]});
  assert.equal(omni.mode, 'omni_reference');
  assert.throws(() => h3.dryRun({mode:'first_last',prompt:'x',images:[image(1)],audio:[],videos:[]}), error => error?.code === 'NOMI_H3_MODE_REFERENCE_MISMATCH');
  assert.throws(() => h3.dryRun({prompt:'x',images:[image(1)],audio:[],videos:[]}), error => error?.code === 'NOMI_H3_FIRST_LAST_MODE_REQUIRED');
  assert.throws(() => h3.dryRun({mode:'omni_reference',prompt:'x',images:Array.from({length:9}, (_, index) => image(index + 1)),audio:[],videos:[]}), error => error?.code === 'NOMI_H3_MODE_REFERENCE_MISMATCH');
  const draft = h3.dryRun({prompt:'五张资产图共同锁定人物、场景和道具',aspectRatio:'9:16',durationSeconds:10,images:[1,2,3,4,5].map(image),audio:[],videos:[]});
  assert.equal(draft.mode, 'image-5');
  assert.equal(draft.workflowId, catalog[5].workflowId);
  assert.deepEqual(draft.nodeInfoList.filter(item => item.fieldName === 'image').map(item => item.nodeId), catalog[5].imageNodes);
  assert.equal(draft.endpointPath, catalog[5].endpointPath);
  assert.deepEqual(draft.target, {aspectRatio:'9:16',durationSeconds:10,width:480,height:832});
  assert.throws(() => h3.dryRun({prompt:'x',images:[1,2,3,4].map(image),audio:[],videos:[]}), error => error?.code === 'NOMI_H3_IMAGE_WORKFLOW_UNPUBLISHED');
  assert.throws(() => h3.dryRun({prompt:'x',images:Array.from({length:10}, (_, index) => image(index)),audio:[],videos:[]}), error => error?.code === 'NOMI_H3_IMAGE_REFERENCE_LIMIT');
  assert.throws(() => readImageWorkflowCatalog({5:{workflowId:'2085000000000000001',imageNodes:['4','19','20','21','23'],targetNode:'6',promptNode:'7'}}), error => error?.code === 'NOMI_H3_IMAGE_WORKFLOW_CONFIG_INVALID');
  assert.deepEqual(Object.keys(readImageWorkflowCatalog(catalog)), ['1','5']);
  assert.deepEqual(targetFor({aspectRatio:'16:9',durationSeconds:5}), {aspectRatio:'16:9',durationSeconds:5,width:832,height:480});
  const dualFiveSecondTarget = dualSampleTargetFor({durationSeconds:5});
  assert.deepEqual(dualFiveSecondTarget, {aspectRatio:'16:9',durationSeconds:5,width:null,height:null,exactDimensions:false,resolution:'2k'});
  assert.deepEqual(targetFor({aspectRatio:'9:16',durationSeconds:5,images:[image(1)]}), {aspectRatio:'9:16',durationSeconds:5,width:480,height:832});
  assert.deepEqual(targetFor({aspectRatio:'9:16',durationSeconds:5,width:480,height:832,images:[image(1)]}), {aspectRatio:'9:16',durationSeconds:5,width:480,height:832});
  assert.deepEqual(targetFor({aspectRatio:'9:16',durationSeconds:5,images:[image(1),image(2)]}), {aspectRatio:'9:16',durationSeconds:5,width:480,height:832});
  assert.throws(() => targetFor({aspectRatio:'9:16',width:832,height:480}), error => error?.code === 'NOMI_H3_TARGET_DIMENSION_MISMATCH');
  assert.throws(() => targetFor({durationSeconds:3}), error => error?.code === 'NOMI_H3_DURATION_OUT_OF_RANGE');
  assert.deepEqual(normalizeProviderUsage({consumeCoins:12,consumeMoney:0}), {consumeCoins:12,consumeMoney:0});
  assert.deepEqual(normalizeProviderUsage({consumeCoins:null,consumeMoney:'1.01'}), {consumeCoins:null,consumeMoney:1.01});
  assert.equal(validateH3MediaMetadata({width:480,height:832,durationSeconds:10.125}, draft.target).width, 480);
  assert.equal(validateH3MediaMetadata({width:1920,height:1088,durationSeconds:5.167}, dualFiveSecondTarget).width, 1920);
  assert.throws(() => validateH3MediaMetadata({width:832,height:480,durationSeconds:10}, draft.target), error => error?.code === 'H3_TARGET_DIMENSION_MISMATCH');
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nomi-h3-contract-'));
  try {
    const assets = await Promise.all([1,2,3,4,5].map(async index => {
      const storedPath = path.join(tempRoot, `${index}.png`);
      await fs.writeFile(storedPath, `image-${index}`);
      return {...image(index),storedPath};
    }));
    let uploads = 0;
    let submittedPayload = null;
    const submitted = createNomiRunningHubH3({apiKey:'consumer-test-key',imageWorkflows:catalog,fetchImpl:async (url, init) => {
      if (String(url).endsWith('/openapi/v2/media/upload/binary')) return {ok:true,json:async () => ({data:{fileName:`uploaded-${++uploads}.png`}})};
      if (String(url).endsWith(catalog[5].endpointPath)) {
        submittedPayload = JSON.parse(init.body);
        return {ok:true,json:async () => ({data:{taskId:'consumer-task-5'}})};
      }
      throw new Error(`unexpected request ${url}`);
    }});
    const receipt = await submitted.submit({prompt:'五张图顺序测试',aspectRatio:'9:16',durationSeconds:10,images:assets,audio:[],videos:[]});
    assert.equal(receipt.taskId, 'consumer-task-5');
    assert.equal(uploads, 5);
    assert.equal(submittedPayload.instanceType, 'ultra');
    assert.deepEqual(submittedPayload.nodeInfoList.filter(item => item.fieldName === 'image').map(item => [item.nodeId,item.fieldValue]), [['4','uploaded-1.png'],['19','uploaded-2.png'],['20','uploaded-3.png'],['21','uploaded-4.png'],['23','uploaded-5.png']]);
  } finally {
    await fs.rm(tempRoot, {recursive:true,force:true});
  }
  let dualSubmittedPayload = null;
  const dualAssetRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nomi-h3-dual-sample-'));
  try {
    const dualStoredPath = path.join(dualAssetRoot, 'reference.png');
    await fs.writeFile(dualStoredPath, 'reference-image');
    const dualSubmitted = createNomiRunningHubH3({apiKey:'consumer-test-key',fetchImpl:async (url, init) => {
      if (String(url).endsWith('/openapi/v2/media/upload/binary')) return {ok:true,json:async () => ({data:{fileName:'dual-reference.png'}})};
      if (String(url).endsWith('/openapi/v2/run/workflow/2089232623242670081')) {
        dualSubmittedPayload = JSON.parse(init.body);
        return {ok:true,json:async () => ({data:{taskId:'consumer-dual-sample'}})};
      }
      throw new Error(`unexpected request ${url}`);
    }});
    const receipt = await dualSubmitted.submit({mode:'dual_sample',prompt:'双采节点顺序测试',durationSeconds:7,images:[{...image(1),storedPath:dualStoredPath}],audio:[],videos:[]});
    assert.equal(receipt.taskId, 'consumer-dual-sample');
    assert.deepEqual(dualSubmittedPayload.nodeInfoList.map(item => [item.nodeId,item.fieldName,item.fieldValue]), [
      ['137','image','dual-reference.png'],['138','value','双采节点顺序测试'],['132','value',7],['115','aspect_ratio','16:9 (Widescreen)'],['214','aspect_ratio','16:9 (Widescreen)']
    ]);
  } finally {
    await fs.rm(dualAssetRoot, {recursive:true,force:true});
  }
  const rejected = createNomiRunningHubH3({apiKey:'consumer-test-key',fetchImpl:async () => ({ok:true,json:async () => ({code:'WORKFLOW_DENIED',errorMessage:'private provider detail must not escape'})})});
  await assert.rejects(() => rejected.submit({prompt:'结构化拒绝测试',images:[],audio:[],videos:[]}), error => error?.code === 'RUNNINGHUB_PROVIDER_REJECTED' && error?.providerCode === 'WORKFLOW_DENIED' && !String(error?.message).includes('private'));
  const originalConsumerKey = process.env.NIANNIAN_RUNNINGHUB_H3_CONSUMER_API_KEY;
  const originalLegacyH3Key = process.env.NOMI_RUNNINGHUB_H3_API_KEY;
  const originalGenericKey = process.env.RUNNINGHUB_API_KEY;
  try {
    delete process.env.NIANNIAN_RUNNINGHUB_H3_CONSUMER_API_KEY;
    process.env.NOMI_RUNNINGHUB_H3_API_KEY = 'legacy-enterprise-key-must-not-be-used';
    process.env.RUNNINGHUB_API_KEY = 'enterprise-key-must-not-be-used';
    let requestMade = false;
    const isolated = createNomiRunningHubH3({fetchImpl:async () => { requestMade = true; throw new Error('request must not be made'); }});
    await assert.rejects(() => isolated.submit({prompt:'消费级凭据隔离测试',images:[],audio:[],videos:[]}), error => error?.code === 'RUNNINGHUB_CREDENTIAL_NOT_CONFIGURED');
    assert.equal(requestMade, false);
  } finally {
    if (originalConsumerKey === undefined) delete process.env.NIANNIAN_RUNNINGHUB_H3_CONSUMER_API_KEY;
    else process.env.NIANNIAN_RUNNINGHUB_H3_CONSUMER_API_KEY = originalConsumerKey;
    if (originalLegacyH3Key === undefined) delete process.env.NOMI_RUNNINGHUB_H3_API_KEY;
    else process.env.NOMI_RUNNINGHUB_H3_API_KEY = originalLegacyH3Key;
    if (originalGenericKey === undefined) delete process.env.RUNNINGHUB_API_KEY;
    else process.env.RUNNINGHUB_API_KEY = originalGenericKey;
  }
  console.log('NOMI_H3_MULTI_REFERENCE_CONTRACT_OK');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
