'use strict';

// Local-only, one-time secret relay. Values are never written to disk or logs.
const crypto = require('crypto');
const http = require('http');
const {spawn} = require('child_process');

const host = '127.0.0.1';
const port = Number(process.env.HAIKA_STEP01_SECRET_PORT || 8718);
const csrf = crypto.randomBytes(32).toString('hex');
let used = false;

function gptFields(prefix, label, required) {
  const need = required ? ' required' : '';
  const defaultModel = required ? ' value="gpt-5.6-sol"' : '';
  return `<fieldset><legend>${label}</legend><label>Responses API Base URL</label><input name="${prefix}_base" type="url" placeholder="https://.../v1" autocomplete="off"${need}><label>API Key</label><input name="${prefix}_key" type="password" autocomplete="off"${need}><label>模型</label><input name="${prefix}_model"${defaultModel} placeholder="留空时使用主上游模型" autocomplete="off"${need}></fieldset>`;
}
function page(message = '') {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Haika Step01 配置</title><style>body{max-width:560px;margin:48px auto;font:16px system-ui;color:#16212b;padding:0 20px}label{display:block;margin:14px 0 6px;font-weight:600}input{box-sizing:border-box;width:100%;padding:10px;font:inherit;border:1px solid #9aa8b5;border-radius:4px}fieldset{margin:24px 0 0;padding:14px;border:1px solid #c5d0d6;border-radius:6px}legend{font-weight:700}.note{color:#53616d;font-size:14px;line-height:1.5}.error{color:#a72222}button{margin:24px 0;padding:11px 16px;font:inherit;background:#0b6b57;color:#fff;border:0;border-radius:4px;cursor:pointer}</style><h1>配置完整原片分析</h1><p class="note">此页面只在本机运行。按顺序填写最多三个 GPT 上游；只有 429、5xx 或明确无法连接时才会尝试下一个。超时或其他错误不会重复提交。</p>${message}<form method="post" action="/configure"><input type="hidden" name="csrf" value="${csrf}"><label>Mimo API Key</label><input name="mimo" type="password" autocomplete="off" required><label>Paddle OCR Token</label><input name="paddle" type="password" autocomplete="off" required>${gptFields('gpt_primary', 'GPT 主上游', true)}${gptFields('gpt_fallback_1', 'GPT 备用上游 1（可选）', false)}${gptFields('gpt_fallback_2', 'GPT 备用上游 2（可选）', false)}<button type="submit">配置并验证 Haika</button></form></html>`;
}
function parse(body) { return Object.fromEntries(new URLSearchParams(body)); }
function send(response, status, body) { response.writeHead(status, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Pragma':'no-cache','X-Content-Type-Options':'nosniff'}); response.end(body); }
function valid(value) { return typeof value === 'string' && value.length >= 8 && value.length <= 16384 && !/[\r\n\0]/.test(value); }
function gptProfile(values, prefix, required) {
  const base = String(values[prefix + '_base'] || '').trim();
  const key = String(values[prefix + '_key'] || '').trim();
  const model = String(values[prefix + '_model'] || '').trim();
  if (!base && !key && !required) return null;
  if (!/^https:\/\/.+/.test(base) || !valid(key) || !model || !/^[A-Za-z0-9._:-]{1,160}$/.test(model)) return false;
  return {base, key, model};
}
function configure(values) {
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', ['haika-niannian', "install -d -m 700 /etc/niannian-ai; umask 077; cat > /etc/niannian-ai/step01-hq.env; chmod 600 /etc/niannian-ai/step01-hq.env; install -d -m 755 /etc/systemd/system/niannian-ai.service.d; printf '%s\\n' '[Service]' 'EnvironmentFile=-/etc/niannian-ai/step01-hq.env' > /etc/systemd/system/niannian-ai.service.d/step01-hq.conf; chmod 644 /etc/systemd/system/niannian-ai.service.d/step01-hq.conf; systemctl daemon-reload; systemctl restart niannian-ai.service; systemctl is-active niannian-ai.service"], {stdio:['pipe','ignore','pipe'],windowsHide:true});
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += String(chunk).slice(-1000); });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error('ssh configuration failed: ' + code + ' ' + stderr.replace(/[\r\n]+/g, ' ').slice(-600))));
    child.stdin.end([
      'NIANNIAN_STEP01_HQ_PYTHON=/opt/niannian-step01-venv/bin/python',
      'NIANNIAN_STEP01_HQ_RUNNER=/opt/niannian-ai/bridge/niannian_step01_hq_runner.py',
      'NIANNIAN_STEP01_HQ_STEP01_SKILL_ROOT=/opt/niannian-step01-skills/mx-shortdrama-01-frame-extract',
      'NIANNIAN_STEP01_HQ_STEP02_SKILL_ROOT=/opt/niannian-step01-skills/mx-shortdrama-02-source-timeline',
      'MIMO_API_KEY=' + values.mimo,
      'PADDLEOCR_API_TOKEN=' + values.paddle,
      'NIANNIAN_STEP01_GPT_API_BASE_URL=' + values.primary.base,
      'NIANNIAN_STEP01_GPT_API_KEY=' + values.primary.key,
      'NIANNIAN_STEP01_GPT_MODEL=' + values.primary.model,
      ...(values.fallbacks[0] ? ['NIANNIAN_STEP01_GPT_FALLBACK_1_API_BASE_URL=' + values.fallbacks[0].base, 'NIANNIAN_STEP01_GPT_FALLBACK_1_API_KEY=' + values.fallbacks[0].key, 'NIANNIAN_STEP01_GPT_FALLBACK_1_MODEL=' + values.fallbacks[0].model] : []),
      ...(values.fallbacks[1] ? ['NIANNIAN_STEP01_GPT_FALLBACK_2_API_BASE_URL=' + values.fallbacks[1].base, 'NIANNIAN_STEP01_GPT_FALLBACK_2_API_KEY=' + values.fallbacks[1].key, 'NIANNIAN_STEP01_GPT_FALLBACK_2_MODEL=' + values.fallbacks[1].model] : []),
      ''
    ].join('\n'));
  });
}
const server = http.createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/') return send(response, 200, page());
  if (request.method !== 'POST' || request.url !== '/configure' || used) return send(response, 404, page('<p class="error">此一次性页面已失效。</p>'));
  let body = '';
  request.on('data', chunk => { body += chunk; if (body.length > 65536) request.destroy(); });
  request.once('end', async () => {
    const value = parse(body); body = '';
    const primary = gptProfile(value, 'gpt_primary', true);
    const fallbacks = [gptProfile(value, 'gpt_fallback_1', false), gptProfile(value, 'gpt_fallback_2', false)];
    if (value.csrf !== csrf || !valid(value.mimo) || !valid(value.paddle) || !primary || fallbacks.includes(false)) return send(response, 400, page('<p class="error">请完整填写主上游；备用上游要么全部留空，要么完整填写 HTTPS 地址、Key 和模型。</p>'));
    try { await configure({...value, primary, fallbacks}); used = true; send(response, 200, '<!doctype html><meta charset="utf-8"><title>已配置</title><p>Haika 配置已写入，服务已重启为 active。此本地页面将在 3 秒后关闭。</p>'); setTimeout(() => server.close(), 3000); }
    catch (error) { send(response, 502, page('<p class="error">配置未完成：' + String(error.message).replace(/[<>]/g, '') + '</p>')); }
  });
});
if (require.main === module) server.listen(port, host, () => process.stdout.write('http://' + host + ':' + port + '/\n'));

module.exports = {gptProfile, page};
