'use strict';

// Hunyuan 3D (腾讯混元生3D) adapter for the canvas model3d node.
// OpenAI-compatible async API: submit returns JobId, query returns status.
// Docs: https://cloud.tencent.com/document/product/862/126189

const crypto = require('crypto');

function adapterError(code, message, httpStatus = 502) {
  const error = new Error(message || code);
  error.code = code;
  error.httpStatus = httpStatus;
  return error;
}

function clean(value, limit = 200) {
  return String(value == null ? '' : value).trim().slice(0, limit);
}

function createHunyuan3DAdapter(options = {}) {
  const baseUrl = clean(options.baseUrl || process.env.HUNYUAN3D_API_URL || 'https://api.ai3d.cloud.tencent.com');
  const apiKey = clean(options.apiKey || process.env.HUNYUAN3D_API_KEY || '');
  const submitEnabled = options.submitEnabled === true || String(process.env.HUNYUAN3D_SUBMIT || '') === 'true';
  const defaultModel = clean(options.model || process.env.HUNYUAN3D_MODEL || '3.0');
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = Number(options.timeoutMs || 60000);

  async function request(pathname, body) {
    if (!fetchImpl) throw adapterError('HUNYUAN3D_FETCH_MISSING', '混元 3D 适配器缺少网络请求能力');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(baseUrl + pathname, {
        method: 'POST',
        headers: {'Authorization': apiKey, 'Content-Type': 'application/json'},
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (cause) {
      const error = adapterError('HUNYUAN3D_NETWORK_UNCERTAIN', '无法确认混元 3D 生成状态');
      error.cause = cause;
      throw error;
    } finally {
      clearTimeout(timer);
    }
    let payload = {};
    try { payload = await response.json(); } catch { /* non-json */ }
    if (!response.ok || payload.Error) {
      const message = String(payload?.Error?.Message || payload?.message || payload?.Error?.Code || '混元 3D 服务错误').slice(0, 160);
      throw adapterError(payload?.Error?.Code === 'AuthFailure' ? 'HUNYUAN3D_AUTH_FAILED' : 'HUNYUAN3D_HTTP_' + response.status, message, response.status >= 500 ? 502 : 422);
    }
    return payload;
  }

  function configured() {
    return Boolean(apiKey);
  }

  async function dryRun(task, inputs) {
    if (!configured()) throw adapterError('HUNYUAN3D_NOT_CONFIGURED', '混元 3D 渠道尚未配置，暂时不能提交。');
    const prompt = String(task?.prompt || '').trim();
    if (!prompt) throw adapterError('HUNYUAN3D_PROMPT_REQUIRED', '3D 模型节点需要输入描述文本');
    if (prompt.length > 1024) throw adapterError('HUNYUAN3D_PROMPT_TOO_LONG', '混元 3D 描述最多 1024 字符，请精简');
    return {channel: 'hunyuan3d', model: defaultModel};
  }

  async function submit(task, inputs) {
    if (!submitEnabled) throw adapterError('HUNYUAN3D_SUBMIT_DISABLED', '混元 3D 生成尚未启用，当前任务仅完成准备。');
    if (!configured()) throw adapterError('HUNYUAN3D_NOT_CONFIGURED', '混元 3D 渠道尚未配置，暂时不能提交。');
    const prompt = String(task?.prompt || '').trim();
    if (!prompt) throw adapterError('HUNYUAN3D_PROMPT_REQUIRED', '3D 模型节点需要输入描述文本');
    if (prompt.length > 1024) throw adapterError('HUNYUAN3D_PROMPT_TOO_LONG', '混元 3D 描述最多 1024 字符，请精简');
    const payload = await request('/v1/ai3d/submit', {
      Prompt: prompt,
      Model: String(task?.model || defaultModel)
    });
    const jobId = String(payload?.JobId || '').trim();
    if (!jobId) throw adapterError('HUNYUAN3D_TASK_ID_MISSING', '混元 3D 未返回任务标识');
    return {taskId: jobId, channel: 'hunyuan3d', payload: {model: String(task?.model || defaultModel)}};
  }

  async function query(taskId) {
    if (!configured()) throw adapterError('HUNYUAN3D_NOT_CONFIGURED', '混元 3D 渠道尚未配置');
    const id = String(taskId || '').trim();
    if (!id) throw adapterError('HUNYUAN3D_TASK_ID_INVALID', '混元 3D 任务标识无效', 422);
    const payload = await request('/v1/ai3d/query', {JobId: id});
    const status = String(payload?.Status || '').toUpperCase();
    if (['WAIT', 'RUN'].includes(status)) return {status: 'generating'};
    if (status === 'FAIL') return {status: 'failed', errorCode: String(payload?.ErrorCode || ''), errorMessage: String(payload?.ErrorMessage || '混元 3D 任务失败')};
    if (status === 'DONE') {
      const files = Array.isArray(payload?.ResultFile3Ds) ? payload.ResultFile3Ds.map(item => String(item?.Url || item || '').trim()).filter(Boolean) : [];
      if (!files.length) return {status: 'generating'};
      return {status: 'completed', files};
    }
    throw adapterError('HUNYUAN3D_STATUS_INVALID', '混元 3D 返回了未知任务状态');
  }

  async function download(url) {
    if (!fetchImpl) throw adapterError('HUNYUAN3D_FETCH_MISSING', '混元 3D 适配器缺少网络请求能力');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(url, {method: 'GET', signal: controller.signal});
    } catch (cause) {
      const error = adapterError('HUNYUAN3D_DOWNLOAD_NETWORK_UNCERTAIN', '无法确认混元 3D 模型下载状态');
      error.cause = cause;
      throw error;
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw adapterError('HUNYUAN3D_DOWNLOAD_FAILED', '混元 3D 模型下载失败', 502);
    const bytes = Buffer.from(await response.arrayBuffer());
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const disposition = String(response.headers.get('content-disposition') || '');
    const mime = contentType.split(';')[0].trim();
    const nameMatch = /filename="?([^";]+)"?/.exec(disposition);
    const originalName = nameMatch ? nameMatch[1] : null;
    return {bytes, mime, originalName};
  }

  return {configured, dryRun, submit, query, download};
}

module.exports = {createHunyuan3DAdapter};
