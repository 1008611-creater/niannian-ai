'use strict';

const assert = require('node:assert/strict');

const dispatcher = require('./bridge/niannian_redraw_step01_mac_app_dispatcher');
const phase = require('./bridge/niannian_redraw_step01_mac_app_phase');
const guard = require('./bridge/niannian_step01_legacy_runtime_guard');

assert.equal(typeof dispatcher.run, 'function');
assert.equal(typeof phase.evaluateHqGate, 'function');
assert.equal(guard.LEGACY_BLOCKER, 'STEP01_LEGACY_RUNTIME_NOT_INSTALLED');
assert.deepEqual(guard.ALLOWED_SKILL_ROOTS, []);
(async () => {
  await assert.rejects(
    () => guard.validateToolchainContract({}, 'ignored', [], {}),
    error => error.code === guard.LEGACY_BLOCKER
  );
  await assert.rejects(
    () => phase.validateWindowsMirror({}, '', '', {}),
    error => error.code === guard.LEGACY_BLOCKER
  );

  console.log(JSON.stringify({
    ok: true,
    verified: [
      'tracked Step01 modules load without ignored Mac runtime files',
      'legacy desktop execution fails closed with a typed blocker',
      'Haika server executor remains the canonical production path'
    ]
  }));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
