'use strict';

const assert = require('assert');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const executor = require('./bridge/niannian_step01_server_executor');

async function main() {
  const missing = executor.runtimeReadiness({});
  assert.equal(missing.ready, false);
  assert.equal(missing.blocker, 'STEP01_HQ_RUNTIME_NOT_CONFIGURED');
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'niannian-step01-readiness-'));
  try {
    const runner = path.join(root, 'runner.py');
    const step01 = path.join(root, 'step01');
    const step02 = path.join(root, 'step02');
    await Promise.all([fsp.writeFile(runner, '# runner\n'), fsp.mkdir(step01), fsp.mkdir(step02)]);
    const ready = executor.runtimeReadiness({
      NIANNIAN_STEP01_HQ_RUNNER:runner,
      NIANNIAN_STEP01_HQ_STEP01_SKILL_ROOT:step01,
      NIANNIAN_STEP01_HQ_STEP02_SKILL_ROOT:step02,
      MIMO_API_KEY:'fixture-mimo',
      PADDLEOCR_API_TOKEN:'fixture-paddle',
      NIANNIAN_STEP01_GPT_API_KEY:'fixture-gpt',
      NIANNIAN_STEP01_GPT_API_BASE_URL:'https://analysis.example.test/v1'
    });
    assert.equal(ready.ready, true);
    assert.equal(ready.status, 'configured');
    assert.equal(ready.provider_requested, false);
    assert.equal(ready.spend_requested, false);
    assert.doesNotMatch(JSON.stringify(ready), /fixture-/);
    console.log(JSON.stringify({ok:true,verified:['missing runtime returns a typed blocker','configured runtime exposes no credential value','readiness creates no provider request or spend']}));
  } finally {
    await fsp.rm(root, {recursive:true,force:true});
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
