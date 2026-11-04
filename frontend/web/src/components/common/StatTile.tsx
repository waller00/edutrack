import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'

export type StatTone = 'neutral' | 'good' | 'warning' | 'critical'

/** El tono nunca es sólo color (RNF 7.2): siempre va con su icono y su palabra. */
const TONES: Record<Exclude<StatTone, 'neutral'>, { icon: typeof Info; word: string; className: string }> = {
  good: { icon: CheckCircle2, word: 'Bien', className: 'text-emerald-800 bg-emerald-50' },
  warning: { icon: Info, word: 'Para mirar', className: 'text-amber-900 bg-amber-50' },
  critical: { icon: AlertTriangle, word: 'Atención', className: 'text-rose-800 bg-rose-50' },
}

/**
 * Una cifra con su definición: etiqueta, valor, de dónde sale («34 de 88 estudiantes») y, si
 * hace falta, un tono y una línea de tendencia. Lo usan los indicadores de estudiantes.
 */
export default function StatTile({
  label,
  value,
  detail,
  tone = 'neutral',
  toneText,
  trend,
  children,
  tour,
}: Readonly<{
  label: string
  value: ReactNode
  /** De dónde sale el número, en palabras. */
  detail?: ReactNode
  tone?: StatTone
  /** La palabra del tono, si la de siempre no alcanza ("Pasó las 25"). */
  toneText?: string
  /** Valores en orden para una línea chica (los meses del año, por ejemplo). */
  trend?: readonly (number | null)[]
  children?: ReactNode
  tour?: string
}>) {
  const toneMeta = tone === 'neutral' ? null : TONES[tone]
  const Icon = toneMeta?.icon
  return (
    <div data-tour={tour} className="flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className="text-2xl font-semibold text-slate-900">{value}</p>
        {toneMeta && Icon && (
          <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ${toneMeta.className}`}>
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {toneText ?? toneMeta.word}
          </span>
        )}
      </div>
      {detail && <p className="mt-1 text-xs leading-relaxed text-slate-500">{detail}</p>}
      {trend && trend.length > 1 && <Sparkline values={trend} label={label} />}
      {children}
    </div>
  )
}

/** Línea de tendencia sin ejes: acompaña al número, no lo reemplaza (los valores están en la tabla). */
function Sparkline({ values, label }: Readonly<{ values: readonly (number | null)[]; label: string }>) {
  const known = values.filter((v): v is number => v !== null)
  if (known.length < 2) return null
  const min = Math.min(...known)
  const max = Math.max(...known)
  const width = 120
  const height = 28
  const x = (index: number) => (index / (values.length - 1)) * (width - 6) + 3
  const y = (value: number) => (max === min ? height / 2 : height - 3 - ((value - min) / (max - min)) * (height - 6))
  const points = values.flatMap((value, index) => (value === null ? [] : [`${x(index)},${y(value)}`]))
  const lastIndex = values.findLastIndex((value) => value !== null)
  const last = values[lastIndex]
  return (
    <svg className="mt-3 h-7 w-[120px]" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Tendencia de ${label.toLowerCase()}`}>
      <polyline points={points.join(' ')} fill="none" stroke="#94a3b8" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {last != null && <circle cx={x(lastIndex)} cy={y(last)} r={4} fill="#2a78d6" stroke="#fff" strokeWidth={2} />}
    </svg>
  )
}
