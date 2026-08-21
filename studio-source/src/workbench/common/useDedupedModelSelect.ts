// 去重模型选择 view-model（单一真相，节点/镜卡共用 —— P1 消除三处选模型不一致）。
//
// 把平铺的 ModelOption[] 收成「按 canonical 身份去重」的两段式选择：
//   ① 模型下拉：同模型只一条，>1 家供应商标「N 家」；选中=自动选最优供应商（写其 value）。
//   ② 供应商下拉：仅当选中模型有多家可用时出现，让用户锁定某家（写该家 value）。
// 节点仍存 (vendor, modelKey)，生成路径与失败换家逻辑不变 —— 去重纯发生在选择层。
import React from 'react'
import type { ModelOption } from '../../config/models'
import type { NomiSelectOption } from '../../design'
import i18n from '../../i18n'
import { dedupeModelOptions, resolveBestProvider, type DedupedModel } from '../../config/modelIdentity'
import { isModelRecentlyAiling } from '../generationCanvas/runner/modelHealthMemory'

import type { ModelProviderRef } from '../../config/modelIdentity'

const VENDOR_LABELS: Record<string, string> = {
  volcengine: '火山方舟',
  'volcengine-speech': '火山语音',
  modelscope: '魔搭',
  apimart: 'APIMart',
  kie: 'Kie',
  newapi: 'new-api',
  runninghub: 'RunningHub',
  agnes: 'Agnes',
  replicate: 'Replicate',
  dreamina: '即梦',
  'comfyui-local': '本地 ComfyUI',
}

/** 厂商显示名：内置短名映射（下拉附注要短）> option.vendorName（自定义中转的真名）> key 原样。
 *  短名优先：catalog 里内置家的 name 是接入卡全称（如「即梦会员（本地 CLI）」），当 trailing 太啰嗦。 */
function providerLabel(provider?: ModelProviderRef | null): string {
  if (!provider) return '默认'
  const short = provider.vendor ? VENDOR_LABELS[provider.vendor.toLowerCase()] : undefined
  if (short) return short
  const fromCatalog = provider.option.vendorName?.trim()
  if (fromCatalog) return fromCatalog
  return provider.vendor || '默认'
}

/** 该模型是否「病」了：**每一家**供应商都在避让期才算。注入判据便于纯函数单测。 */
type AilingProbe = (modelKey: string) => boolean

/**
 * 「病」= 该模型每一家供应商近 24h 都连败 ≥2（modelHealthMemory 记的本地实测经验，不是写死名单；
 * 服务商修好后成功一次即清零回位）。
 *
 * 必须是**供应商级**而不是模型级：下拉里一条 = 去重后的模型，底下可能挂 2-4 家。只要还有一家健康，
 * pickHealthiestProvider 就会走那家，整条不该被标病——否则 Nano Banana「3 家」里一家挂了就误伤整个模型。
 */
function isModelAiling(model: DedupedModel, isAiling: AilingProbe): boolean {
  if (model.providers.length === 0) return false
  return model.providers.every((p) => isAiling(p.option.modelKey || p.option.value))
}

/** 病的沉到最后 + 灰化 + 右侧标注换成「最近多次失败」；健康的保持原有顺序不动。 */
export function buildModelSelectOptions(deduped: readonly DedupedModel[], isAiling: AilingProbe): NomiSelectOption[] {
  const toOption = (m: DedupedModel): NomiSelectOption => {
    // 厂商标注（用户 2026-07-17：模型来自哪家要看得见）：多家=「N 家」，单家=厂商短名。
    const origin = m.providers.length > 1 ? `${m.providers.length} 家` : providerLabel(m.providers[0])
    if (!isModelAiling(m, isAiling)) return { value: m.canonicalId, label: m.label, trailing: origin }
    return {
      value: m.canonicalId,
      label: m.label,
      trailing: i18n.t('generationCommon.parameters.recentlyFailing'),
      trailingTone: 'danger',
      dimmed: true,
    }
  }
  // 用户选**之前**就避开坏的，而不是撞了才知道。仍可点（手动选择永不拦，2026-07-30 拍板）。
  const healthy = deduped.filter((m) => !isModelAiling(m, isAiling))
  const ailing = deduped.filter((m) => isModelAiling(m, isAiling))
  return [...healthy, ...ailing].map(toOption)
}

/** 换家优先于换模型：先只在健康供应商里挑；全病（用户明知故选）才回退全集，绝不空选。 */
export function pickHealthiestProvider(model: DedupedModel, isAiling: AilingProbe): ModelProviderRef | null {
  const healthyVendors = new Set(
    model.providers
      .filter((p) => !isAiling(p.option.modelKey || p.option.value))
      .map((p) => p.vendor)
      .filter((v): v is string => v != null),
  )
  return resolveBestProvider(model, { usableVendorKeys: healthyVendors }) || resolveBestProvider(model)
}

export interface DedupedModelSelectView {
  /** 去重后的模型下拉选项（value=canonicalId，trailing 标「N 家」）。 */
  modelOptions: NomiSelectOption[]
  /** 当前选中模型的 canonicalId（无则空串）。 */
  modelValue: string
  /** 选模型：解析最优供应商后回写其 option.value 给原 onChange。 */
  onModelPick: (canonicalId: string) => void
  /** 供应商下拉选项（仅多家时非空）。value=该供应商 option.value。 */
  providerOptions: NomiSelectOption[]
  /** 当前锁定/生效的供应商 option.value。 */
  providerValue: string
  /** 锁定某家供应商：直接回写该家 option.value。 */
  onProviderPick: (optionValue: string) => void
  /** 当前选中的去重模型（供上层取档案/变体等）。 */
  selectedModel: DedupedModel | null
}

/**
 * @param modelOptions 该 kind 下全部已接入模型（平铺）
 * @param value        当前节点存的 option.value（某具体供应商的 modelKey）
 * @param onChange     原选模型回调（接收 option.value，写 node.meta 的 vendor+modelKey）
 */
export function useDedupedModelSelect(
  modelOptions: readonly ModelOption[],
  value: string,
  onChange: (value: string) => void,
): DedupedModelSelectView {
  const deduped = React.useMemo(() => dedupeModelOptions([...modelOptions]), [modelOptions])

  const selectedModel = React.useMemo(
    () => deduped.find((m) => m.providers.some((p) => p.option.value === value)) || null,
    [deduped, value],
  )

  const modelOptionsView = React.useMemo<NomiSelectOption[]>(
    () => buildModelSelectOptions(deduped, isModelRecentlyAiling),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- i18n.language：切语言要重算 trailing 文案
    [deduped, i18n.language],
  )

  const onModelPick = React.useCallback(
    (canonicalId: string) => {
      const model = deduped.find((m) => m.canonicalId === canonicalId)
      if (!model) return
      const best = pickHealthiestProvider(model, isModelRecentlyAiling)
      if (best) onChange(best.option.value)
    },
    [deduped, onChange],
  )

  const providerOptionsView = React.useMemo<NomiSelectOption[]>(() => {
    if (!selectedModel || selectedModel.providers.length <= 1) return []
    // 同一供应商对同一模型若有多条（多 modelKey），锁定列表按 vendor 折叠成一行（取首条）——
    // 用户锁的是「走哪家」，不该看到同名供应商重复。
    const byVendor = new Map<string, NomiSelectOption>()
    for (const p of selectedModel.providers) {
      const key = p.vendor || p.option.value
      if (!byVendor.has(key)) byVendor.set(key, { value: p.option.value, label: providerLabel(p) })
    }
    return byVendor.size > 1 ? [...byVendor.values()] : []
  }, [selectedModel])

  return {
    modelOptions: modelOptionsView,
    modelValue: selectedModel?.canonicalId || '',
    onModelPick,
    providerOptions: providerOptionsView,
    providerValue: value,
    onProviderPick: onChange,
    selectedModel,
  }
}
