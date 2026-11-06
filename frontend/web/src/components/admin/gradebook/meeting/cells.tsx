'use client'

import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import ConductSelect, { conductText, type ConductOption } from '@/components/gradebook/ConductSelect'
import { formatHundredths } from '@/lib/academic-config/grade-value'
import { levelStyle } from '@/lib/academic-config/level-tokens'
import { formatGrade, gradeSelectOptions, type GradeRange } from '@/lib/gradebook/grade-scale'
import { studentName } from '@/lib/gradebook/meeting-board'
import type { MatrixDescriptor, MatrixRow, SaveStatus } from './types'

/**
 * Una R con su tramo: color, símbolo y valor (el símbolo evita depender del color, RNF 7.2). Sin
 * R, la calificación que el docente cargó con el sistema anterior va como propuesta, rotulada con
 * texto y sin color de tramo, porque todavía no es una nota. La usan la matriz y el panel.
 */
export function GradeBadge({
  valueHundredths,
  descriptor,
  proposedValueHundredths,
  showLabel = false,
}: Readonly<{
  valueHundredths: number | null
  descriptor: MatrixDescriptor
  proposedValueHundredths?: number | null
  /** El nombre del tramo al lado del número (en el panel hay lugar). */
  showLabel?: boolean
}>) {
  if (valueHundredths == null) {
    if (proposedValueHundredths != null) {
      return (
        <span
          className="inline-flex items-center gap-1 rounded border border-dashed border-gray-300 px-1.5 py-0.5 text-xs text-gray-600"
          title="Calificación propuesta por el docente; todavía sin rendimiento (R)"
        >
          <span className="text-[10px] uppercase text-gray-400">Prop.</span>
          {formatHundredths(proposedValueHundredths, 0)}
        </span>
      )
    }
    return (
      <span className="text-xs text-gray-400" title="Sin calificación del período">
        {showLabel ? 'Sin R' : '—'}
      </span>
    )
  }
  const style = descriptor ? levelStyle(descriptor) : null
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs ${style?.badgeClass ?? 'border-gray-200 bg-gray-50 text-gray-700'}`}
      title={descriptor?.label}
    >
      {style && <span aria-hidden>{style.symbol}</span>}
      {formatHundredths(valueHundredths, 0)}
      {showLabel && descriptor && <span className="font-normal">· {descriptor.label}</span>}
    </span>
  )
}

/** Guardando, guardado o rechazado: lo que se eligió nunca vuelve a «—» sin decir por qué. */
export function SaveMark({ status }: Readonly<{ status?: SaveStatus }>) {
  if (status === 'saving') {
    return (
      <span className="inline-flex text-gray-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        <span className="sr-only">Guardando</span>
      </span>
    )
  }
  if (status === 'saved') {
    return (
      <span className="inline-flex text-emerald-700" title="Guardado">
        <Check className="h-3.5 w-3.5" aria-hidden />
        <span className="sr-only">Guardado</span>
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-red-700">
        <AlertTriangle className="h-3 w-3" aria-hidden />
        No se guardó
      </span>
    )
  }
  return null
}

const SELECT_CLASS = 'rounded border border-gray-300 bg-white px-1 py-0.5 text-sm'

type InputProps = {
  row: MatrixRow
  editable: boolean
  status?: SaveStatus
  onChange: (value: number | null) => void
}

/**
 * Rendimiento general del alumno: lo elige la reunión, con la escala del nivel. El promedio es una
 * estadística para ayudar a decidirlo; nunca llena este casillero.
 */
export function PerformanceInput({ row, scale, editable, status, onChange }: Readonly<InputProps & { scale: GradeRange | null }>) {
  const value = row.performanceValueHundredths ?? null
  if (!editable) return <span className="font-medium text-gray-900">{formatGrade(value)}</span>
  return (
    <span className="inline-flex items-center gap-1.5">
      <select
        aria-label={`Rendimiento de ${studentName(row)}`}
        value={value == null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className={`${SELECT_CLASS} font-medium`}
      >
        <option value="">—</option>
        {gradeSelectOptions(scale, value).map((option) => (
          <option key={option} value={String(option)}>
            {formatGrade(option)}
          </option>
        ))}
      </select>
      <SaveMark status={status} />
    </span>
  )
}

/** Conducta institucional del período: la pone adscripción, con la escala de conducta. */
export function ConductInput({ row, levels, editable, status, onChange }: Readonly<InputProps & { levels: readonly ConductOption[] }>) {
  if (!editable) return <>{conductText(row.conductValueHundredths, levels)}</>
  return (
    <span className="inline-flex items-center gap-1.5">
      <ConductSelect
        aria-label={`Conducta de ${studentName(row)}`}
        value={row.conductValueHundredths == null ? '' : String(row.conductValueHundredths)}
        options={levels}
        onChange={(value) => onChange(value === '' ? null : Number(value))}
        className={SELECT_CLASS}
      />
      <SaveMark status={status} />
    </span>
  )
}
