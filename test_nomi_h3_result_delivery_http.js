const assert = require('assert/strict');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const {spawn} = require('child_process');
const sharp = require('sharp');

const root = __dirname;
const appPort = 21100 + Math.floor(Math.random() * 300);
const providerPort = 21500 + Math.floor(Math.random() * 300);
const appUrl = `http://127.0.0.1:${appPort}`;
const providerUrl = `http://127.0.0.1:${providerPort}`;
const dataRoot = path.join(os.tmpdir(), `niannian-nomi-h3-delivery-${process.pid}-${Date.now()}`);
const mp4 = Buffer.alloc(128);
mp4.writeUInt32BE(32, 0);
mp4.write('ftyp', 4, 'ascii');
mp4.write('isom', 8, 'ascii');
let app;
let provider;
let output = '';
let runCalls = 0;
let queryCalls = 0;
let videoReads = 0;
const providerTasks = new Map();
const workflowPaths = [];

function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function headers(token, extra = {}) { return {cookie:`niannian_session=${token}`,accept:'application/json',...extra}; }
function h3Document(ownerId) {
  return {ownerId,projectId:'NN-H3-DELIVERY-A',projectKind:'redraw',revision:1,updatedAt:new Date().toISOString(),document:{
    workbenchDocument:{contentJson:{type:'doc',content:[]}},timeline:{tracks:[]},
    generationCanvas:{nodes:[
      {id:'h3-node',kind:'video',title:'H3 文生视频',position:{x:0,y:0},prompt:'雨夜城市街头',meta:{modelKey:'niannian/minimax-h3',archetype:{id:'minimax-h3',modeId:'t2v'}}},
      {id:'h3-i2v-node',kind:'video',title:'H3 图生视频',position:{x:0,y:0},prompt:'人物缓慢回头',meta:{modelKey:'niannian/minimax-h3',archetype:{id:'minimax-h3',modeId:'i2v'}}},
      {id:'h3-omni-node',kind:'video',title:'H3 全能参考',position:{x:0,y:0},prompt:'人物与道具连续表演',meta:{modelKey:'niannian/minimax-h3',archetype:{id:'minimax-h3',modeId:'omni_reference'}}}
    ],edges:[]}
  }};
}

async function seed() {
  await fsp.mkdir(dataRoot, {recursive:true});
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const userA = {id:'USR-H3-A',email:'h3-a@example.test',status:'active'};
  const userB = {id:'USR-H3-B',email:'h3-b@example.test',status:'active'};
  await Promise.all([
    fsp.writeFile(path.join(dataRoot, 'users.json'), JSON.stringify([userA,userB])),
    fsp.writeFile(path.join(dataRoot, 'sessions.json'), JSON.stringify([{tokenHash:hash('h3-token-a'),userId:userA.id,expiresAt},{tokenHash:hash('h3-token-b'),userId:userB.id,expiresAt}])),
    fsp.writeFile(path.join(dataRoot, 'projects.json'), JSON.stringify([{id:'NN-H3-DELIVERY-A',ownerId:userA.id,name:'H3 项目',status:'draft'}])),
    fsp.writeFile(path.join(dataRoot, 'script-projects.json'), '[]'),
    fsp.writeFile(path.join(dataRoot, 'canvas-documents.json'), JSON.stringify({'nomi:redraw:NN-H3-DELIVERY-A':h3Document(userA.id)})),
    fsp.writeFile(path.join(dataRoot, 'workspace-bindings.json'), JSON.stringify([{
      id:'NN-H3-DELIVERY-A',ownerId:userA.id,name:'H3 项目',redrawProjectIds:['NN-H3-DELIVERY-A'],redrawProjectId:'NN-H3-DELIVERY-A',scriptProjectIds:[],scriptProjectId:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()
    }])),
    fsp.writeFile(path.join(dataRoot, 'website-idempotency.json'), '[]'),
    fsp.writeFile(path.join(dataRoot, 'canvas-generation-jobs.json'), '[]')
  ]);
}

async function listen(server, port) { await new Promise(resolve => server.listen(port, '127.0.0.1', resolve)); }
async function waitForApp() {
  for (let retry = 0; retry < 100; retry += 1) {
    try { if ((await fetch(`${appUrl}/api/health`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`app did not start: ${output.slice(-1200)}`);
}

async function uploadReference(kind, bytes, filename, contentType) {
  const form = new FormData();
  if (kind === 'reference_image') {
    form.append('referenceImage', new Blob([bytes], {type:contentType}), filename);
  } else {
    form.append('kind', kind);
    form.append('asset', new Blob([bytes], {type:contentType}), filename);
  }
  const response = await fetch(`${appUrl}/api/projects/NN-H3-DELIVERY-A/assets`, {
    method:'POST',
    headers:headers('h3-token-a', {'x-niannian-project-kind':'redraw'}),
    body:form
  });
  const payload = await response.json();
  assert.equal(response.status, 201, JSON.stringify(payload));
  return payload.asset.id;
}

async function submitMode(nodeId, mode, references, idempotencyKey) {
  const grantResponse = await fetch(`${appUrl}/api/studio/spend-grants`, {
    method:'POST', headers:headers('h3-token-a', {'content-type':'application/json'}),
    body:JSON.stringify({projectId:'NN-H3-DELIVERY-A',projectKind:'redraw',nodeIds:[nodeId]})
  });
  const grant = await grantResponse.json();
  assert.equal(grantResponse.status, 201, JSON.stringify(grant));
  const taskResponse = await fetch(`${appUrl}/api/studio/tasks`, {
    method:'POST', headers:headers('h3-token-a', {'content-type':'application/json'}),
    body:JSON.stringify({projectId:'NN-H3-DELIVERY-A',projectKind:'redraw',vendor:'runninghub',request:{
      kind:'text_to_video', prompt:'H3 模式端到端回归', extras:{grantId:grant.grantId,nodeId,idempotencyKey,modelKey:'niannian/minimax-h3',archetypeInput:{mode,...references}}
    }})
  });
  const task = await taskResponse.json();
  assert.equal(taskResponse.status, 202, JSON.stringify(task));
  assert.equal(task.result.status, 'queued');
  assert.equal(task.result.mode, mode);
  const deliveredResponse = await fetch(`${appUrl}/api/studio/tasks/${encodeURIComponent(task.result.id)}?projectId=NN-H3-DELIVERY-A`, {headers:headers('h3-token-a')});
  const delivered = await deliveredResponse.json();
  assert.equal(deliveredResponse.status, 200, JSON.stringify(delivered));
  assert.equal(delivered.result.status, 'succeeded');
  assert.equal(delivered.result.assets.length, 1);
  return {task,delivered};
}

async function run() {
  await seed();
  provider = http.createServer((request, response) => {
    const workflowMatch = request.url.match(/^\/openapi\/v2\/run\/workflow\/(2084079636237078529|2085388519102570497|2085082190681038850)$/);
    if (workflowMatch && request.method === 'POST') {
      runCalls += 1;
      const taskId = `mock-h3-task-${runCalls}`;
      providerTasks.set(taskId, workflowMatch[1]);
      workflowPaths.push(request.url);
      response.writeHead(200, {'content-type':'application/json'});
      return response.end(JSON.stringify({data:{taskId}}));
    }
    if (request.url === '/openapi/v2/media/upload/binary' && request.method === 'POST') {
      response.writeHead(200, {'content-type':'application/json'});
      return response.end(JSON.stringify({data:{fileName:`mock-reference-${Date.now()}-${Math.random()}.bin`}}));
    }
    if (request.url === '/openapi/v2/query' && request.method === 'POST') {
      queryCalls += 1;
      const taskId = Array.from(providerTasks.keys())[queryCalls - 1] || 'mock-h3-task-unknown';
      response.writeHead(200, {'content-type':'application/json'});
      return response.end(JSON.stringify({data:{taskId,status:'SUCCESS',resultUrl:`${providerUrl}/result.mp4`,usage:{consumeCoins:12,consumeMoney:0}}}));
    }
    if (request.url === '/result.mp4' && request.method === 'GET') {
      videoReads += 1;
      response.writeHead(200, {'content-type':'video/mp4','content-length':mp4.length});
      return response.end(mp4);
    }
    response.writeHead(404); response.end();
  });
  await listen(provider, providerPort);
  app = spawn(process.execPath, ['server.js'], {cwd:root,env:{...process.env,PORT:String(appPort),DATA_DIR:dataRoot,NIANNIAN_LOCAL_PREVIEW_INSECURE_SESSION:'on',NODE_ENV:'test',NOMI_RUNNINGHUB_H3_BASE_URL:providerUrl,NOMI_RUNNINGHUB_H3_API_KEY:'test-only-key',RUNNINGHUB_API_KEY:'enterprise-key-must-not-be-used'},stdio:['ignore','pipe','pipe']});
  app.stdout.on('data', chunk => { output += chunk.toString('utf8'); });
  app.stderr.on('data', chunk => { output += chunk.toString('utf8'); });
  await waitForApp();

  const grantResponse = await fetch(`${appUrl}/api/studio/spend-grants`, {method:'POST',headers:headers('h3-token-a',{'content-type':'application/json'}),body:JSON.stringify({projectId:'NN-H3-DELIVERY-A',projectKind:'redraw',nodeIds:['h3-node']})});
  const grant = await grantResponse.json();
  assert.equal(grantResponse.status, 201);
  const taskResponse = await fetch(`${appUrl}/api/studio/tasks`, {method:'POST',headers:headers('h3-token-a',{'content-type':'application/json'}),body:JSON.stringify({projectId:'NN-H3-DELIVERY-A',projectKind:'redraw',vendor:'runninghub',request:{kind:'text_to_video',prompt:'雨夜城市街头，人物缓慢回头',extras:{grantId:grant.grantId,nodeId:'h3-node',idempotencyKey:'delivery-idempotency',modelKey:'niannian/minimax-h3',archetypeInput:{mode:'t2v'}}}})});
  const task = await taskResponse.json();
  assert.equal(taskResponse.status, 202);
  assert.equal(task.result.status, 'queued');
  assert.equal(task.result.mode, 't2v');
  assert.equal(task.result.provider, 'runninghub-h3');
  assert.equal(runCalls, 1);

  const deliveredResponse = await fetch(`${appUrl}/api/studio/tasks/${encodeURIComponent(task.result.id)}?projectId=NN-H3-DELIVERY-A`, {headers:headers('h3-token-a')});
  const delivered = await deliveredResponse.json();
  assert.equal(deliveredResponse.status, 200);
  assert.equal(delivered.result.status, 'succeeded');
  assert.equal(delivered.result.assets.length, 1);
  assert.match(delivered.result.assets[0].url, /^\/api\/projects\/NN-H3-DELIVERY-A\/assets\/CAS-[a-f0-9]{24}\/download$/);
  assert.equal(queryCalls, 1);
  assert.equal(videoReads, 1);
  assert.equal(JSON.stringify(delivered), JSON.stringify(delivered).replace(/mock-h3-task|result\.mp4/g, ''));

  const imageIds = [];
  for (let index = 0; index < 9; index += 1) {
    const imageBytes = await sharp({create:{width:12,height:8,channels:4,background:{r:20 + index * 10,g:30 + index * 5,b:40 + index * 3,alpha:1}}}).png().toBuffer();
    imageIds.push(await uploadReference('reference_image', imageBytes, `reference-${index + 1}.png`, 'image/png'));
  }
  const audioIds = [];
  for (let index = 0; index < 3; index += 1) {
    audioIds.push(await uploadReference('reference_audio', Buffer.from(`ID3\x04\x00\x00\x00\x00\x00\x00h3-audio-${index}`), `reference-${index + 1}.mp3`, 'audio/mpeg'));
  }
  const videoIds = [];
  for (let index = 0; index < 3; index += 1) {
    const referenceVideo = Buffer.alloc(40, index);
    referenceVideo.writeUInt32BE(32, 0);
    referenceVideo.write('ftyp', 4, 'ascii');
    referenceVideo.write('isom', 8, 'ascii');
    videoIds.push(await uploadReference('reference_video', referenceVideo, `reference-${index + 1}.mp4`, 'video/mp4'));
  }
  const i2v = await submitMode('h3-i2v-node', 'i2v', {reference_image_asset_ids:[imageIds[0]]}, 'delivery-i2v');
  assert.equal(i2v.delivered.result.mode, 'i2v');
  const omni = await submitMode('h3-omni-node', 'omni_reference', {
    reference_image_asset_ids:imageIds,
    reference_audio_asset_ids:audioIds,
    reference_video_asset_ids:videoIds
  }, 'delivery-omni');
  assert.equal(omni.delivered.result.mode, 'omni_reference');
  assert.deepEqual(workflowPaths, [
    '/openapi/v2/run/workflow/2084079636237078529',
    '/openapi/v2/run/workflow/2085388519102570497',
    '/openapi/v2/run/workflow/2085082190681038850'
  ]);
  assert.equal(runCalls, 3);
  assert.equal(queryCalls, 3);
  assert.equal(videoReads, 3);

  const downloadResponse = await fetch(appUrl + delivered.result.assets[0].url, {headers:headers('h3-token-a')});
  assert.equal(downloadResponse.status, 200);
  assert.deepEqual(Buffer.from(await downloadResponse.arrayBuffer()), mp4);
  const projectDeliveriesResponse = await fetch(`${appUrl}/api/projects/NN-H3-DELIVERY-A/deliveries`, {headers:headers('h3-token-a')});
  const projectDeliveries = await projectDeliveriesResponse.json();
  assert.equal(projectDeliveriesResponse.status, 200, JSON.stringify(projectDeliveries));
  assert.equal(projectDeliveries.status, '已完成');
  assert.equal(projectDeliveries.deliveries.length, 3);
  assert.equal(projectDeliveries.deliveries[0].type, 'video');
  assert.match(projectDeliveries.deliveries[0].openUrl, /^\/api\/projects\/NN-H3-DELIVERY-A\/assets\/CAS-[a-f0-9]{24}\/download$/);
  assert.equal(projectDeliveries.deliveries[0].downloadUrl, projectDeliveries.deliveries[0].openUrl + '?download=1');
  assert.equal(JSON.stringify(projectDeliveries).includes('mock-h3-task'), false);
  assert.equal(JSON.stringify(projectDeliveries).includes('result.mp4'), false);
  const deliveryDownload = await fetch(appUrl + projectDeliveries.deliveries[0].downloadUrl, {headers:headers('h3-token-a')});
  assert.equal(deliveryDownload.status, 200);
  assert.match(String(deliveryDownload.headers.get('content-disposition') || ''), /^attachment;/);
  assert.deepEqual(Buffer.from(await deliveryDownload.arrayBuffer()), mp4);
  const workspaceDeliveriesResponse = await fetch(`${appUrl}/api/workspace-projects/NN-H3-DELIVERY-A/deliveries`, {headers:headers('h3-token-a')});
  const workspaceDeliveries = await workspaceDeliveriesResponse.json();
  assert.equal(workspaceDeliveriesResponse.status, 200, JSON.stringify(workspaceDeliveries));
  assert.equal(workspaceDeliveries.deliveries.length, 3);
  assert.equal(workspaceDeliveries.deliveries[0].assetId, projectDeliveries.deliveries[0].assetId);
  const docs = JSON.parse(await fsp.readFile(path.join(dataRoot, 'canvas-documents.json'), 'utf8'));
  const node = docs['nomi:redraw:NN-H3-DELIVERY-A'].document.generationCanvas.nodes[0];
  assert.equal(node.status, 'success');
  assert.equal(node.result.assetId, delivered.result.assets[0].assetId);
  assert.equal(node.result.url, delivered.result.assets[0].url);
  const tasks = await fsp.readFile(path.join(dataRoot, 'nomi-web-tasks.json'), 'utf8');
  assert.equal(tasks.includes('/result.mp4'), false);
  const repeat = await fetch(`${appUrl}/api/studio/tasks/${encodeURIComponent(task.result.id)}?projectId=NN-H3-DELIVERY-A`, {headers:headers('h3-token-a')});
  assert.equal(repeat.status, 200);
  assert.equal(queryCalls, 3);
  assert.equal(videoReads, 3);
  const foreign = await fetch(`${appUrl}/api/studio/tasks/${encodeURIComponent(task.result.id)}?projectId=NN-H3-DELIVERY-A`, {headers:headers('h3-token-b')});
  assert.equal(foreign.status, 404);
  const foreignProjectDeliveries = await fetch(`${appUrl}/api/projects/NN-H3-DELIVERY-A/deliveries`, {headers:headers('h3-token-b')});
  assert.equal(foreignProjectDeliveries.status, 404);
  const foreignWorkspaceDeliveries = await fetch(`${appUrl}/api/workspace-projects/NN-H3-DELIVERY-A/deliveries`, {headers:headers('h3-token-b')});
  assert.equal(foreignWorkspaceDeliveries.status, 404);
  console.log('NOMI_H3_RESULT_DELIVERY_HTTP_CONTRACT_OK');
}

run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (app && !app.killed) app.kill();
  if (provider) await new Promise(resolve => provider.close(resolve));
  await fsp.rm(dataRoot, {recursive:true,force:true});
});
