'use strict';

const assert = require('node:assert/strict');
const configurator = require('./tools/configure_haika_step01_secrets');

const key = 'synthetic-test-key';
const primary = configurator.gptProfile({
  gpt_primary_base:'https://primary.example/v1',
  gpt_primary_key:key,
  gpt_primary_model:'gpt-5.6-sol'
}, 'gpt_primary', true);
assert.deepEqual(primary, {base:'https://primary.example/v1', key, model:'gpt-5.6-sol'});
assert.equal(configurator.gptProfile({gpt_fallback_1_base:'', gpt_fallback_1_key:'', gpt_fallback_1_model:''}, 'gpt_fallback_1', false), null);
assert.equal(configurator.gptProfile({gpt_fallback_1_base:'https://fallback.example/v1', gpt_fallback_1_key:'', gpt_fallback_1_model:'fallback'}, 'gpt_fallback_1', false), false);
const html = configurator.page();
assert.match(html, /GPT 主上游/);
assert.match(html, /GPT 备用上游 1/);
assert.match(html, /GPT 备用上游 2/);
process.stdout.write(JSON.stringify({ok:true, verified:['primary profile validation', 'optional fallback validation', 'three-upstream form']}) + '\n');
