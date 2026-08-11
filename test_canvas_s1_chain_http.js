'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fsp = require('node:fs').promises;
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');

const root = __dirname;
const port = 20500 + Math.floor(Math.random() * 400);
const dataRoot = path.join(os.tmpdir(), `niannian-canvas-s1-${process.pid}-${Date.now()}`);
const token = 'canvas-s1-token';
const user = {id:'USR-CANVAS-S1',email:'canvas-s1@example.test',status:'active'};
const project = {id:'NN-S1-CANVAS-01',ownerId:user.id,name:'S1 chain test',projectKind:'redraw',canvasOnly:true,status:'ready',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),runtime:{}};
const validProject = {id:'NN-S1-CANVAS-02',ownerId:user.id,name:'S1 valid source test',projectKind:'redraw',canvasOnly:true,status:'ready',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),runtime:{}};
let child;
let output = '';

function tokenHash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function headers(extra = {}) { return {cookie:`niannian_session=${token}`,...extra}; }
async function request(pathname, options = {}) { const response = await fetch(`http://127.0.0.1:${port}${pathname}`, options); return {response,body:await response.json()}; }

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('test_server_not_ready:' + output.slice(-500));
}

async function createValidVideo(target) {
  let available = true;
  await new Promise((resolve, reject) => {
    const process = spawn('ffmpeg', ['-y','-f','lavfi','-i','color=c=black:s=320x180:r=24','-f','lavfi','-i','sine=frequency=1000:sample_rate=44100','-t','15','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',target], {stdio:['ignore','ignore','pipe']});
    let error = '';
    process.stderr.on('data', chunk => { error += chunk.toString(); });
    process.on('error', error => { if (error.code === 'ENOENT') { available = false; resolve(); } else reject(error); });
    process.on('close', code => code === 0 ? resolve() : reject(new Error('ffmpeg_fixture_failed:' + error.slice(-500))));
  });
  return available;
}

async function run() {
  await fsp.mkdir(dataRoot, {recursive:true});
  const sourceAssetId = 'CAS-111111111111111111111111';
  const validAssetId = 'CAS-222222222222222222222222';
  const sourceVideo = Buffer.alloc(32);
  sourceVideo.writeUInt32BE(32, 0);
  sourceVideo.write('ftyp', 4, 'ascii');
  sourceVideo.write('isom', 8, 'ascii');
  const sourceSha256 = crypto.createHash('sha256').update(sourceVideo).digest('hex');
  await fsp.mkdir(path.join(dataRoot,'canvas-assets'), {recursive:true});
  const validFixturePath = path.join(dataRoot, 'valid-fixture.mp4');
  const validVideoReady = await createValidVideo(validFixturePath);
  const validVideo = validVideoReady ? await fsp.readFile(validFixturePath) : null;
  const validSha256 = validVideo ? crypto.createHash('sha256').update(validVideo).digest('hex') : null;
  await Promise.all([
    fsp.writeFile(path.join(dataRoot,'users.json'), JSON.stringify([user])),
    fsp.writeFile(path.join(dataRoot,'sessions.json'), JSON.stringify([{tokenHash:tokenHash(token),userId:user.id,expiresAt:new Date(Date.now()+3600000).toISOString()}])),
    fsp.writeFile(path.join(dataRoot,'projects.json'), '[]'),
    fsp.writeFile(path.join(dataRoot,'canvas-projects.json'), JSON.stringify(validVideo ? [project,validProject] : [project])),
    fsp.writeFile(path.join(dataRoot,'canvas-documents.json'), '{}'),
    fsp.writeFile(path.join(dataRoot,'canvas-assets.json'), JSON.stringify([{schemaVersion:'niannian.canvas_asset.v1',id:sourceAssetId,ownerId:user.id,projectId:project.id,projectKind:'redraw',kind:'reference_video',originalName:'invalid-fixture.mp4',mimeType:'video/mp4',format:'mp4',bytes:sourceVideo.length,sha256:sourceSha256,storageKey:'canvas-assets/'+sourceAssetId+'.mp4',storedPath:path.join(dataRoot,'canvas-assets',sourceAssetId+'.mp4'),status:'ready',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}].concat(validVideo ? [{schemaVersion:'niannian.canvas_asset.v1',id:validAssetId,ownerId:user.id,projectId:validProject.id,projectKind:'redraw',kind:'reference_video',originalName:'valid-fixture.mp4',mimeType:'video/mp4',format:'mp4',bytes:validVideo.length,sha256:validSha256,storageKey:'canvas-assets/'+validAssetId+'.mp4',storedPath:path.join(dataRoot,'canvas-assets',validAssetId+'.mp4'),status:'ready',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}] : []))),
    fsp.writeFile(path.join(dataRoot,'canvas-assets',sourceAssetId+'.mp4'), sourceVideo),
    fsp.writeFile(path.join(dataRoot,'canvas-generation-jobs.json'), '[]'),
    fsp.writeFile(path.join(dataRoot,'workspace-bindings.json'), '[]'),
    fsp.writeFile(path.join(dataRoot,'script-projects.json'), '[]')
  ]);
  if (validVideo) await fsp.writeFile(path.join(dataRoot,'canvas-assets',validAssetId+'.mp4'), validVideo);
  child = spawn(process.execPath, ['server.js'], {cwd:root,env:{...process.env,PORT:String(port),DATA_DIR:dataRoot,NIANNIAN_TEXT_API_KEY:'',NIANNIAN_TEXT_MODEL:'',NIANNIAN_TEXT_PROVIDER_SUBMIT:'off'},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  await waitForServer();
  const initial = await request('/api/canvas/documents/redraw/' + project.id, {headers:headers()});
  assert.equal(initial.response.status, 200);
  const missingRights = await request('/api/canvas/documents/redraw/' + project.id + '/s1-source-binding', {method:'POST',headers:headers({'content-type':'application/json'}),body:JSON.stringify({sourceAssetId,rightsConfirmed:false})});
  assert.equal(missingRights.response.status, 422);
  assert.equal(missingRights.body.code, 'CANVAS_S1_RIGHTS_REQUIRED');
  const binding = await request('/api/canvas/documents/redraw/' + project.id + '/s1-source-binding', {method:'POST',headers:headers({'content-type':'application/json'}),body:JSON.stringify({sourceAssetId,rightsConfirmed:true})});
  assert.equal(binding.response.status, 201, JSON.stringify(binding.body));
  assert.equal(binding.body.sourceBinding.assetId, sourceAssetId);
  assert.equal(binding.body.sourceBinding.sourceSha256, sourceSha256);
  assert.equal(binding.body.preflight.status, 'failed');
  assert.equal(binding.body.providerSubmitRequested, false);
  const readiness = await request('/api/canvas/documents/redraw/' + project.id + '/s1-readiness', {headers:headers()});
  assert.equal(readiness.response.status, 200, JSON.stringify(readiness.body));
  assert.equal(readiness.body.code, 'CANVAS_S1_READINESS');
  assert.equal(readiness.body.readiness.source.status, 'blocked');
  assert.equal(readiness.body.readiness.execution.ready, false);
  assert.equal(readiness.body.readiness.nodes.find(item => item.id === 's1-step01-analysis').status, 'blocked');
  assert.equal(readiness.body.readiness.nodes.find(item => item.id === 's1-step02-timeline').status, 'blocked');
  assert.equal(readiness.body.providerSubmitRequested, false);
  assert.equal(readiness.body.spendRequested, false);
  const prematureStep02 = await request('/api/canvas/documents/redraw/' + project.id + '/s1-step02-prepare', {method:'POST',headers:headers({'content-type':'application/json'}),body:'{}'});
  assert.equal(prematureStep02.response.status, 409, JSON.stringify(prematureStep02.body));
  assert.equal(prematureStep02.body.code, 'STEP01_EVIDENCE_REQUIRED');
  assert.equal(prematureStep02.body.providerSubmitRequested, false);
  assert.equal(prematureStep02.body.spendRequested, false);
  const prematureStep02Review = await request('/api/canvas/documents/redraw/' + project.id + '/s1-step02-review', {headers:headers()});
  assert.equal(prematureStep02Review.response.status, 409, JSON.stringify(prematureStep02Review.body));
  assert.equal(prematureStep02Review.body.code, 'STEP01_EVIDENCE_REQUIRED');
  assert.equal(prematureStep02Review.body.providerSubmitRequested, false);
  assert.equal(prematureStep02Review.body.spendRequested, false);
  const replayBinding = await request('/api/canvas/documents/redraw/' + project.id + '/s1-source-binding', {method:'POST',headers:headers({'content-type':'application/json'}),body:JSON.stringify({sourceAssetId,rightsConfirmed:true})});
  assert.equal(replayBinding.response.status, 201);
  assert.equal(replayBinding.body.created, false);
  const built = await request('/api/canvas/documents/redraw/' + project.id + '/s1-chain', {method:'POST',headers:headers({'content-type':'application/json','if-match':initial.response.headers.get('etag')||'"canvas-rev-0"'}),body:JSON.stringify({sourceAssetIds:[sourceAssetId],rightsConfirmed:true,preflightStatus:'passed'})});
  assert.equal(built.response.status, 201, JSON.stringify(built.body));
  assert.deepEqual(built.body.chain.nodeIds, ['s1-source-input','s1-step01-analysis','s1-step02-timeline']);
  assert.equal(built.body.chain.sourceReady, false, 'client preflight text must not turn an invalid server-checked source into ready');
  assert.equal(built.body.document.nodes.length, 3);
  assert.deepEqual(built.body.document.edges.map(item => [item.source,item.target]), [['s1-source-input','s1-step01-analysis'],['s1-step01-analysis','s1-step02-timeline']]);
  const step01 = built.body.document.nodes.find(item => item.id === 's1-step01-analysis');
  assert.equal(step01.status, 'blocked');
  assert.equal(step01.data.status, 'blocked');
  assert.equal(step01.data.parameters.blocker, 'SOURCE_INPUT_INCOMPLETE');
  const reloaded = await request('/api/canvas/documents/redraw/' + project.id, {headers:headers()});
  assert.equal(reloaded.body.document.nodes.find(item => item.id === 's1-step02-timeline').status, 'blocked');
  const stale = await request('/api/canvas/documents/redraw/' + project.id + '/s1-chain', {method:'POST',headers:headers({'content-type':'application/json','if-match':'"canvas-rev-0"'}),body:'{}'});
  assert.equal(stale.response.status, 412);
  const verified = ['canvas video binding copies and hashes the exact same-project source','rights confirmation is mandatory','server preflight result overrides client text','S1 readiness exposes typed source/runtime blockers without provider work','Step02 cannot prepare before immutable Step01 evidence'];
  if (validVideo) {
    const validInitial = await request('/api/canvas/documents/redraw/' + validProject.id, {headers:headers()});
    const validBinding = await request('/api/canvas/documents/redraw/' + validProject.id + '/s1-source-binding', {method:'POST',headers:headers({'content-type':'application/json'}),body:JSON.stringify({sourceAssetId:validAssetId,rightsConfirmed:true})});
    assert.equal(validBinding.response.status, 201, JSON.stringify(validBinding.body));
    assert.equal(validBinding.body.sourceBinding.sourceSha256, validSha256);
    assert.equal(validBinding.body.preflight.status, 'passed');
    const validChain = await request('/api/canvas/documents/redraw/' + validProject.id + '/s1-chain', {method:'POST',headers:headers({'content-type':'application/json','if-match':validInitial.response.headers.get('etag')||'"canvas-rev-0"'}),body:JSON.stringify({sourceAssetIds:[validAssetId],rightsConfirmed:true,preflightStatus:'passed'})});
    assert.equal(validChain.response.status, 201, JSON.stringify(validChain.body));
    assert.equal(validChain.body.chain.sourceReady, true);
    assert.equal(validChain.body.document.nodes.find(item => item.id === 's1-source-input').status, 'ready');
    assert.equal(validChain.body.document.nodes.find(item => item.id === 's1-step01-analysis').data.parameters.sourceSha256, validSha256);
    verified.push('valid MP4 reaches the ready source node only after real server preflight');
  } else {
    verified.push('CI without ffmpeg keeps the valid-source branch optional while preserving invalid-source blocking');
  }
  verified.push('idempotent S1 source/Step01/Step02 chain','explicit blocked recovery state','revision conflict protection','no provider submission');
  console.log(JSON.stringify({ok:true,verified}));
}

run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (child && !child.killed) child.kill(); await fsp.rm(dataRoot,{recursive:true,force:true}); });
