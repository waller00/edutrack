'use client'

import {
  formatGrade,
  gradeSelectFromHundredths,
  gradeSelectOptions,
  gradeSelectToHundredths,
  type GradeRange,
} from '@/lib/gradebook/grade-scale'

/**
 * Selector de nota con el rango de la escala del nivel (C, R y notas sueltas).
 *
 * `value` es el valor del selector ("8", "11" o `''`), como lo guardan los borradores; la opción
 * vacía es la única forma de dejarla sin nota.
 */
export default function GradeSelect({
  value,
  scale,
  onChange,
  disabled,
  className = 'rounded border border-gray-300 bg-amber-50 px-2 py-1.5 tabular-nums',
  title,
  'aria-label': ariaLabel = 'Calificación',
}: {
  value: string
  scale: GradeRange | null | undefined
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
  title?: string
  'aria-label'?: string
}) {
  const options = gradeSelectOptions(scale, gradeSelectToHundredths(value))
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={className}
      title={title}
      aria-label={ariaLabel}
    >
      <option value="">—</option>
      {options.map((hundredths) => (
        <option key={hundredths} value={gradeSelectFromHundredths(hundredths)}>
          {formatGrade(hundredths)}
        </option>
      ))}
    </select>
  )
}
