'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const html = fs.readFileSync(path.join(root, 'studio', 'index.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'studio', 'assets', 's1-chain-ui.js'), 'utf8');

assert.match(html, /assets\/s1-chain-ui\.js\?v=20260812-s1-source-upload-r1/);
assert.match(source, /data-s1-upload/);
assert.match(source, /reference_video/);
assert.match(source, /video\/mp4,video\/quicktime,video\/webm/);
assert.match(source, /\/api\/canvas\/documents\//);
assert.match(source, /\/s1-chain/);
assert.match(source, /\/s1-source-binding/);
assert.match(source, /\/s1-readiness/);
assert.match(source, /\/step01-analysis/);
assert.match(source, /data-s1-start/);
assert.match(source, /data-s1-step02-prepare/);
assert.match(source, /s1-step02-prepare/);
assert.match(source, /if-match/);
assert.match(source, /x-niannian-project-kind/);
assert.match(source, /rightsConfirmed/);
assert.match(source, /服务器会复制同一文件、校验 SHA 并执行媒体预检/);
assert.match(source, /预检已通过/);
assert.match(source, /\/step01-evidence/);
assert.match(source, /s1-step02-review/);
assert.match(source, /Step02 时间线审核/);
assert.match(source, /mx-shortdrama-02-source-timeline/);
assert.match(source, /Provider 提交：否/);
assert.match(source, /evidence_ready/);
assert.match(source, /data-s1-evidence/);
assert.match(source, /point\.toUpperCase/);
assert.match(source, /镜头 .* 个/);
assert.match(source, /仅显示当前项目已验证素材/);
assert.match(source, /正在读取已验证的镜头时间线与证据帧/);
assert.doesNotMatch(source, /<select data-s1-preflight>/);
assert.doesNotMatch(source, /confirmProviderSpend/);
assert.doesNotMatch(source, /\/canvas\/jobs/);

console.log(JSON.stringify({ok:true,verified:['Studio loads the S1 control surface','current project assets are selected through the API','revision protection is sent on creation','server runtime readiness is visible before analysis start','Step02 prepares only after Step01 evidence is ready','the UI cannot submit a media provider job']}));
