// 病模型沉底/灰化的判定（2026-07-30 拍板）。核心是**别误伤**：下拉一条 = 去重后的模型，
// 底下可能挂 2-4 家供应商；只要还有一家健康就该走那家、整条不算病。
// 判据以 AilingProbe 注入 → 纯函数直测，不引 React 测试库、不碰 localStorage。
import { describe, expect, it } from 'vitest'
import { buildModelSelectOptions, pickHealthiestProvider } from './useDedupedModelSelect'
import { dedupeModelOptions } from '../../config/modelIdentity'
import type { ModelOption } from '../../config/models'

function option(modelKey: string, vendor: string, label: string): ModelOption {
  return { value: `${vendor}:${modelKey}`, label, modelKey, vendor, kind: 'image' } as ModelOption
}
const ailing = (...keys: string[]) => (modelKey: string) => keys.includes(modelKey)
const healthy = () => false

describe('buildModelSelectOptions — 病模型沉底 + 灰化', () => {
  it('全家都病 → 沉到最后 + 灰化 + 右侧标注换成「最近多次失败」', () => {
    const deduped = dedupeModelOptions([
      option('imagen-4.0-apimart', 'apimart', 'Imagen 4'),
      option('z-image-turbo', 'apimart', 'Z-Image Turbo'),
    ])
    const view = buildModelSelectOptions(deduped, ailing('imagen-4.0-apimart'))

    const last = view[view.length - 1]
    expect(last.label).toBe('Imagen 4')
    expect(last.dimmed).toBe(true)
    expect(last.trailing).toBe('最近多次失败')
    expect(last.trailingTone).toBe('danger')
    // 健康的保持原序、不被打标、仍显示厂商名。
    expect(view[0].label).toBe('Z-Image Turbo')
    expect(view[0].dimmed).toBeUndefined()
    expect(view[0].trailing).toBe('APIMart')
  })

  it('多家里只病一家 → 整条**不算病**（否则「N 家」里一家挂就误伤整个模型）', () => {
    const deduped = dedupeModelOptions([
      option('nano-banana-apimart', 'apimart', 'Nano Banana'),
      option('nano-banana-kie', 'kie', 'Nano Banana'),
    ])
    const view = buildModelSelectOptions(deduped, ailing('nano-banana-apimart'))

    expect(view).toHaveLength(1)
    expect(view[0].dimmed).toBeUndefined()
    expect(view[0].trailing).toBe('2 家')
  })

  it('全healthy 时顺序与打标一律不动（避让机制不该影响常态）', () => {
    const deduped = dedupeModelOptions([option('a', 'apimart', 'A'), option('b', 'kie', 'B')])
    const view = buildModelSelectOptions(deduped, healthy)
    expect(view.map((o) => o.label)).toEqual(['A', 'B'])
    expect(view.some((o) => o.dimmed)).toBe(false)
  })
})

describe('pickHealthiestProvider — 换家优先于换模型', () => {
  it('跳过病供应商，落到健康那家', () => {
    const [model] = dedupeModelOptions([
      option('nano-banana-apimart', 'apimart', 'Nano Banana'),
      option('nano-banana-kie', 'kie', 'Nano Banana'),
    ])
    expect(pickHealthiestProvider(model, ailing('nano-banana-apimart'))?.vendor).toBe('kie')
  })

  it('全病也绝不空选：用户明知故选时仍回退到某一家', () => {
    const [model] = dedupeModelOptions([option('only', 'apimart', '独苗')])
    expect(pickHealthiestProvider(model, ailing('only'))?.option.value).toBe('apimart:only')
  })
})
