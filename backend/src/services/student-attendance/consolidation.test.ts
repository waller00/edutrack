import { describe, expect, it } from 'vitest'
import {
  attendancePercentOf,
  consolidateDay,
  consolidateRange,
  DAILY_CONSOLIDATION_LABEL,
  groupByDay,
  overallTotals,
  totalsBySubject,
  type AttendanceCell,
} from './consolidation.js'

const OPTS = { thresholdPercent: 50 }

function cell(status: AttendanceCell['status'], overrides: Partial<AttendanceCell> = {}): AttendanceCell {
  return { ymd: '2026-05-11', status, subjectId: 'su-1', subjectName: 'Matemática', ...overrides }
}

describe('consolidateDay', () => {
  it('sin clases listadas el día no consolida nada', () => {
    expect(consolidateDay([], OPTS)).toBe('NO_CLASSES')
  })

  it('0 de 4 ausencias => presente', () => {
    expect(consolidateDay([cell('PRESENT'), cell('PRESENT'), cell('LATE'), cell('PRESENT')], OPTS)).toBe('PRESENT')
  })

  it('1 de 4 ausencias => media falta', () => {
    expect(consolidateDay([cell('ABSENT'), cell('PRESENT'), cell('PRESENT'), cell('PRESENT')], OPTS)).toBe('HALF_ABSENCE')
  })

  it('2 de 4 ausencias => falta entera (alcanza el umbral)', () => {
    expect(consolidateDay([cell('ABSENT'), cell('ABSENT'), cell('PRESENT'), cell('PRESENT')], OPTS)).toBe('ABSENCE')
  })

  it('la llegada tarde no cuenta como ausencia', () => {
    expect(consolidateDay([cell('LATE'), cell('LATE')], OPTS)).toBe('PRESENT')
  })

  it('la falta justificada sí cuenta para la consolidación del día', () => {
    expect(consolidateDay([cell('ABSENT_JUSTIFIED'), cell('ABSENT_JUSTIFIED')], OPTS)).toBe('ABSENCE')
  })

  it('un umbral más exigente convierte medias faltas en faltas', () => {
    const cells = [cell('ABSENT'), cell('PRESENT'), cell('PRESENT'), cell('PRESENT')]
    expect(consolidateDay(cells, { thresholdPercent: 25 })).toBe('ABSENCE')
  })
})

describe('groupByDay', () => {
  it('agrupa por día civil', () => {
    const grouped = groupByDay([cell('PRESENT'), cell('ABSENT', { ymd: '2026-05-12' }), cell('LATE')])
    expect(grouped.get('2026-05-11')).toHaveLength(2)
    expect(grouped.get('2026-05-12')).toHaveLength(1)
  })
})

describe('consolidateRange', () => {
  it('ordena por fecha y calcula unidades de falta', () => {
    const rows = consolidateRange(
      [
        cell('ABSENT', { ymd: '2026-05-12' }),
        cell('PRESENT', { ymd: '2026-05-12' }),
        cell('PRESENT', { ymd: '2026-05-12' }),
        cell('ABSENT', { ymd: '2026-05-11' }),
        cell('ABSENT', { ymd: '2026-05-11' }),
      ],
      OPTS,
    )
    expect(rows.map((r) => r.ymd)).toEqual(['2026-05-11', '2026-05-12'])
    expect(rows[0]).toMatchObject({ value: 'ABSENCE', absenceUnits: 1, classes: 2, absences: 2 })
    expect(rows[1]).toMatchObject({ value: 'HALF_ABSENCE', absenceUnits: 0.5, classes: 3 })
  })

  it('un día presente no suma unidades de falta', () => {
    expect(consolidateRange([cell('PRESENT')], OPTS)[0].absenceUnits).toBe(0)
  })
})

describe('attendancePercentOf', () => {
  it('la llegada tarde cuenta como asistencia', () => {
    expect(attendancePercentOf([cell('PRESENT'), cell('LATE')])).toBe(100)
  })

  it('las faltas bajan el porcentaje, justificadas incluidas', () => {
    expect(attendancePercentOf([cell('PRESENT'), cell('ABSENT')])).toBe(50)
    expect(attendancePercentOf([cell('PRESENT'), cell('ABSENT_JUSTIFIED')])).toBe(50)
  })

  it('redondea a un decimal', () => {
    expect(attendancePercentOf([cell('PRESENT'), cell('PRESENT'), cell('ABSENT')])).toBe(66.7)
  })

  it('sin clases listadas el porcentaje es 0, no NaN', () => {
    expect(attendancePercentOf([])).toBe(0)
  })
})

describe('totalsBySubject', () => {
  it('separa por asignatura y ordena alfabéticamente', () => {
    const rows = totalsBySubject([
      cell('PRESENT'),
      cell('ABSENT'),
      cell('PRESENT', { subjectId: 'su-2', subjectName: 'Biología' }),
    ])
    expect(rows.map((r) => r.subjectName)).toEqual(['Biología', 'Matemática'])
    expect(rows[1]).toMatchObject({ classes: 2, present: 1, absent: 1, attendancePercent: 50 })
  })

  it('agrupa las clases sin asignatura bajo una etiqueta explícita', () => {
    const rows = totalsBySubject([cell('PRESENT', { subjectId: null, subjectName: null })])
    expect(rows[0]).toMatchObject({ subjectId: null, subjectName: 'Sin asignatura' })
  })

  it('cuenta los cuatro estados por separado', () => {
    const rows = totalsBySubject([cell('PRESENT'), cell('LATE'), cell('ABSENT'), cell('ABSENT_JUSTIFIED')])
    expect(rows[0]).toMatchObject({ present: 1, late: 1, absent: 1, absentJustified: 1 })
  })
})

describe('overallTotals', () => {
  it('separa faltas totales de faltas no justificadas', () => {
    const totals = overallTotals([cell('ABSENT'), cell('ABSENT_JUSTIFIED'), cell('PRESENT')], OPTS)
    expect(totals).toMatchObject({
      classes: 3,
      absencesTotal: 2,
      absencesUnjustified: 1,
      present: 1,
    })
  })

  it('acumula las unidades de falta de todos los días', () => {
    const totals = overallTotals(
      [
        cell('ABSENT', { ymd: '2026-05-11' }),
        cell('ABSENT', { ymd: '2026-05-11' }),
        cell('ABSENT', { ymd: '2026-05-12' }),
        cell('PRESENT', { ymd: '2026-05-12' }),
        cell('PRESENT', { ymd: '2026-05-12' }),
      ],
      OPTS,
    )
    // 11: 2/2 ausencias => falta entera. 12: 1/3 => media falta.
    expect(totals.absenceUnits).toBe(1.5)
  })

  it('un período sin marcas no rompe los cálculos', () => {
    expect(overallTotals([], OPTS)).toMatchObject({ classes: 0, attendancePercent: 0, absenceUnits: 0 })
  })
})

describe('DAILY_CONSOLIDATION_LABEL', () => {
  it('tiene etiqueta para los cuatro resultados', () => {
    expect(Object.keys(DAILY_CONSOLIDATION_LABEL)).toHaveLength(4)
  })
})
