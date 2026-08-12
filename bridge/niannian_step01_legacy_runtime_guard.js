'use strict';

// The historical Mac employee runtime is intentionally not part of the
// canonical Git checkout. Keep callers loadable and fail closed with a typed
// blocker instead of leaking MODULE_NOT_FOUND from an ignored path.
const LEGACY_BLOCKER = 'STEP01_LEGACY_RUNTIME_NOT_INSTALLED';

function unavailable() {
  const error = new Error('历史桌面 Step01 执行器未安装；请使用 Haika 服务器执行器');
  error.code = LEGACY_BLOCKER;
  throw error;
}

async function validateToolchainContract() {
  return unavailable();
}

module.exports = Object.freeze({
  LEGACY_BLOCKER,
  ALLOWED_SKILL_ROOTS: Object.freeze([]),
  validateToolchainContract
});
