'use client'

/** Una nota de conducta, en centésimos, y su representación numérica. */
export type ConductOption = { valueHundredths: number; label: string }

export const CONDUCT_OPTIONS: readonly ConductOption[] = Array.from({ length: 10 }, (_, i) => ({
  valueHundredths: (i + 1) * 100,
  label: String(i + 1),
}))

/** Conducta como nota numérica, también para registros de la antigua escala ordinal. */
export function conductText(value: number | null | undefined, _options: readonly ConductOption[]): string {
  if (value == null) return '—'
  return String(value / 100).replace('.', ',')
}

/**
 * Conducta en la asignatura, como nota entera del 1 al 10.
 * `value` va en centésimos como texto (`''` sin dato), igual que los borradores del cierre.
 */
export default function ConductSelect({
  value,
  options: _options,
  onChange,
  disabled,
  'aria-label': ariaLabel,
  className = 'rounded border border-slate-300 bg-white px-1.5 py-1 text-sm disabled:opacity-50',
}: {
  value: string
  options: readonly ConductOption[]
  onChange: (value: string) => void
  disabled?: boolean
  'aria-label': string
  className?: string
}) {
  const current = value === '' ? null : Number(value)
  const known = current == null || CONDUCT_OPTIONS.some((option) => option.valueHundredths === current)
  return (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel} className={className}>
      <option value="">—</option>
      {CONDUCT_OPTIONS.map((option) => (
        <option key={option.valueHundredths} value={String(option.valueHundredths)}>
          {option.label}
        </option>
      ))}
      {/* Un valor fuera de la escala se ofrece igual: si no, tocar el selector lo borraría. */}
      {!known && <option value={value} disabled>{conductText(current, CONDUCT_OPTIONS)}</option>}
    </select>
  )
}
