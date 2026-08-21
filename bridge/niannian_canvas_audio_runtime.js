'use strict';

const crypto = require('crypto');
const {createMiniMaxT2AAdapter} = require('./niannian_minimax_t2a_adapter');

function runtimeError(code, message, httpStatus = 409) {
  const error = new Error(message || code);
  error.code = code;
  error.httpStatus = httpStatus;
  return error;
}

function publicFailure(error) {
  if (error?.code === 'MINIMAX_T2A_NOT_CONFIGURED') return 'MiniMax 语音渠道尚未配置，暂时不能提交。';
  if (error?.code === 'MINIMAX_T2A_SUBMIT_DISABLED') return 'MiniMax 语音生成尚未启用，当前任务仅完成准备。';
  if (error?.code === 'MINIMAX_T2A_AUTH_FAILED') return 'MiniMax 语音服务鉴权失败，请检查 API Key 与 GroupId。';
  if (error?.code === 'MINIMAX_T2A_NETWORK_UNCERTAIN') return 'MiniMax 语音生成状态待确认，请稍后查看任务状态。';
  if (error?.code === 'MINIMAX_T2A_TEXT_TOO_LONG') return '文本超过 500 字符上限，请精简后重试。';
  return '语音生成暂未完成，请检查输入后重试。';
}

function failureCategory(error) {
  if (error?.code === 'MINIMAX_T2A_NETWORK_UNCERTAIN') return 'network_uncertain';
  if (error?.code === 'MINIMAX_T2A_NOT_CONFIGURED') return 'provider_configuration';
  if (error?.code === 'MINIMAX_T2A_SUBMIT_DISABLED') return 'executor_configuration';
  if (error?.code === 'MINIMAX_T2A_AUTH_FAILED') return 'provider_auth';
  return 'audio_request';
}

function formatForMime(mime) {
  return ({'audio/mpeg':'mp3','audio/wav':'wav','audio/ogg':'ogg','audio/mp4':'m4a'})[String(mime || '').toLowerCase()] || null;
}

function createCanvasAudioRuntime(options = {}) {
  const jobs = options.jobService;
  const assets = options.assetService;
  const adapter = options.adapter || createMiniMaxT2AAdapter(options.minimax || {});
  const enabled = options.enabled === true;
  if (!jobs || !assets) throw new Error('canvas audio runtime requires job and asset services');

  function taskFor(job) {
    return {
      prompt: job.prompt,
      model: job.model || null,
      voiceId: job.audioVoiceId || job.voiceId || null,
      speed: job.audioSpeed ?? null,
      volume: job.audioVolume ?? null,
      pitch: job.audioPitch ?? null,
      outputFormat: job.audioFormat || 'mp3',
      prompt_sha256: crypto.createHash('sha256').update(job.prompt || '', 'utf8').digest('hex')
    };
  }

  async function dryRun(job) {
    if (job.nodeType !== 'audio') throw runtimeError('CANVAS_AUDIO_NODE_INVALID', '当前任务不是语音生成任务', 422);
    return adapter.dryRun(taskFor(job), []);
  }

  async function submit(ownerId, projectId, jobId) {
    if (!enabled) throw runtimeError('CANVAS_PROVIDER_SUBMIT_DISABLED', '语音生成尚未启用，当前任务仅完成准备。');
    const job = await jobs.getOwned(ownerId, projectId, jobId);
    if (!job) throw runtimeError('CANVAS_JOB_NOT_FOUND', '任务不存在', 404);
    if (job.nodeType !== 'audio') throw runtimeError('CANVAS_AUDIO_NODE_INVALID', '当前任务不是语音生成任务', 422);
    if (job.providerTaskId) return job;
    const retryableFailure = !job.providerTaskId && ['failed','review'].includes(job.status);
    if (job.status !== 'awaiting_authorization' && !retryableFailure) throw runtimeError('CANVAS_JOB_STATE_INVALID', '当前任务不能重复提交', 409);
    await jobs.updateOwned(ownerId, projectId, jobId, {status:'queued',providerSubmitState:'submitting',publicError:null});
    try {
      const submitted = await adapter.submit(taskFor(job), []);
      if (!submitted.audioBytes?.length) throw runtimeError('CANVAS_AUDIO_OUTPUT_MISSING', '语音生成尚未返回音频', 502);
      const format = formatForMime('audio/mpeg') || 'mp3';
      const stored = await assets.registerBuffer({
        ownerId: job.ownerId, projectId: job.projectId, projectKind: job.projectKind,
        kind: 'generated_audio', format, bytes: submitted.audioBytes,
        originalName: `canvas-audio-${job.id.slice(-8)}.mp3`
      });
      return await jobs.updateOwned(ownerId, projectId, jobId, {
        status: 'succeeded', providerSubmitState: 'completed',
        providerTaskId: submitted.taskId, providerPayload: submitted.payload,
        outputAssetIds: [stored.asset.id], publicError: null,
        completedAt: new Date().toISOString()
      });
    } catch (error) {
      const unknown = error?.code === 'MINIMAX_T2A_NETWORK_UNCERTAIN';
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
    if (job.nodeType !== 'audio' || !job.providerTaskId || ['succeeded','failed'].includes(job.status)) return job;
    return job;
  }

  return {enabled, dryRun, submit, reconcile};
}

module.exports = {createCanvasAudioRuntime, formatForMime};
