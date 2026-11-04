import { describe, expect, it } from 'vitest'
import { closingsByMeeting, dueText, isMyRollCall, liveObservations, teacherDayTally, type TodayClass } from './my-day'
import type { OwnerSummary } from '@/lib/gradebook/libreta-status'
import type { MeetingSummary } from '@/lib/gradebook/closure-blockers'

const NOW = new Date('2026-11-04T15:00:00.000Z')

function lesson(over: Partial<TodayClass> & { eventId: string }, rollCall: Partial<TodayClass['rollCall']> = {}): TodayClass {
  return {
    ymd: '2026-11-04',
    title: 'Clase',
    subject: 'Matemática',
    course: '1.º A',
    orientation: null,
    startAt: '2026-11-04T11:00:00.000Z',
    endAt: '2026-11-04T12:00:00.000Z',
    teacher: { id: 't', name: 'T' },
    substitute: null,
    isSubstitution: false,
    nonWorkingDay: null,
    ...over,
    rollCall: {
      sessionId: null,
      status: 'PENDING',
      takenAt: null,
      takenBy: null,
      rosterSize: 30,
      canEdit: true,
      blockedReason: null,
      opensAt: '2026-11-04T10:50:00.000Z',
      editableUntil: '2026-11-11T12:00:00.000Z',
      ...rollCall,
    },
  }
}

describe('las clases de hoy', () => {
  it('cuenta sólo las listas suyas que ya abrieron', () => {
    const rows = [
      lesson({ eventId: 'pasada' }, { status: 'TAKEN', takenAt: '2026-11-04T11:10:00.000Z' }),
      lesson({ eventId: 'sin-pasar' }),
      lesson({ eventId: 'despues', startAt: '2026-11-04T18:00:00.000Z', endAt: '2026-11-04T19:00:00.000Z' }, { opensAt: '2026-11-04T17:50:00.000Z' }),
      lesson({ eventId: 'cubierta' }, { blockedReason: 'COVERED_BY_SUBSTITUTE' }),
      lesson({ eventId: 'licencia', onLicense: true }),
    ]
    expect(teacherDayTally(rows, NOW)).toEqual({ taken: 1, opened: 2 })
    expect(isMyRollCall(rows[3], NOW)).toBe(false)
    expect(isMyRollCall(lesson({ eventId: 'feriado', nonWorkingDay: 'Feriado' }), NOW)).toBe(false)
  })

  it('dice hasta cuándo vence una lista atrasada', () => {
    expect(dueText('2026-11-06T15:40:00.000Z')).toBe('Vence el vie 6/11 a las 12:40')
  })
})

function meeting(over: Partial<MeetingSummary> & { periodId: string }): MeetingSummary {
  return {
    name: over.periodId === 'e2' ? '2.ª Entrega' : '3.ª Entrega',
    kind: 'ENTREGA',
    sortOrder: 30,
    reportCard: true,
    judgementLabel: null,
    closesOn: over.periodId === 'e2' ? '2026-11-14' : '2026-12-01',
    status: 'OPEN',
    closedAt: null,
    closedLate: false,
    reopenReason: null,
    missing: [],
    review: null,
    ...over,
  }
}

const summary = (gradeBookId: string, meetings: MeetingSummary[]): OwnerSummary => ({
  gradeBookId,
  role: 'OWNER',
  meetings,
  students: [{ studentId: 's1', lastName: 'Pérez', firstName: 'Ana' }],
})
const labels: Record<string, string> = { a: '1.º A · MATEMÁTICA', b: '1.º B · MATEMÁTICA', c: '2.º A · FÍSICA' }

describe('las reuniones que vienen', () => {
  it('agrupa por reunión, con cuántas ya cerró y lo que le falta a cada una', () => {
    const closings = closingsByMeeting(
      [
        summary('a', [meeting({ periodId: 'e2', status: 'CLOSED', missing: null }), meeting({ periodId: 'e3' })]),
        summary('b', [meeting({ periodId: 'e2', missing: [{ code: 'MISSING_GRADES', studentIds: ['s1'] }] }), meeting({ periodId: 'e3' })]),
        summary('c', [meeting({ periodId: 'e2' }), meeting({ periodId: 'e3' })]),
      ],
      (id) => labels[id],
    )
    expect(closings.map((g) => [g.name, g.closed, g.total])).toEqual([
      ['2.ª Entrega', 1, 3],
      ['3.ª Entrega', 0, 3],
    ])
    expect(closings[0].open.map((i) => [i.label, i.missing])).toEqual([
      ['1.º B · MATEMÁTICA', ['1 sin R (rendimiento): Pérez, Ana']],
      ['2.º A · FÍSICA', []],
    ])
    expect(closings[0].open[1].stage.label).toBe('Lista para cerrar')
  })

  it('con todo cerrado no hay nada que mostrar', () => {
    expect(closingsByMeeting([summary('a', [meeting({ periodId: 'e2', status: 'CLOSED', missing: null })])], (id) => id)).toEqual([])
  })
})

describe('lo que observaron', () => {
  it('lo observado que espera corrección, con el texto y quién lo dijo', () => {
    const observed = meeting({
      periodId: 'e2',
      status: 'CLOSED',
      missing: null,
      review: {
        sections: [{ section: 'JUDGEMENTS', status: 'OBSERVED', occurredAt: '2026-11-03T12:00:00Z', observations: 'Falta el juicio de Ana.', actorRoleCode: 'ADSCRIPTO' }],
        overallStatus: 'OBSERVED',
        blockingSections: ['JUDGEMENTS'],
        reclosedAfterObservation: false,
      },
    })
    const reclosed = { ...observed, periodId: 'e3', review: { ...observed.review!, reclosedAfterObservation: true } }
    expect(liveObservations([summary('a', [observed, reclosed])], (id) => labels[id])).toEqual([
      {
        gradeBookId: 'a',
        label: '1.º A · MATEMÁTICA',
        periodId: 'e2',
        meetingName: '2.ª Entrega',
        sections: [{ section: 'JUDGEMENTS', label: 'Juicios', text: 'Falta el juicio de Ana.', by: 'Adscripción' }],
      },
    ])
  })
})
