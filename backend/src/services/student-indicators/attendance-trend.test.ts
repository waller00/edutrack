import { describe, expect, it } from 'vitest'
import { attendanceTrend, type TrendMark } from './attendance-trend.js'

const EBI = { courseOfferingId: 'o7', courseName: '7 EBI', level: 'EBI' }
const SIN_NIVEL = { courseOfferingId: 'ox', courseName: 'Taller', level: null }

const mark = (studentId: string, ymd: string, status: string, courseOfferingId = 'o7'): TrendMark => ({ studentId, ymd, status, courseOfferingId })

describe('attendanceTrend', () => {
  it('cuenta por día: faltar a una clase es faltar el día, y el día va a su peor marca', () => {
    const trend = attendanceTrend(
      [
        // Ana, 3/3: vino a una clase y faltó a otra → un día con falta sin justificar.
        mark('ana', '2026-03-03', 'PRESENT'),
        mark('ana', '2026-03-03', 'ABSENT'),
        // Ana, 4/3: llegó tarde → vino (día con llegada tarde).
        mark('ana', '2026-03-04', 'LATE'),
        mark('ana', '2026-03-04', 'PRESENT'),
        // Beto, 3/3: justificada → día con falta justificada.
        mark('beto', '2026-03-03', 'ABSENT_JUSTIFIED'),
        // Beto, 2/4: vino.
        mark('beto', '2026-04-02', 'PRESENT'),
      ],
      [EBI],
    )
    expect(trend.months).toEqual(['2026-03', '2026-04'])
    expect(trend.total).toMatchObject({ studentDays: 4, absentDays: 2, justifiedDays: 1, lateDays: 1 })
    expect(trend.total.months).toEqual([
      { month: '2026-03', studentDays: 3, absentDays: 2, justifiedDays: 1, lateDays: 1 },
      { month: '2026-04', studentDays: 1, absentDays: 0, justifiedDays: 0, lateDays: 0 },
    ])
    expect(trend.byCourse[0]).toMatchObject({ courseName: '7 EBI', total: { studentDays: 4, absentDays: 2 } })
  })

  it('una tarde y una falta el mismo día son un día con falta, no dos cosas', () => {
    const trend = attendanceTrend([mark('ana', '2026-03-03', 'LATE'), mark('ana', '2026-03-03', 'ABSENT')], [EBI])
    expect(trend.total).toMatchObject({ studentDays: 1, absentDays: 1, lateDays: 0 })
  })

  it('un curso sin nivel cuenta por clase', () => {
    const trend = attendanceTrend(
      [mark('ana', '2026-03-03', 'PRESENT', 'ox'), mark('ana', '2026-03-03', 'ABSENT', 'ox'), mark('ana', '2026-03-03', 'LATE', 'ox')],
      [SIN_NIVEL],
    )
    expect(trend.total).toMatchObject({ studentDays: 3, absentDays: 1, lateDays: 1 })
  })

  it('cada curso con sus meses, con ceros donde no hubo listas, y sin marcas de cursos ajenos', () => {
    const trend = attendanceTrend(
      [mark('ana', '2026-03-03', 'PRESENT'), mark('carla', '2026-04-07', 'ABSENT', 'ox'), mark('zoe', '2026-04-07', 'ABSENT', 'otro')],
      [EBI, SIN_NIVEL],
    )
    expect(trend.months).toEqual(['2026-03', '2026-04'])
    expect(trend.byCourse.map((c) => c.months.map((m) => m.studentDays))).toEqual([
      [1, 0],
      [0, 1],
    ])
    expect(trend.total.studentDays).toBe(2)
  })
})
