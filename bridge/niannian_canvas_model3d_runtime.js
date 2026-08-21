'use strict';

const crypto = require('crypto');
const path = require('path');
const {createHunyuan3DAdapter} = require('./niannian_hunyuan3d_adapter');

function runtimeError(code, message, httpStatus = 409) {
  const error = new Error(message || code);
  error.code = code;
  error.httpStatus = httpStatus;
  return error;
}

function publicFailure(error) {
  if (error?.code === 'HUNYUAN3D_NOT_CONFIGURED') return '混元 3D 渠道尚未配置，暂时不能提交。';
  if (error?.code === 'HUNYUAN3D_SUBMIT_DISABLED') return '混元 3D 生成尚未启用，当前任务仅完成准备。';
  if (error?.code === 'HUNYUAN3D_AUTH_FAILED') return '混元 3D 服务鉴权失败，请检查 API Key。';
  if (error?.code === 'HUNYUAN3D_NETWORK_UNCERTAIN') return '混元 3D 生成状态待确认，请稍后查看任务状态。';
  if (error?.code === 'HUNYUAN3D_PROMPT_TOO_LONG') return '描述超过 1024 字符上限，请精简后重试。';
  return '3D 模型生成暂未完成，请检查输入后重试。';
}

function failureCategory(error) {
  if (error?.code === 'HUNYUAN3D_NETWORK_UNCERTAIN') return 'network_uncertain';
  if (error?.code === 'HUNYUAN3D_NOT_CONFIGURED') return 'provider_configuration';
  if (error?.code === 'HUNYUAN3D_SUBMIT_DISABLED') return 'executor_configuration';
  if (error?.code === 'HUNYUAN3D_AUTH_FAILED') return 'provider_auth';
  return 'model3d_request';
}

function formatForMime(mime) {
  return ({
    'model/gltf-binary':'glb',
    'model/obj':'obj',
    'model/fbx':'fbx',
    'model/stl':'stl',
    'model/vnd.usdz+zip':'usdz',
    'application/octet-stream':'glb',
    'application/zip':'glb'
  })[String(mime || '').toLowerCase()] || null;
}

function formatForName(name) {
  const ext = path.extname(String(name || '')).toLowerCase().replace('.', '');
  return ['glb','obj','fbx','stl','usdz'].includes(ext) ? ext : null;
}

function createCanvasModel3DRuntime(options = {}) {
  const jobs = options.jobService;
  const assets = options.assetService;
  const adapter = options.adapter || createHunyuan3DAdapter(options.hunyuan3d || {});
  const enabled = options.enabled === true;
  if (!jobs || !assets) throw new Error('canvas model3d runtime requires job and asset services');

  function taskFor(job) {
    return {
      prompt: job.prompt,
      model: job.model || null,
      prompt_sha256: crypto.createHash('sha256').update(job.prompt || '', 'utf8').digest('hex')
    };
  }

  async function dryRun(job) {
    if (job.nodeType !== 'model3d') throw runtimeError('CANVAS_MODEL3D_NODE_INVALID', '当前任务不是 3D 模型任务', 422);
    return adapter.dryRun(taskFor(job), []);
  }

  async function submit(ownerId, projectId, jobId) {
    if (!enabled) throw runtimeError('CANVAS_PROVIDER_SUBMIT_DISABLED', '3D 生成尚未启用，当前任务仅完成准备。');
    const job = await jobs.getOwned(ownerId, projectId, jobId);
    if (!job) throw runtimeError('CANVAS_JOB_NOT_FOUND', '任务不存在', 404);
    if (job.nodeType !== 'model3d') throw runtimeError('CANVAS_MODEL3D_NODE_INVALID', '当前任务不是 3D 模型任务', 422);
    if (job.providerTaskId) return job;
    const retryableFailure = !job.providerTaskId && ['failed','review'].includes(job.status);
    if (job.status !== 'awaiting_authorization' && !retryableFailure) throw runtimeError('CANVAS_JOB_STATE_INVALID', '当前任务不能重复提交', 409);
    await jobs.updateOwned(ownerId, projectId, jobId, {status:'queued',providerSubmitState:'submitting',publicError:null});
    try {
      const submitted = await adapter.submit(taskFor(job), []);
      return await jobs.updateOwned(ownerId, projectId, jobId, {status:'queued',providerSubmitState:'accepted',providerTaskId:submitted.taskId,providerPayload:submitted.payload,publicError:null});
    } catch (error) {
      const unknown = error?.code === 'HUNYUAN3D_NETWORK_UNCERTAIN';
      return await jobs.updateOwned(ownerId, projectId, jobId, {
        status: unknown ? 'review' : 'failed',
        providerSubmitState: unknown ? 'uncertain' : 'failed',
        failureCategory: failureCategory(error),
        providerErrorCode: error?.code || null,
        publicError: publicFailure(error)
      }).then(() => { throw error; });
    }
  }

  async function reconcile(ownerId, projectId, jobId) {
    const job = await jobs.getOwned(ownerId, projectId, jobId);
    if (!job) throw runtimeError('CANVAS_JOB_NOT_FOUND', '任务不存在', 404);
    if (job.nodeType !== 'model3d' || !job.providerTaskId || ['succeeded','failed'].includes(job.status)) return job;
    try {
      const result = await adapter.query(job.providerTaskId);
      if (result.status === 'generating') return await jobs.updateOwned(ownerId, projectId, jobId, {status:'running',providerSubmitState:'running',publicError:null});
      if (result.status === 'failed') return await jobs.updateOwned(ownerId, projectId, jobId, {status:'failed',providerSubmitState:'failed',failureCategory:'provider_request',publicError:'混元 3D 生成失败，请调整描述后重试。'});
      const outputAssetIds = [];
      for (const fileUrl of result.files || []) {
        const media = await adapter.download(fileUrl);
        let format = formatForMime(media.mime);
        if (!format) format = formatForName(media.originalName || fileUrl);
        if (!format) throw runtimeError('CANVAS_MODEL3D_OUTPUT_INVALID', '3D 模型输出格式无效', 502);
        const stored = await assets.registerBuffer({
          ownerId: job.ownerId, projectId: job.projectId, projectKind: job.projectKind,
          kind: 'generated_model3d', format, bytes: media.bytes,
          originalName: media.originalName || `canvas-model3d-${job.id.slice(-8)}.${format}`
        });
        outputAssetIds.push(stored.asset.id);
      }
      if (!outputAssetIds.length) throw runtimeError('CANVAS_MODEL3D_OUTPUT_MISSING', '3D 模型生成尚未返回结果', 502);
      return await jobs.updateOwned(ownerId, projectId, jobId, {status:'succeeded',providerSubmitState:'completed',outputAssetIds:[...new Set(outputAssetIds)],publicError:null,completedAt:new Date().toISOString()});
    } catch (error) {
      if (error?.code === 'HUNYUAN3D_NETWORK_UNCERTAIN') return await jobs.updateOwned(ownerId, projectId, jobId, {status:'review',providerSubmitState:'uncertain',failureCategory:'network_uncertain',providerErrorCode:error?.code || null,publicError:publicFailure(error)});
      return await jobs.updateOwned(ownerId, projectId, jobId, {status:'failed',providerSubmitState:'failed',failureCategory:failureCategory(error),providerErrorCode:error?.code || null,publicError:publicFailure(error)});
    }
  }

  return {enabled, dryRun, submit, reconcile};
}

module.exports = {createCanvasModel3DRuntime, formatForMime};
