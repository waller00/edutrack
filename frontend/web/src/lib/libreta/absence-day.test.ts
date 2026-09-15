import { describe, expect, it } from 'vitest'
import {
  addDaysYmd,
  buildAbsencesExportRows,
  dayMarkToSelect,
  formatYmdDisplay,
  selectToDayMark,
  weekdayNameEs,
} from './absence-day'

describe('addDaysYmd', () => {
  it('suma y resta días civiles', () => {
    expect(addDaysYmd('2026-09-14', 1)).toBe('2026-09-15')
    expect(addDaysYmd('2026-09-14', -7)).toBe('2026-09-07')
    expect(addDaysYmd('2026-01-31', 1)).toBe('2026-02-01')
  })
})

describe('formatYmdDisplay', () => {
  it('formatea a DD/MM/YY', () => {
    expect(formatYmdDisplay('2026-09-14')).toBe('14/09/26')
  })
})

describe('weekdayNameEs', () => {
  it('nombra el día informativo', () => {
    expect(weekdayNameEs('2026-09-14')).toBe('Lunes')
    expect(weekdayNameEs('2026-09-15')).toBe('Martes')
  })
})

describe('dayMarkToSelect / selectToDayMark', () => {
  it('vacío es presente; falta y tarde sin mostrar pesos', () => {
    expect(dayMarkToSelect(null)).toBe('')
    expect(dayMarkToSelect({ status: 'PRESENT', absenceWeightHundredths: null })).toBe('')
    expect(dayMarkToSelect({ status: 'ABSENT', absenceWeightHundredths: 100 })).toBe('ABSENT_100')
    expect(dayMarkToSelect({ status: 'ABSENT', absenceWeightHundredths: 50 })).toBe('ABSENT_50')
    expect(selectToDayMark('')).toEqual({ status: 'PRESENT', absenceWeightHundredths: null })
    expect(selectToDayMark('ABSENT_50')).toEqual({ status: 'ABSENT', absenceWeightHundredths: 50 })
    expect(selectToDayMark('LATE')).toEqual({ status: 'LATE', absenceWeightHundredths: null })
  })
})

describe('buildAbsencesExportRows', () => {
  it('arma el layout tipo Libro del Profesor', () => {
    const rows = buildAbsencesExportRows({
      studentName: 'BAVASTRO LIMA VICTOR MANUEL',
      courseName: '1º Grado',
      fromYmd: '2026-01-01',
      toYmd: '2026-09-14',
      subjects: [
        {
          subjectName: 'Física',
          absences: '2',
          entries: [
            { ymd: '2026-04-07', label: 'FALTA' },
            { ymd: '2026-08-18', label: 'FALTA' },
          ],
        },
      ],
    })
    expect(rows[0][0]).toBe('Inasistencias del Alumno: BAVASTRO LIMA VICTOR MANUEL')
    expect(rows[1][0]).toContain('Curso:')
    expect(rows[1][3]).toBe('Desde: 01/01/26')
    expect(rows[1][5]).toBe('Hasta: 14/09/26')
    expect(rows[3]).toEqual(['FÍSICA', '', '', 'FALTA: 2'])
    expect(rows[4]).toEqual(['07/04/26', 'FALTA'])
    expect(rows[5]).toEqual(['18/08/26', 'FALTA'])
  })
})
