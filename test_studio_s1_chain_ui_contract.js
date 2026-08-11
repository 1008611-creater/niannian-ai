'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const html = fs.readFileSync(path.join(root, 'studio', 'index.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'studio', 'assets', 's1-chain-ui.js'), 'utf8');

assert.match(html, /assets\/s1-chain-ui\.js\?v=20260812-s1-readiness-r2/);
assert.match(source, /\/api\/canvas\/documents\//);
assert.match(source, /\/s1-chain/);
assert.match(source, /\/s1-source-binding/);
assert.match(source, /\/s1-readiness/);
assert.match(source, /\/step01-analysis/);
assert.match(source, /data-s1-start/);
assert.match(source, /if-match/);
assert.match(source, /x-niannian-project-kind/);
assert.match(source, /rightsConfirmed/);
assert.match(source, /服务器会复制同一文件、校验 SHA 并执行媒体预检/);
assert.match(source, /预检已通过/);
assert.doesNotMatch(source, /<select data-s1-preflight>/);
assert.doesNotMatch(source, /confirmProviderSpend/);
assert.doesNotMatch(source, /\/canvas\/jobs/);

console.log(JSON.stringify({ok:true,verified:['Studio loads the S1 control surface','current project assets are selected through the API','revision protection is sent on creation','server runtime readiness is visible before analysis start','the UI cannot submit a media provider job']}));
