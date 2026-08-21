'use strict';

// MiniMax T2A (text-to-speech) adapter for the canvas audio node.
// Synchronous HTTP: one request returns the audio bytes directly.
// Docs: https://platform.minimaxi.com/document/T2A

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

function createMiniMaxT2AAdapter(options = {}) {
  const baseUrl = clean(options.baseUrl || process.env.MINIMAX_T2A_API_URL || 'https://api.minimax.chat');
  const apiKey = clean(options.apiKey || process.env.MINIMAX_T2A_API_KEY || '');
  const groupId = clean(options.groupId || process.env.MINIMAX_T2A_GROUP_ID || '');
  const submitEnabled = options.submitEnabled === true || String(process.env.MINIMAX_T2A_SUBMIT || '') === 'true';
  const defaultModel = clean(options.model || process.env.MINIMAX_T2A_MODEL || 'speech-02');
  const defaultVoiceId = clean(options.voiceId || process.env.MINIMAX_T2A_VOICE_ID || 'female-tianmei');
  const defaultSpeed = Number(options.speed ?? process.env.MINIMAX_T2A_SPEED ?? 1.0);
  const defaultVolume = Number(options.volume ?? process.env.MINIMAX_T2A_VOL ?? 1.0);
  const defaultPitch = Number(options.pitch ?? process.env.MINIMAX_T2A_PITCH ?? 0);
  const defaultOutputFormat = clean(options.outputFormat || process.env.MINIMAX_T2A_OUTPUT_FORMAT || 'mp3');
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = Number(options.timeoutMs || 60000);

  async function request(pathname, body) {
    if (!fetchImpl) throw adapterError('MINIMAX_T2A_FETCH_MISSING', 'MiniMax 语音适配器缺少网络请求能力');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(baseUrl + pathname, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg, application/json'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (cause) {
      const error = adapterError('MINIMAX_T2A_NETWORK_UNCERTAIN', '无法确认 MiniMax 语音生成状态');
      error.cause = cause;
      throw error;
    } finally {
      clearTimeout(timer);
    }
    const contentType = String(response.headers.get('content-type') || '');
    if (response.ok && contentType.includes('audio/')) {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) throw adapterError('MINIMAX_T2A_EMPTY_AUDIO', 'MiniMax 语音生成返回了空音频');
      return {audioBytes: bytes};
    }
    let payload = {};
    try { payload = await response.json(); } catch { /* non-json error body */ }
    const statusCode = payload?.base_resp?.status_code ?? 0;
    const statusMsg = String(payload?.base_resp?.status_msg || payload?.message || 'MiniMax 语音服务错误');
    throw adapterError(
      statusCode === 1004 ? 'MINIMAX_T2A_AUTH_FAILED' : 'MINIMAX_T2A_HTTP_' + response.status,
      statusCode === 1004 ? 'MiniMax 语音服务鉴权失败，请检查 API Key 与 GroupId' : statusMsg.slice(0, 160),
      response.status >= 500 ? 502 : 422
    );
  }

  function configured() {
    return Boolean(apiKey && groupId);
  }

  async function dryRun(task, inputs) {
    if (!configured()) throw adapterError('MINIMAX_T2A_NOT_CONFIGURED', 'MiniMax 语音渠道尚未配置，暂时不能提交。');
    const text = String(task?.prompt || '').trim();
    if (!text) throw adapterError('MINIMAX_T2A_PROMPT_REQUIRED', '语音节点需要输入要朗读的文本');
    if (text.length > 500) throw adapterError('MINIMAX_T2A_TEXT_TOO_LONG', 'MiniMax 单次语音合成最多 500 字符，请精简文本');
    return {channel: 'minimax-t2a', model: defaultModel, voiceId: defaultVoiceId};
  }

  async function submit(task, inputs) {
    if (!submitEnabled) throw adapterError('MINIMAX_T2A_SUBMIT_DISABLED', 'MiniMax 语音生成尚未启用，当前任务仅完成准备。');
    if (!configured()) throw adapterError('MINIMAX_T2A_NOT_CONFIGURED', 'MiniMax 语音渠道尚未配置，暂时不能提交。');
    const text = String(task?.prompt || '').trim();
    if (!text) throw adapterError('MINIMAX_T2A_PROMPT_REQUIRED', '语音节点需要输入要朗读的文本');
    if (text.length > 500) throw adapterError('MINIMAX_T2A_TEXT_TOO_LONG', 'MiniMax 单次语音合成最多 500 字符，请精简文本');
    const body = {
      model: String(task?.model || defaultModel),
      voice_id: String(task?.voiceId || defaultVoiceId),
      text,
      speed: Number(task?.speed ?? defaultSpeed),
      vol: Number(task?.volume ?? defaultVolume),
      pitch: Number(task?.pitch ?? defaultPitch),
      output_format: String(task?.outputFormat || defaultOutputFormat)
    };
    const result = await request('/v1/text_to_speech?GroupId=' + encodeURIComponent(groupId), body);
    return {
      taskId: 'local-' + crypto.randomUUID(),
      channel: 'minimax-t2a',
      payload: {model: body.model, voiceId: body.voice_id, outputFormat: body.output_format},
      audioBytes: result.audioBytes
    };
  }

  return {configured, dryRun, submit};
}

module.exports = {createMiniMaxT2AAdapter};
