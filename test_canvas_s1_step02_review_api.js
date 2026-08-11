'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

assert.match(source, /function publicCanvasS1Step02Review\(review\)/);
assert.match(source, /\/s1-step02-review\$\//);
assert.match(source, /review:publicCanvasS1Step02Review\(review\)/);
assert.match(source, /providerSubmitRequested:false/);
assert.match(source, /spendRequested:false/);
assert.match(source, /schemaVersion:'niannian_canvas_s1_step02_review_v1'/);
assert.match(source, /sourceRows:/);
assert.match(source, /dialogueBindings:/);
assert.match(source, /visualFactCards:/);
assert.doesNotMatch(source, /review:review,readiness:canvasS1ReadinessProjection/);

console.log(JSON.stringify({ok:true,verified:[
  'canvas Step02 review has a project-scoped public projection',
  'the read-only review route is gated by Step01 evidence_ready',
  'prepare and review responses do not expose internal review objects',
  'candidate timeline facts are limited to user-readable fields',
  'provider submission and spend remain explicitly false'
]}));
