'use client'

import { formatHundredths } from '@/lib/academic-config/grade-value'
import { levelStyle } from '@/lib/academic-config/level-tokens'
import type { MatrixDescriptor } from './types'

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
