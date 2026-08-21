'use strict';

/**
 * 画布「豆包 Seedance 2.0 Fast」视频 runtime。
 *
 * 调用本地豆包视频网关（doubao-video-service, FastAPI 9191）：
 *   POST /api/v1/submit  {prompt, model, duration, aspect_ratio, directMode}
 *   GET  /api/v1/status?task_id=
 * 网关通过豆包工作室（CDP + IPC 添加任务 + 内嵌 pw 分两次发送）自动完成
 * 视频生成，并把成片下载到本地下载目录。runtime 在 succeeded 后读取
 * video_path 本地文件注册为 generated_video 资产（无需再下载）。
 */

const {isDoubaoVideoChannel} = require('./niannian_canvas_video_channels');

const DEFAULT_BASE_URL = 'http://127.0.0.1:9191';
const MODEL = 'seedance-2.0-fast';
const CHANNEL_ID = 'doubao-seedance-2-0-fast';
const DEFAULT_DURATION_SECONDS = 15;

function runtimeError(code, message, httpStatus = 409) {
  const error = new Error(message || code);
  error.code = code;
  error.httpStatus = httpStatus;
  return error;
}

function failureCategory(error) {
  const code = String(error?.code || '');
  if (code.includes('NETWORK_UNCERTAIN')) return 'network_uncertain';
  if (/^DOUBAO_INPUT_|^DOUBAO_API_URL/.test(code)) return 'reference_upload';
  if (/^DOUBAO_READ_|^DOUBAO_OUTPUT_/.test(code)) return 'output_validation';
  if (code === 'DOUBAO_API_NOT_CONFIGURED') return 'provider_configuration';
  return 'provider_request';
}

function publicFailure(error) {
  const category = failureCategory(error);
  if (category === 'network_uncertain') return '豆包提交状态待确认，请稍后查看当前任务。';
  if (category === 'reference_upload') return '豆包素材读取或提交失败，请检查素材。';
  if (category === 'output_validation') return '豆包返回的成片无法读取，请稍后重试。';
  if (category === 'provider_configuration') return '豆包渠道尚未完成服务器配置，当前任务仅完成准备。';
  return '豆包未接受当前视频请求，请检查提示词和素材后重试。';
}

function createCanvasDoubaoRuntime(options = {}) {
  const jobs = options.jobService;
  const assets = options.assetService;
  const enabled = options.enabled === true;
  const baseUrl = String(options.baseUrl || options.doubao?.baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, '') || DEFAULT_BASE_URL;
  const submissionsInFlight = new Map();
  if (!jobs || !assets) throw new Error('canvas Doubao runtime requires job and asset services');

  function assertDoubaoJob(job) {
    if (job.nodeType !== 'video' || !isDoubaoVideoChannel(job.videoChannel)) throw runtimeError('CANVAS_DOUBAO_JOB_INVALID', '当前任务不是豆包视频任务', 422);
    if (job.durationSeconds && job.durationSeconds > DEFAULT_DURATION_SECONDS) {
      throw runtimeError('CANVAS_DOUBAO_DURATION_REQUIRED', '豆包 Seedance 2.0 Fast 仅支持 15 秒视频', 422);
    }
  }

  async function apiRequest(path, options2 = {}) {
    const url = `${baseUrl}${path}`;
    let res;
    try {
      res = await fetch(url, options2);
    } catch (error) {
      error.code = error.cause?.code === 'ECONNREFUSED' || /ECONNREFUSED|ENOTFOUND|EAI_AGAIN/.test(String(error.message))
        ? 'DOUBAO_API_NOT_CONFIGURED'
        : 'NETWORK_UNCERTAIN';
      throw error;
    }
    let payload = null;
    try { payload = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok) throw runtimeError('DOUBAO_API_REQUEST_FAILED', `豆包网关请求失败（${res.status}）${payload?.detail ? ': ' + String(payload.detail).slice(0, 120) : ''}`, res.status);
    return payload;
  }

  async function dryRun(job) {
    assertDoubaoJob(job);
    if (!enabled) throw runtimeError('CANVAS_PROVIDER_SUBMIT_DISABLED', '豆包视频生成尚未启用，当前任务仅完成准备。');
    return {channel: CHANNEL_ID, durationSeconds: DEFAULT_DURATION_SECONDS, aspectRatio: job.aspectRatio || '9:16'};
  }

  async function submitOnce(ownerId, projectId, jobId) {
    if (!enabled) throw runtimeError('CANVAS_PROVIDER_SUBMIT_DISABLED', '豆包视频生成尚未启用，当前任务仅完成准备。');
    const job = await jobs.getOwned(ownerId, projectId, jobId);
    if (!job) throw runtimeError('CANVAS_JOB_NOT_FOUND', '任务不存在', 404);
    assertDoubaoJob(job);
    if (job.providerTaskId) return job;
    const retryable = job.status === 'failed' && !job.providerTaskId && job.providerSubmitState === 'failed';
    if (job.status !== 'awaiting_authorization' && !retryable) throw runtimeError('CANVAS_JOB_STATE_INVALID', '当前任务不能重复提交', 409);
    await jobs.updateOwned(ownerId, projectId, jobId, {status: 'queued', providerSubmitState: 'submitting', publicError: null});
    try {
      const submitted = await apiRequest('/api/v1/submit', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          prompt: job.prompt,
          model: MODEL,
          duration: DEFAULT_DURATION_SECONDS,
          aspect_ratio: job.aspectRatio || '9:16',
          directMode: 'direct'
        })
      });
      const providerTaskId = String(submitted.task_id || submitted.taskId || job.id);
      return await jobs.updateOwned(ownerId, projectId, jobId, {
        status: 'queued',
        providerSubmitState: 'accepted',
        providerTaskId,
        providerChannel: CHANNEL_ID,
        providerPayload: {gatewayTaskId: providerTaskId},
        publicError: null
      });
    } catch (error) {
      const uncertain = String(error?.code || '').includes('NETWORK_UNCERTAIN');
      await jobs.updateOwned(ownerId, projectId, jobId, {
        status: uncertain ? 'review' : 'failed',
        providerSubmitState: uncertain ? 'uncertain' : 'failed',
        failureCategory: failureCategory(error),
        publicError: publicFailure(error)
      });
      throw error;
    }
  }

  function submit(ownerId, projectId, jobId) {
    const key = [ownerId, projectId, jobId].join(':');
    if (submissionsInFlight.has(key)) return submissionsInFlight.get(key);
    const pending = submitOnce(ownerId, projectId, jobId);
    submissionsInFlight.set(key, pending);
    void pending.finally(() => submissionsInFlight.delete(key)).catch(() => {});
    return pending;
  }

  async function reconcile(ownerId, projectId, jobId) {
    const job = await jobs.getOwned(ownerId, projectId, jobId);
    if (!job) throw runtimeError('CANVAS_JOB_NOT_FOUND', '任务不存在', 404);
    if (job.nodeType !== 'video' || !isDoubaoVideoChannel(job.videoChannel) || !job.providerTaskId || ['succeeded', 'failed', 'review'].includes(job.status)) return job;
    try {
      const result = await apiRequest(`/api/v1/status?task_id=${encodeURIComponent(job.providerTaskId)}`);
      const state = String(result.status || '');
      if (state === 'running') return await jobs.updateOwned(ownerId, projectId, jobId, {status: 'running', providerSubmitState: 'running', publicError: null});
      if (state === 'failed') return await jobs.updateOwned(ownerId, projectId, jobId, {status: 'failed', providerSubmitState: 'failed', failureCategory: 'provider_request', publicError: String(result.error || '豆包视频任务失败，请检查提示词后重试。')});
      if (state !== 'succeeded') return job;
      const videoPath = result?.result?.video_path || result?.video_path;
      if (!videoPath) throw runtimeError('DOUBAO_OUTPUT_MISSING', '豆包任务完成但未返回视频文件路径');
      const fs = require('node:fs');
      if (!fs.existsSync(videoPath)) throw runtimeError('DOUBAO_OUTPUT_MISSING', `豆包视频文件不存在：${videoPath}`);
      const bytes = fs.readFileSync(videoPath);
      const format = String(videoPath).split('.').pop()?.toLowerCase() || 'mp4';
      const stored = await assets.registerBuffer({
        ownerId: job.ownerId,
        projectId: job.projectId,
        projectKind: job.projectKind,
        kind: 'generated_video',
        format,
        bytes,
        originalName: `doubao-seedance-${job.id.slice(-8)}.${format}`
      });
      return await jobs.updateOwned(ownerId, projectId, jobId, {
        status: 'succeeded',
        providerSubmitState: 'completed',
        outputAssetIds: [stored.asset.id],
        providerMedia: {bytes: bytes.length, format, sourcePath: videoPath},
        publicError: null,
        completedAt: new Date().toISOString()
      });
    } catch (error) {
      const uncertain = String(error?.code || '').includes('NETWORK_UNCERTAIN');
      return await jobs.updateOwned(ownerId, projectId, jobId, {
        status: uncertain ? 'review' : 'failed',
        providerSubmitState: uncertain ? 'uncertain' : 'failed',
        failureCategory: failureCategory(error),
        publicError: publicFailure(error)
      });
    }
  }

  return {enabled, dryRun, submit, reconcile};
}

module.exports = {createCanvasDoubaoRuntime, failureCategory, publicFailure, DEFAULT_BASE_URL};
