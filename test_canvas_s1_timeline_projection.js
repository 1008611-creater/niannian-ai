'use strict';

const assert = require('node:assert/strict');
const chain = require('./bridge/niannian_canvas_s1_chain');

const binding = {
  assetId:'CAS-STEP02-001',
  sourceSha256:'a'.repeat(64),
  sourceBytes:1024,
  rightsEventId:'rights-step02-001',
  preflightStatus:'passed',
  boundAt:'2026-08-12T00:00:00.000Z'
};

function node(document, id) { return document.nodes.find(item => item.id === id); }

const blocked = chain.createChain({projectId:'NN-S1-PROJECTION',sourceAssetIds:[binding.assetId],sourceBinding:binding,step01Project:{analysis:{status:'awaiting_user_start'}},runtime:{ready:false,blocker:'STEP01_HQ_RUNTIME_NOT_CONFIGURED'}});
assert.equal(node(blocked, 's1-source-input').status, 'ready');
assert.equal(node(blocked, 's1-step01-analysis').status, 'blocked');
assert.equal(node(blocked, 's1-step01-analysis').parameters.blocker, 'STEP01_HQ_RUNTIME_NOT_CONFIGURED');
assert.equal(node(blocked, 's1-step02-timeline').status, 'blocked');

const evidenceReady = chain.createChain({projectId:'NN-S1-PROJECTION',sourceAssetIds:[binding.assetId],sourceBinding:binding,step01Project:{analysis:{status:'evidence_ready'}}});
assert.equal(node(evidenceReady, 's1-step01-analysis').status, 'succeeded');
assert.equal(node(evidenceReady, 's1-step02-timeline').status, 'ready');
assert.equal(node(evidenceReady, 's1-step02-timeline').parameters.gateState, 'step02_prepare_available');

const candidateReady = chain.createChain({projectId:'NN-S1-PROJECTION',sourceAssetIds:[binding.assetId],sourceBinding:binding,step01Project:{analysis:{status:'evidence_ready'},step02:{status:'candidate_return_ready'}}});
assert.equal(node(candidateReady, 's1-step02-timeline').status, 'needs_review');

const accepted = chain.createChain({projectId:'NN-S1-PROJECTION',sourceAssetIds:[binding.assetId],sourceBinding:binding,step01Project:{analysis:{status:'evidence_ready'},step02:{status:'step02_accepted'}}});
assert.equal(node(accepted, 's1-step02-timeline').status, 'succeeded');

process.stdout.write(JSON.stringify({ok:true,verified:['S1 source preflight stays authoritative','Step01 runtime blocker is projected without a task','verified Step01 evidence unlocks Step02','Step02 candidate and acceptance states stay distinct']}) + '\n');
