import { describe, expect, it } from 'vitest'
import { tallySubjectAttendance } from './subject-attendance.js'

const day = (ymd: string) => new Date(`${ymd}T12:00:00.000Z`)

// La planilla de ciclo básico: diagnóstico, tramos y entregas, con sus fechas.
const PERIODS = [
  { id: 'diag', kind: 'DIAGNOSTICO', sortOrder: 10, startsOn: day('2026-03-01'), endsOn: day('2026-03-31') },
  { id: 'mar-abr', kind: 'TRAMO', sortOrder: 20, startsOn: day('2026-03-01'), endsOn: day('2026-04-30') },
  { id: 'e1', kind: 'ENTREGA', sortOrder: 30, startsOn: day('2026-04-15'), endsOn: day('2026-05-15') },
  { id: 'may-jun', kind: 'TRAMO', sortOrder: 40, startsOn: day('2026-05-01'), endsOn: day('2026-06-30') },
  { id: 'jul', kind: 'TRAMO', sortOrder: 50, startsOn: day('2026-07-01'), endsOn: day('2026-07-31') },
  { id: 'e2', kind: 'ENTREGA', sortOrder: 60, startsOn: day('2026-07-15'), endsOn: day('2026-08-15') },
  { id: 'sin-fechas', kind: 'TRAMO', sortOrder: 70, startsOn: null, endsOn: null },
]

const MARKS = [
  { studentId: 's1', status: 'ABSENT', ymd: '2026-03-10' },
  { studentId: 's1', status: 'ABSENT_JUSTIFIED', ymd: '2026-04-20' },
  { studentId: 's1', status: 'LATE', ymd: '2026-05-04' },
  { studentId: 's1', status: 'PRESENT', ymd: '2026-07-02' },
  { studentId: 's1', status: 'ABSENT', ymd: '2026-07-03' },
]

const counts = (absent: number, justified: number, late: number, classes: number) => ({ absent, justified, late, classes })

describe('tallySubjectAttendance', () => {
  it('cada clase cuenta una vez: sin justificar, justificadas y tardes; la presencia sólo suma clases', () => {
    const [row] = tallySubjectAttendance(MARKS, ['s1'], PERIODS)
    expect(row.total).toEqual(counts(2, 1, 1, 5))
  })

  it('cada período cuenta sus días, y una entrega los de los tramos que informa', () => {
    const [row] = tallySubjectAttendance(MARKS, ['s1'], PERIODS)
    expect(row.periods).toEqual({
      diag: counts(1, 0, 0, 1),
      'mar-abr': counts(1, 1, 0, 2),
      // Sus propias fechas (15/04 al 15/05) son las de la reunión: sumarían la tarde de mayo.
      e1: counts(1, 1, 0, 2),
      'may-jun': counts(0, 0, 1, 1),
      jul: counts(1, 0, 0, 2),
      e2: counts(1, 0, 1, 3),
    })
  })

  it('un alumno sin listas queda en cero, y no se cuenta a quien no está en el grupo', () => {
    const rows = tallySubjectAttendance([...MARKS, { studentId: 'otro', status: 'ABSENT', ymd: '2026-03-11' }], ['s1', 's2'], PERIODS)
    expect(rows.map((row) => row.studentId)).toEqual(['s1', 's2'])
    expect(rows[1]).toEqual({ studentId: 's2', total: counts(0, 0, 0, 0), periods: {} })
  })
})
