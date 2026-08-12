'use strict';

const assert = require('node:assert/strict');
const executor = require('./bridge/niannian_step01_server_executor');

const sourceSha256 = 'a'.repeat(64);

const baseEnv = {
  NIANNIAN_STEP01_GPT_API_BASE_URL:'https://primary.example/v1',
  NIANNIAN_STEP01_GPT_API_KEY:'primary-test-key',
  NIANNIAN_STEP01_GPT_MODEL:'primary-model',
  NIANNIAN_STEP01_GPT_FALLBACK_1_API_BASE_URL:'https://fallback.example/v1',
  NIANNIAN_STEP01_GPT_FALLBACK_1_API_KEY:'fallback-test-key',
  NIANNIAN_STEP01_GPT_FALLBACK_1_MODEL:'fallback-model'
};

async function main() {
  const configs = executor.modelConfigs(baseEnv);
  assert.deepEqual(configs.map(config => [config.id, config.endpoint, config.model]), [
    ['primary', 'https://primary.example/v1/responses', 'primary-model'],
    ['fallback-1', 'https://fallback.example/v1/responses', 'fallback-model']
  ]);
  assert.throws(() => executor.modelConfigs({...baseEnv, NIANNIAN_STEP01_GPT_FALLBACK_1_API_KEY:''}), {code:'STEP01_SERVER_GPT_PROFILE_NOT_CONFIGURED'});
  const calls = [];
  const result = await executor.analyzeFramesWithRetry({
    configs,
    root:process.cwd(),
    project:{id:'NN-TEST-0123456789', source:{sha256:sourceSha256}},
    analysisRun:{id:'analysis-1-0123456789abcdef'},
    timeline:[],
    frames:[],
    fetchImpl:async endpoint => {
      calls.push(endpoint);
      if (calls.length === 1) return {ok:false,status:503,json:async () => ({})};
      return {ok:true,status:200,json:async () => ({output_text:JSON.stringify({segments:[]})})};
    }
  });
  assert.equal(result.model, 'fallback-model');
  assert.deepEqual(calls, ['https://primary.example/v1/responses', 'https://fallback.example/v1/responses']);
  const noFallbackCalls = [];
  await assert.rejects(() => executor.analyzeFramesWithRetry({
    configs,
    root:process.cwd(),
    project:{id:'NN-TEST-0123456789', source:{sha256:sourceSha256}},
    analysisRun:{id:'analysis-1-0123456789abcdef'},
    timeline:[],
    frames:[],
    fetchImpl:async endpoint => { noFallbackCalls.push(endpoint); return {ok:false,status:401,json:async () => ({})}; }
  }), {code:'STEP01_SERVER_GPT_HTTP_401'});
  assert.deepEqual(noFallbackCalls, ['https://primary.example/v1/responses']);
  assert.equal(executor.modelConfig(baseEnv).id, 'primary');
  process.stdout.write(JSON.stringify({ok:true, verified:['ordered profiles', '503 failover', '401 stops without fallback']}) + '\n');
}

main().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
