import { describe, expect, it } from 'vitest'
import {
  admissionSummary,
  currentAccommodations,
  unresolvedPendingSubjects,
  type AccommodationRow,
  type PendingSubjectRow,
} from './student-sheet.js'

const NOW = new Date('2026-05-15T12:00:00Z')

function accommodation(over: Partial<AccommodationRow> = {}): AccommodationRow {
  return {
    id: 'a-1',
    kind: 'CURRICULAR',
    summary: 'Consignas por escrito y más tiempo.',
    externalUrl: null,
    validFrom: null,
    validUntil: null,
    ...over,
  }
}

describe('currentAccommodations', () => {
  it('sin fechas está vigente: es el caso normal', () => {
    expect(currentAccommodations([accommodation()], NOW)).toHaveLength(1)
  })

  it('una vencida no se le muestra al docente, pero la fila sigue existiendo', () => {
    const expired = accommodation({ id: 'a-viejo', validUntil: new Date('2026-03-01T12:00:00Z') })
    expect(currentAccommodations([expired], NOW)).toEqual([])
  })

  it('una que todavía no empezó tampoco se muestra', () => {
    const future = accommodation({ validFrom: new Date('2026-09-01T12:00:00Z') })
    expect(currentAccommodations([future], NOW)).toEqual([])
  })

  it('respeta los bordes del rango', () => {
    expect(currentAccommodations([accommodation({ validUntil: NOW })], NOW)).toHaveLength(1)
    expect(currentAccommodations([accommodation({ validFrom: NOW })], NOW)).toHaveLength(1)
  })

  it('deja pasar sólo las vigentes de un conjunto mezclado', () => {
    const rows = [
      accommodation({ id: 'vigente' }),
      accommodation({ id: 'vencida', validUntil: new Date('2026-01-01T12:00:00Z') }),
      accommodation({ id: 'en-rango', validFrom: new Date('2026-03-01T12:00:00Z'), validUntil: new Date('2026-12-01T12:00:00Z') }),
    ]
    expect(currentAccommodations(rows, NOW).map((r) => r.id)).toEqual(['vigente', 'en-rango'])
  })
})

function pending(over: Partial<PendingSubjectRow> = {}): PendingSubjectRow {
  return {
    id: 'p-1',
    subject: { id: 'sub-1', name: 'Matemática' },
    schoolYear: { id: 'sy-1', code: 2025 },
    origin: 'FAILED_THIS_YEAR',
    apeDecember: null,
    apeFebruary: null,
    resolvedAt: null,
    ...over,
  }
}

describe('unresolvedPendingSubjects', () => {
  it('deja fuera las que ya salvó', () => {
    const rows = [pending({ id: 'debe' }), pending({ id: 'salvada', resolvedAt: new Date() })]
    expect(unresolvedPendingSubjects(rows).map((r) => r.id)).toEqual(['debe'])
  })

  it('ordena de más reciente a más vieja', () => {
    const rows = [
      pending({ id: 'vieja', schoolYear: { id: 'sy-0', code: 2024 } }),
      pending({ id: 'nueva', schoolYear: { id: 'sy-1', code: 2025 } }),
    ]
    expect(unresolvedPendingSubjects(rows).map((r) => r.id)).toEqual(['nueva', 'vieja'])
  })

  it('no se rompe si falta el ciclo', () => {
    expect(unresolvedPendingSubjects([pending({ schoolYear: null })])).toHaveLength(1)
  })
})

describe('admissionSummary', () => {
  it('en 7.º muestra de dónde vino el pase', () => {
    expect(admissionSummary({ admittedFrom: 'Escuela 42', previousResult: null, previousYearCode: null }))
      .toEqual({ kind: 'TRANSFER', label: 'Pase de Escuela 42' })
  })

  it('en años siguientes muestra cómo promovió, con el año', () => {
    expect(
      admissionSummary({ admittedFrom: 'Escuela 42', previousResult: 'PROMOTED_WITH_PENDING', previousYearCode: 2025 }),
    ).toEqual({ kind: 'PROMOTION', label: 'Promovido con materias pendientes en 2025' })
  })

  it('el resultado del año anterior manda sobre el pase', () => {
    // Una vez que cursó un año en el liceo, lo que importa es cómo promovió.
    expect(
      admissionSummary({ admittedFrom: 'Escuela 42', previousResult: 'REPEATED', previousYearCode: 2025 }).kind,
    ).toBe('PROMOTION')
  })

  it('sin datos lo dice en vez de mostrar un hueco', () => {
    expect(admissionSummary({ admittedFrom: null, previousResult: null, previousYearCode: null }))
      .toEqual({ kind: 'UNKNOWN', label: 'Sin datos de ingreso' })
    expect(admissionSummary({ admittedFrom: '   ', previousResult: null, previousYearCode: null }).kind)
      .toBe('UNKNOWN')
  })

  it('un resultado desconocido se muestra tal cual en vez de romperse', () => {
    expect(admissionSummary({ admittedFrom: null, previousResult: 'ALGO_NUEVO', previousYearCode: 2025 }).label)
      .toBe('ALGO_NUEVO en 2025')
  })
})
