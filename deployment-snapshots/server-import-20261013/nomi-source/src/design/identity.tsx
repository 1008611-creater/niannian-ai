import type { CSSProperties, HTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../utils/cn'

type NomiBrandProps = {
  markSize?: number
  wordSize?: number
  className?: string
}

type NomiLogoMarkProps = {
  size?: number
  className?: string
}

type NomiLoadingMarkProps = {
  size?: number
  className?: string
  label?: string
}

type NomiAILabelProps = {
  markSize?: number
  wordSize?: number
  className?: string
  suffix?: string
}

type NomiStepperProps = {
  value: 'creation' | 'generation' | 'preview'
  onChange: (mode: 'creation' | 'generation' | 'preview') => void
}

type NomiWordmarkProps = {
  /** 字号 px；缺省则继承父级 font-size（如放进 h1 用 text-display）。 */
  fontSize?: number
  className?: string
} & HTMLAttributes<HTMLSpanElement>

/**
 * 念念 AI 文字标志的唯一入口。导出名保留，避免影响现有组件调用。
 */
export function NomiWordmark({ fontSize, className, ...rest }: NomiWordmarkProps): JSX.Element {
  const { t } = useTranslation()
  return (
    <span
      className={cn('nomi-wordmark', 'font-nomi-display font-normal tracking-[-0.02em] leading-none whitespace-nowrap', className)}
      style={fontSize ? { fontSize } : undefined}
      {...rest}
    >
      {t('brand.wordStart')}
    </span>
  )
}

export function NomiBrand({ markSize = 26, wordSize = 17, className }: NomiBrandProps): JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      className={cn('nomi-brand', 'inline-flex items-center gap-2 shrink-0', className)}
      aria-label={t('brand.name')}
    >
      <NomiLogoMark size={markSize} />
      <NomiWordmark fontSize={wordSize} className="nomi-brand__word text-nomi-ink" aria-hidden="true" />
    </div>
  )
}

export function NomiLogoMark({ size = 24, className }: NomiLogoMarkProps): JSX.Element {
  return (
    <img
      src="/niannian-ai-authority-gold.svg?v=20260803-r2"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      className={cn('nomi-logo-mark', 'block shrink-0 object-contain', className)}
    />
  )
}

export function NomiLoadingMark({ size = 18, className, label }: NomiLoadingMarkProps): JSX.Element {
  const { t } = useTranslation()
  return (
    <span
      className={cn(
        'nomi-loading-mark',
        'inline-grid place-items-center flex-none leading-none animate-spin motion-reduce:animate-none',
        className,
      )}
      aria-label={label ?? t('common.loading')}
      role="status"
      style={{ '--nomi-loading-size': `${size}px`, width: `${size}px`, height: `${size}px` } as CSSProperties}
    >
      <NomiLogoMark size={size} className={cn('nomi-loading-mark__logo', 'block')} />
    </span>
  )
}

export function NomiAILabel({ markSize = 22, wordSize = 14, className, suffix = 'AI' }: NomiAILabelProps): JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      className={cn('nomi-ai-label', 'inline-flex items-center gap-2 shrink-0', className)}
      aria-label={t('brand.aiLabel', { suffix })}
    >
      <NomiLogoMark size={markSize} />
      <span className={cn('nomi-ai-label__text', 'leading-none')} style={{ fontSize: wordSize }}>
        <NomiWordmark className="nomi-ai-label__word text-nomi-ink" />
        <span className={cn('nomi-ai-label__suffix', 'font-nomi-display text-nomi-ink-60 tracking-[-0.01em]')}>
          {' '}
          {suffix}
        </span>
      </span>
    </div>
  )
}

export function NomiStepper({ value, onChange }: NomiStepperProps): JSX.Element {
  const { t } = useTranslation()
  const tabs: { mode: NomiStepperProps['value']; label: string }[] = [
    { mode: 'creation', label: t('workspace.creationTab') },
    { mode: 'generation', label: t('workspace.generationTab') },
    { mode: 'preview', label: t('workspace.previewTab') },
  ]
  return (
    <nav
      className={cn(
        'nomi-stepper',
        'inline-flex items-center gap-0.5 p-1 border border-nomi-line-soft rounded-full bg-[var(--nomi-ink-05)]',
      )}
      aria-label={t('workspace.switchLabel')}
    >
      {tabs.map((tab) => (
        <button
          key={tab.mode}
          className={cn(
            'nomi-stepper__step',
            'inline-flex items-center px-3.5 py-[5px] border-0 rounded-full bg-transparent text-nomi-ink-60 font-inherit text-body-sm font-medium cursor-pointer',
            'transition-[background,color,box-shadow] ease-nomi-fast',
            'hover:text-nomi-ink',
            'data-[state=active]:bg-nomi-paper data-[state=active]:text-nomi-ink data-[state=active]:shadow-nomi-sm',
          )}
          type="button"
          aria-current={value === tab.mode ? 'page' : undefined}
          data-state={value === tab.mode ? 'active' : 'idle'}
          data-mode={tab.mode}
          onClick={() => onChange(tab.mode)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  )
}
