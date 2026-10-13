import { describe, expect, it } from 'vitest'
import { assessDeleteTarget, deleteTargetFromState, mergeResultLibraryItems } from './whiteboardStateOps'
import type { WhiteboardState } from './whiteboardTypes'
import type { CanvasAsset, LayerItem } from './lib/canvas'

const layer = (over: Partial<LayerItem> & { id: string }): LayerItem => ({
  name: over.id,
  visible: true,
  locked: false,
  opacity: 1,
  kind: 'asset',
  thumbnail: 'image',
  ...over,
})

const asset = (over: Partial<CanvasAsset> & { id: string; layerId: string }): CanvasAsset => ({
  name: over.id,
  url: 'data:image/png;base64,x',
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  ...over,
})

const state = (): WhiteboardState => ({
  strokes: [],
  canvasAssets: [
    asset({ id: 'a-free', layerId: 'l-free' }),
    asset({ id: 'a-locked', layerId: 'l-locked' }),
    asset({ id: 'a-bg', layerId: 'background' }),
  ],
  layers: [
    layer({ id: 'background', kind: 'background', locked: true }),
    layer({ id: 'drawing-layer-1', kind: 'drawing' }),
    layer({ id: 'l-free' }),
    layer({ id: 'l-locked', locked: true }),
  ],
  activeLayerId: 'drawing-layer-1',
  activeRatio: '16:9',
})

describe('assessDeleteTarget（删除可行性单一真相源，静默 no-op 根治）', () => {
  it('普通资产 → ok；锁定层 → locked；背景层 → background；不存在 → missing', () => {
    const s = state()
    expect(assessDeleteTarget(s, { kind: 'asset', id: 'a-free' })).toBe('ok')
    expect(assessDeleteTarget(s, { kind: 'asset', id: 'a-locked' })).toBe('locked')
    expect(assessDeleteTarget(s, { kind: 'asset', id: 'a-bg' })).toBe('background')
    expect(assessDeleteTarget(s, { kind: 'asset', id: 'ghost' })).toBe('missing')
  })

  it('deleteTargetFromState 与判定同源：非 ok 一律原样返回，ok 真删', () => {
    const s = state()
    expect(deleteTargetFromState(s, { kind: 'asset', id: 'a-locked' })).toBe(s)
    expect(deleteTargetFromState(s, { kind: 'asset', id: 'a-bg' })).toBe(s)
    const after = deleteTargetFromState(s, { kind: 'asset', id: 'a-free' })
    expect(after.canvasAssets.map((item) => item.id)).toEqual(['a-locked', 'a-bg'])
    expect(after.layers.some((item) => item.id === 'l-free')).toBe(false)
  })
})

describe('mergeResultLibraryItems（结果页签 IA 归位：已连线在前，画布成图去重补后）', () => {
  it('同一节点连了线就不再以「来自画布」重复出现；画布独有的标 fromCanvas', () => {
    const connected = [{ id: 'result:n1:r1', nodeId: 'n1', name: '连线图', url: 'u1' }]
    const canvas = [
      { id: 'canvas:n1:r1', nodeId: 'n1', name: '连线图', url: 'u1' },
      { id: 'canvas:n2:r2', nodeId: 'n2', name: '画布图', url: 'u2' },
    ]
    const merged = mergeResultLibraryItems(connected, canvas)
    expect(merged.map((item) => item.id)).toEqual(['result:n1:r1', 'canvas:n2:r2'])
    expect(merged[0].fromCanvas).toBeUndefined()
    expect(merged[1].fromCanvas).toBe(true)
  })
})
