'use strict';

const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const https = require('https');
const http = require('http');
const {URL} = require('url');
const {imageMime} = require('./niannian_runninghub_image_adapter');

const DEFAULT_BASE_URL = 'https://api.openlux.ai';

// Verified sizes for gpt-image-2-c via OpenLux.
// 4096x4096 returns ~2880x2880; 4096x2304 returns 3840x2160 (true 4K landscape).
const OPENLUX_ASPECT_RATIOS = Object.freeze(['1:1', '16:9', '9:16']);
const OPENLUX_OUTPUT_SIZES = Object.freeze({
  '1:1': '1024x1024',
  '16:9': '1536x1024',
  '9:16': '1024x1536'
});

function adapterError(code, message, httpStatus = 502) {
  const error = new Error(message || code);
  error.code = code;
  error.httpStatus = httpStatus;
  return error;
}

function configured(env) {
  return {
    baseUrl: String(env.OPENLUX_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, '') || DEFAULT_BASE_URL,
    apiKey: String(env.OPENLUX_API_KEY || '').trim()
  };
}

function ready(env) {
  const cfg = configured(env);
  return cfg.apiKey.length > 0 && /^https?:\/\//.test(cfg.baseUrl);
}

function requestJson(url, method, headers, body, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    const data = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;
    const req = transport.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        ...(headers || {}),
        ...(data ? {'Content-Type': 'application/json', 'Content-Length': data.length} : {})
      },
      timeout: timeoutMs
    }, (res) => {
      let chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        const text = raw.toString('utf8');
        if (res.statusCode >= 500) return reject(adapterError('OPENLUX_UPSTREAM_UNAVAILABLE', `OpenLux 服务暂时不可用 (${res.statusCode})`, 503));
        if (res.statusCode >= 400) {
          const err = adapterError('OPENLUX_SUBMISSION_REJECTED', `OpenLux 拒绝请求 (${res.statusCode})`, 422);
          err.providerCode = `http:${res.statusCode}`;
          try { err.providerBody = JSON.parse(text); } catch {}
          return reject(err);
        }
        try {
          resolve({statusCode: res.statusCode, body: JSON.parse(text)});
        } catch (e) {
          const err = adapterError('OPENLUX_OUTPUT_INVALID', 'OpenLux 返回非 JSON 响应', 502);
          err.providerBody = text.slice(0, 500);
          reject(err);
        }
      });
    });
    req.on('error', (e) => reject(adapterError('OPENLUX_NETWORK_UNCERTAIN', `OpenLux 请求异常: ${e.message}`)));
    req.on('timeout', () => { req.destroy(); reject(adapterError('OPENLUX_NETWORK_UNCERTAIN', 'OpenLux 请求超时')); });
    if (data) req.write(data);
    req.end();
  });
}

function validate(task, referenceFiles = [], cfg = {}) {
  const aspectRatio = String(task.aspect_ratio || task.aspectRatio || '1:1').trim();
  if (!OPENLUX_ASPECT_RATIOS.includes(aspectRatio)) {
    throw adapterError('OPENLUX_ASPECT_RATIO_INVALID', `OpenLux 不支持 ${aspectRatio} 比例`, 422);
  }
  const size = OPENLUX_OUTPUT_SIZES[aspectRatio];
  if (!cfg.apiKey) throw adapterError('OPENLUX_NOT_CONFIGURED', 'OpenLux API Key 尚未配置', 503);
  return {aspectRatio, size, referenceCount: referenceFiles.length, operation: referenceFiles.length > 0 ? 'edit' : 'generate'};
}

function createOpenluxImage2Adapter(options = {}) {
  const env = options.env || process.env;
  const cfg = configured(env);
  const tempRoot = String(options.tempRoot || path.join(os.tmpdir(), 'niannian-canvas-openlux'));

  async function dryRun(task, referenceFiles = []) {
    const preflight = validate(task, referenceFiles, cfg);
    return {payload: {model: 'gpt-image-2-c', size: preflight.size, referenceCount: preflight.referenceCount, operation: preflight.operation, provider: 'openlux'}};
  }

  async function submit(task, referenceFiles = []) {
    const preflight = await dryRun(task, referenceFiles);
    const id = crypto.randomUUID();
    await fsp.mkdir(tempRoot, {recursive: true});
    const outputPath = path.join(tempRoot, `${id}.png`);
    const receiptPath = path.join(tempRoot, `${id}.receipt.json`);

    try {
      const body = {
        model: 'gpt-image-2-c',
        prompt: String(task.prompt || ''),
        size: preflight.payload.size
      };
      if (referenceFiles.length > 0) {
        const refPath = referenceFiles[0];
        const bytes = await fsp.readFile(refPath);
        const mime = imageMime(bytes);
        if (!mime) throw adapterError('OPENLUX_REFERENCE_INVALID', '参考图格式无效', 422);
        body.image = `data:${mime};base64,${bytes.toString('base64')}`;
      }

      const url = `${cfg.baseUrl}/v1/images/generations`;
      const res = await requestJson(url, 'POST', {
        'Authorization': `Bearer ${cfg.apiKey}`,
        'Accept': 'application/json'
      }, body);

      const imageUrl = res.body?.data?.[0]?.url;
      if (!imageUrl) {
        const err = adapterError('OPENLUX_OUTPUT_MISSING', 'OpenLux 未返回图像 URL', 502);
        err.providerBody = res.body;
        throw err;
      }

      // Download the result image.
      const parsed = new URL(imageUrl);
      const transport = parsed.protocol === 'https:' ? https : http;
      await new Promise((resolve, reject) => {
        const req = transport.get(parsed, {timeout: 120000}, (res2) => {
          if (res2.statusCode !== 200) return reject(adapterError('OPENLUX_OUTPUT_MISSING', `图像下载失败 (${res2.statusCode})`, 502));
          const file = fs.createWriteStream(outputPath);
          res2.pipe(file);
          file.on('finish', () => { file.close(resolve); });
          file.on('error', reject);
        });
        req.on('error', (e) => reject(adapterError('OPENLUX_NETWORK_UNCERTAIN', `图像下载异常: ${e.message}`)));
        req.on('timeout', () => { req.destroy(); reject(adapterError('OPENLUX_NETWORK_UNCERTAIN', '图像下载超时')); });
      });

      await fsp.writeFile(receiptPath, JSON.stringify({status:'completed', url:imageUrl, createdAt:new Date().toISOString()}), 'utf8');
      return {taskId: `openlux-${id}`, payload: {outputPath, receiptPath}};
    } catch (error) {
      await Promise.all([outputPath, receiptPath].map(p => fsp.rm(p, {force:true}).catch(() => {})));
      throw error;
    }
  }

  async function query(taskId, payload) {
    const outputPath = String(payload?.outputPath || '');
    const receiptPath = String(payload?.receiptPath || '');
    if (!outputPath) throw adapterError('OPENLUX_OUTPUT_MISSING', 'OpenLux 图像结果不可读取');
    try {
      const bytes = await fsp.readFile(outputPath);
      imageMime(bytes);
      const result = {status: 'completed', inlineImages: [bytes.toString('base64')], imageUrls: []};
      await Promise.all([outputPath, receiptPath].map(p => fsp.rm(p, {force:true}).catch(() => {})));
      return result;
    } catch (e) {
      if (e?.code?.startsWith('OPENLUX_')) throw e;
      throw adapterError('OPENLUX_OUTPUT_MISSING', 'OpenLux 图像结果不可读取');
    }
  }

  return {dryRun, submit, query, ready, constants: {endpoint: `${cfg.baseUrl}/v1/images/generations`, model: 'gpt-image-2-c', aspectRatios: OPENLUX_ASPECT_RATIOS, outputSizes: OPENLUX_OUTPUT_SIZES}};
}

module.exports = {createOpenluxImage2Adapter, ready, configured};
