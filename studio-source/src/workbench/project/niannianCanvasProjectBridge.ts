import type { LocalProjectSummary } from '../library/localProjectStore'
import { createDefaultWorkbenchProjectPayload, workbenchProjectPayloadSchema, type WorkbenchProjectPayload, type WorkbenchProjectRecordV1 } from './projectRecordSchema'
import { normalizePayload } from './projectNormalize'

const NIANNIAN_PROJECT_ID = /^NN-[A-Za-z0-9-]{4,116}$/
const CANVAS_SCHEMA_VERSION = 'niannian.canvas_document.v1'
const forbiddenDocumentKey = /^(?:api[_-]?key|access[_-]?key|private[_-]?key|token|authorization|cookie|secret|password)$/i
const signedUrlMarker = /(?:[?&](?:x-amz-signature|signature|token|expires)=|[?&]x-goog-signature=)/i

type NiannianProject = {
  id: string
  name: string
  createdAt?: string
}

type CanvasResponse = {
  canvas?: {
    schema_version?: string
    project_id?: string
    revision?: number
    document?: unknown
    updated_at?: string | null
  }
}

const revisions = new Map<string, number>()

export class NiannianCanvasProjectError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'NiannianCanvasProjectError'
    this.code = code
    this.status = status
  }
}

export function isNiannianCanvasProjectId(projectId: string): boolean {
  return NIANNIAN_PROJECT_ID.test(String(projectId || '').trim())
}

function canvasUrl(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/canvas`
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {credentials:'same-origin', ...init})
  } catch {
    throw new NiannianCanvasProjectError('CANVAS_NETWORK_UNAVAILABLE', '无法连接念念服务器，已保留本地画布缓存', 0)
  }
  let body: Record<string, unknown> = {}
  try { body = await response.json() as Record<string, unknown> } catch { /* handled below */ }
  if (!response.ok) {
    const code = typeof body.code === 'string' ? body.code : 'CANVAS_REQUEST_FAILED'
    const message = typeof body.error === 'string' ? body.error : (response.status === 401 ? '请先登录念念后打开项目画布' : '念念画布服务暂不可用')
    throw new NiannianCanvasProjectError(code, message, response.status)
  }
  return body as T
}

function timestamp(value: string | undefined): number {
  const parsed = value ? new Date(value).getTime() : Number.NaN
  return Number.isFinite(parsed) ? parsed : Date.now()
}

function remoteRecord(project: NiannianProject, canvas: NonNullable<CanvasResponse['canvas']>): WorkbenchProjectRecordV1 {
  if (canvas.schema_version !== CANVAS_SCHEMA_VERSION || canvas.project_id !== project.id || !Number.isSafeInteger(canvas.revision) || (canvas.revision ?? -1) < 0) {
    throw new NiannianCanvasProjectError('CANVAS_DOCUMENT_INVALID', '念念服务器返回的画布内容无效', 502)
  }
  const payload = canvas.document === null || canvas.document === undefined
    ? createDefaultWorkbenchProjectPayload()
    : normalizePayload(workbenchProjectPayloadSchema.parse(canvas.document))
  const createdAt = timestamp(project.createdAt)
  revisions.set(project.id, canvas.revision)
  return {
    id: project.id,
    name: project.name.trim() || '念念项目',
    createdAt,
    updatedAt: timestamp(canvas.updated_at || project.createdAt),
    savedAt: timestamp(canvas.updated_at || project.createdAt),
    revision: canvas.revision,
    version: 1,
    payload,
  }
}

export async function loadNiannianCanvasProject(projectId: string): Promise<WorkbenchProjectRecordV1> {
  const id = String(projectId || '').trim()
  if (!isNiannianCanvasProjectId(id)) throw new NiannianCanvasProjectError('CANVAS_PROJECT_ID_INVALID', '不是有效的念念项目 ID', 400)
  const [projectResponse, canvasResponse] = await Promise.all([
    requestJson<{project?: NiannianProject}>(`/api/projects/${encodeURIComponent(id)}`),
    requestJson<CanvasResponse>(canvasUrl(id)),
  ])
  if (!projectResponse.project || projectResponse.project.id !== id || !canvasResponse.canvas) {
    throw new NiannianCanvasProjectError('CANVAS_PROJECT_RESPONSE_INVALID', '念念项目数据不完整', 502)
  }
  return remoteRecord(projectResponse.project, canvasResponse.canvas)
}

function assertPersistableDocument(value: unknown, path = 'document', depth = 0): void {
  if (depth > 80) throw new NiannianCanvasProjectError('CANVAS_DOCUMENT_TOO_DEEP', '画布内容层级过深，未保存到服务器', 400)
  if (typeof value === 'string') {
    if (value.startsWith('file:') || signedUrlMarker.test(value)) throw new NiannianCanvasProjectError('CANVAS_DOCUMENT_PRIVATE_VALUE', '画布包含本地路径或临时签名地址，未保存到服务器', 400)
    return
  }
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPersistableDocument(item, `${path}[${index}]`, depth + 1))
    return
  }
  Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
    if (forbiddenDocumentKey.test(key)) throw new NiannianCanvasProjectError('CANVAS_DOCUMENT_PRIVATE_VALUE', `画布包含不允许同步的敏感字段：${path}.${key}`, 400)
    assertPersistableDocument(item, `${path}.${key}`, depth + 1)
  })
}

export async function saveNiannianCanvasProject(project: LocalProjectSummary, payload: WorkbenchProjectPayload): Promise<number> {
  if (!isNiannianCanvasProjectId(project.id)) throw new NiannianCanvasProjectError('CANVAS_PROJECT_ID_INVALID', '不是有效的念念项目 ID', 400)
  assertPersistableDocument(payload)
  const revision = revisions.get(project.id)
  if (!Number.isSafeInteger(revision) || revision === undefined) throw new NiannianCanvasProjectError('CANVAS_REVISION_MISSING', '画布尚未从念念服务器加载，未执行保存', 409)
  const response = await requestJson<CanvasResponse>(canvasUrl(project.id), {
    method: 'PUT',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({revision, document:payload}),
  })
  const canvas = response.canvas
  if (!canvas || canvas.schema_version !== CANVAS_SCHEMA_VERSION || canvas.project_id !== project.id || !Number.isSafeInteger(canvas.revision)) {
    throw new NiannianCanvasProjectError('CANVAS_SAVE_RESPONSE_INVALID', '念念服务器未确认画布保存', 502)
  }
  revisions.set(project.id, canvas.revision)
  return canvas.revision
}
