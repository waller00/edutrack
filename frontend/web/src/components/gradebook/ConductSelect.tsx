'use client'

/** Un tramo de la escala de conducta: su valor y su etiqueta ("Buena", "Muy buena"…). */
export type ConductOption = { valueHundredths: number; label: string }

/** Etiqueta de un valor de conducta; el número si no cae en la escala (nunca sólo un color). */
export function conductText(value: number | null | undefined, options: readonly ConductOption[]): string {
  if (value == null) return '—'
  return options.find((option) => option.valueHundredths === value)?.label ?? String(value / 100).replace('.', ',')
}

/**
 * Conducta en la asignatura, con las etiquetas de la escala `CONDUCTA` que manda el backend.
 * `value` va en centésimos como texto (`''` sin dato), igual que los borradores del cierre.
 */
export default function ConductSelect({
  value,
  options,
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
  const known = current == null || options.some((option) => option.valueHundredths === current)
  return (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel} className={className}>
      <option value="">—</option>
      {options.map((option) => (
        <option key={option.valueHundredths} value={String(option.valueHundredths)}>
          {option.label}
        </option>
      ))}
      {/* Un valor fuera de la escala se ofrece igual: si no, tocar el selector lo borraría. */}
      {!known && <option value={value}>{conductText(current, options)}</option>}
    </select>
  )
}
