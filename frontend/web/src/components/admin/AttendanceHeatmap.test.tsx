import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import AttendanceHeatmap from './AttendanceHeatmap'
import type { AttendanceSummaryRow } from '@/lib/attendance/summary'

function row(fecha: string, estado: string): AttendanceSummaryRow {
  return {
    fecha,
    estado,
    evento: 'Clase de Matemática',
    tipoEvento: 'Clase',
    horaPlanIn: '08:00',
    horaPlanOut: '09:00',
    horaRealIn: '',
    horaRealOut: '',
    minTarde: 0,
    horasTrab: 0,
    licencia: 'NO',
    observaciones: '-',
  }
}

describe('AttendanceHeatmap', () => {
  it('muestra mensaje sin datos cuando no hay rango', () => {
    render(<AttendanceHeatmap rows={[]} from="" to="" />)
    expect(screen.getByText('Sin datos para el período')).toBeInTheDocument()
  })

  it('renderiza leyenda y una celda con tooltip de detalle', () => {
    render(<AttendanceHeatmap rows={[row('2026-05-20', 'Ausente no justificado')]} from="2026-05-18" to="2026-05-22" />)
    expect(screen.getByText('Falta sin justificar')).toBeInTheDocument()
    expect(screen.getByTitle(/2026-05-20: Clase de Matemática — Ausente no justificado/)).toBeInTheDocument()
  })
})
