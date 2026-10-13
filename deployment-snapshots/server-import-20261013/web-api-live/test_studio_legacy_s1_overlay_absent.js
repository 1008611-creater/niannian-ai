'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const index = fs.readFileSync(path.join(__dirname, 'studio', 'index.html'), 'utf8');

assert.equal(index.includes('s1-chain-ui'), false, 'Studio must not load the retired s1-chain overlay');
assert.equal(fs.existsSync(path.join(__dirname, 'studio', 'assets', 's1-chain-ui.js')), false, 'Retired s1-chain-ui asset must not ship');
assert.equal(index.includes('owned-canvas-director-import'), false, 'Studio must not load the retired canvas importer');
assert.equal(index.includes('electron'), false, 'Studio must not load the retired Electron canvas path');
assert.match(index, /assets\/index-M-8MrEH2\.js/, 'Native nomi canvas entry must stay loaded');
console.log(JSON.stringify({ok:true, verified:['s1-chain overlay fully removed','native nomi canvas entry intact']}));
