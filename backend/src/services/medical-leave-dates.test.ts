import { describe, expect, it } from 'vitest'
import { activeOnDays, licenseWindow, queryDayYmd, schoolYearDays, storedDayYmd } from './medical-leave-dates.js'

describe('fechas de licencias', () => {
  it('el día de una fecha guardada es su parte UTC (mediodía o medianoche)', () => {
    expect(storedDayYmd(new Date('2026-03-01T12:00:00.000Z'))).toBe('2026-03-01')
    expect(storedDayYmd(new Date('2026-03-01T00:00:00.000Z'))).toBe('2026-03-01')
  })

  it('acepta el día o un ISO en la consulta, y descarta lo demás', () => {
    expect(queryDayYmd('2026-03-01')).toBe('2026-03-01')
    expect(queryDayYmd('2026-03-01T00:00:00.000Z')).toBe('2026-03-01')
    expect(queryDayYmd('ayer')).toBeNull()
    expect(queryDayYmd(undefined)).toBeNull()
  })

  it('la ventana va de las 00:00 del primer día al final del último, en Uruguay (UTC-3)', () => {
    const window = licenseWindow({
      startDate: new Date('2026-03-02T12:00:00.000Z'),
      endDate: new Date('2026-03-04T12:00:00.000Z'),
    })
    expect(window.from.toISOString()).toBe('2026-03-02T03:00:00.000Z')
    expect(window.to.toISOString()).toBe('2026-03-05T02:59:59.999Z')
  })

  it('un ciclo sin fechas cargadas es su año calendario', () => {
    expect(schoolYearDays({ code: 2025, startsOn: null, endsOn: null })).toEqual({ from: '2025-01-01', to: '2025-12-31' })
    expect(
      schoolYearDays({
        code: 2026,
        startsOn: new Date('2026-03-01T00:00:00.000Z'),
        endsOn: new Date('2026-12-20T00:00:00.000Z'),
      }),
    ).toEqual({ from: '2026-03-01', to: '2026-12-20' })
  })

  it('sin límites no filtra', () => {
    expect(activeOnDays(null, null)).toEqual([])
  })
})
