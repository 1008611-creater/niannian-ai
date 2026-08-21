import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconAlertTriangle, IconChevronDown, IconChevronRight, IconRefresh, IconReplace, IconSettings } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { WorkbenchButton } from '../../../design'
import { classifyGenerationError } from '../runner/generationRunController'
import { narrateErrorActionLabel, type GenerationErrorAction } from '../../observability/narrate'

const ACTION_ICON: Record<GenerationErrorAction, typeof IconRefresh> = {
  retry: IconRefresh,
  'switch-model': IconReplace,
  'open-model-access': IconSettings,
}

/**
 * 生成失败态 —— 节点正文内联错误卡（方案 B，2026-06-03 6 角色评审后重构）。
 *
 * 旧版是「顶部徽标 + 底部橙条 + 点击 portal 弹层」三件套：未分类时「生成失败」重复三遍、
 * 真正报错被折叠两层、弹层向下弹盖住 composer。新版直接铺满节点正文（图片本来就没生成出来），
 * 一屏给出 **原因 + 人话建议 + 重试**；「复制详情 / 技术详情」降为次要；composer 不再被遮挡。
 * 删掉 portal + 手搓定位 + wheel-dismiss + z-index 魔数（连带清掉那部分工程债）。
 *
 * 分类仍走 runner 的 `classifyGenerationError`（唯一真相源），UI 不自己解析错误。
 */
export function NodeErrorReport({ message, onRetry }: { message: string; onRetry?: () => void }): JSX.Element {
  const { t } = useTranslation()
  const report = React.useMemo(() => classifyGenerationError(message), [message])
  const [showRaw, setShowRaw] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement>(null)

  const handleRetry = React.useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      onRetry?.()
    },
    [onRetry],
  )

  /**
   * 「换个模型」= 打开**本节点已经在屏幕上**的那个模型下拉（错误卡下方 composer 里的模型芯片）。
   * 故意不在卡里内联第二个 picker：换模型要跟着重置参数/解析档案（NodeParameterControls 的
   * handleModelChange），复制一份就是并行版（P1）。这里只做一次 UI nudge，写入仍走那个唯一入口。
   */
  const handleSwitchModel = React.useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      const nodeRoot = rootRef.current?.closest('[data-node-id]')
      const trigger = nodeRoot?.querySelector<HTMLElement>(`[aria-label="${t('generationCommon.parameters.model')}"]`)
      trigger?.scrollIntoView({ block: 'nearest' })
      trigger?.click()
    },
    [t],
  )

  /** 「去模型接入」复用已有全局事件（AssistantErrorCard 同一条，不造第二套入口）。 */
  const handleOpenModelAccess = React.useCallback((event: React.MouseEvent) => {
    event.stopPropagation()
    window.dispatchEvent(new CustomEvent('nomi-open-model-catalog'))
  }, [])

  const actionHandlers: Record<GenerationErrorAction, ((event: React.MouseEvent) => void) | undefined> = {
    retry: onRetry ? handleRetry : undefined,
    'switch-model': handleSwitchModel,
    'open-model-access': handleOpenModelAccess,
  }
  const primaryAction = actionHandlers[report.primary] ? report.primary : 'open-model-access'
  const secondaryAction = report.secondary !== primaryAction && actionHandlers[report.secondary] ? report.secondary : null

  const handleCopy = React.useCallback(
    async (event: React.MouseEvent) => {
      event.stopPropagation()
      try {
        await navigator.clipboard.writeText(report.raw)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1200)
      } catch {
        /* read-only env */
      }
    },
    [report.raw],
  )

  return (
    <div
      ref={rootRef}
      role="alert"
      aria-label={t('generationCommon.error.failedAria', { reason: report.reason })}
      className={cn(
        'absolute inset-0 z-[5] flex flex-col rounded-nomi p-4',
        // 不透明浅红底：盖住下面的棋盘格占位，缩放时也一眼看出是失败态。
        'bg-[color-mix(in_oklch,var(--workbench-danger)_5%,var(--nomi-paper))]',
        'border border-[color-mix(in_oklch,var(--workbench-danger)_24%,transparent)]',
      )}
      // 不拦 pointerdown：错误卡 inset-0 盖住整个节点正文，若 stopPropagation 会让节点**拖不动也选不中**
      // （用户真机反馈）。放行 → 节点可拖可选、参数框正常弹；复制错误详情走卡里的「复制详情」按钮（不靠划选）。
    >
      <div className="flex items-start gap-2">
        <IconAlertTriangle size={16} stroke={1.6} className="mt-[1px] shrink-0 text-workbench-danger" />
        <span className="select-text cursor-text text-body font-bold leading-snug text-nomi-ink">{report.reason}</span>
      </div>
      {report.hint ? (
        <p className="mt-2 select-text cursor-text text-caption leading-relaxed text-nomi-ink-60">{report.hint}</p>
      ) : null}
      {/* 服务商真实原话——提到可见区，别再让用户去折叠的「技术详情」里挖（一脸懵逼的根源）。 */}
      {report.providerMessage ? (
        <p className="mt-2 select-text cursor-text rounded-nomi-sm bg-nomi-ink-05 p-2 text-caption leading-relaxed text-nomi-ink-60">
          <span className="text-nomi-ink-40">{t('generationCommon.error.providerMessage')}</span>
          {report.providerMessage}
        </p>
      ) : null}

      <div className="min-h-0 flex-1" />

      {showRaw ? (
        <pre
          className="mb-2 max-h-[88px] select-text overflow-auto whitespace-pre-wrap break-all rounded-nomi-sm bg-nomi-ink-05 p-2 font-nomi-mono text-micro text-nomi-ink-60"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {report.raw}
        </pre>
      ) : null}

      {/* 主动作按类型走（narrate 的 ACTION_BY_KIND）：确定性失败给「换个模型/去模型接入」，
          偶发失败才给「重试」。以前一律红「重试」，和「重试还会是同样结果」的文案自相矛盾。 */}
      <div className="flex items-center gap-2">
        {(() => {
          const PrimaryIcon = ACTION_ICON[primaryAction]
          return (
            <WorkbenchButton
              size="sm"
              onClick={actionHandlers[primaryAction]}
              aria-label={narrateErrorActionLabel(primaryAction, 'primary')}
              className="bg-workbench-danger text-nomi-paper border-0 hover:bg-workbench-danger-soft"
            >
              <PrimaryIcon size={13} stroke={1.6} />
              {narrateErrorActionLabel(primaryAction, 'primary')}
            </WorkbenchButton>
          )
        })()}
        {secondaryAction ? (
          <button
            type="button"
            onClick={actionHandlers[secondaryAction]}
            className="text-caption text-nomi-ink-40 hover:text-nomi-ink"
          >
            {narrateErrorActionLabel(secondaryAction, 'secondary')}
          </button>
        ) : null}
        <button type="button" onClick={handleCopy} className="text-caption text-nomi-ink-40 hover:text-nomi-ink">
          {copied ? t('generationCommon.error.copied') : t('generationCommon.error.copyDetails')}
        </button>
        <div className="min-w-0 flex-1" />
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            setShowRaw((value) => !value)
          }}
          aria-expanded={showRaw}
          className="inline-flex items-center gap-0.5 text-micro text-nomi-ink-40 hover:text-nomi-ink-60"
        >
          {t('generationCommon.error.technicalDetails')}
          {showRaw ? <IconChevronDown size={13} stroke={1.6} /> : <IconChevronRight size={13} stroke={1.6} />}
        </button>
      </div>
    </div>
  )
}
