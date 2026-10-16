import { describe, expect, it, vi } from 'vitest'

vi.mock('../../db/prisma.js', () => ({ prisma: {} }))
vi.mock('../notifications/notify.js', () => ({ notifyUsers: vi.fn() }))

import { lateRollCallNotification, shouldNotifyLateRollCall } from './late-roll-call.js'

const endAt = new Date('2026-10-08T13:45:00.000Z')

describe('shouldNotifyLateRollCall', () => {
  it('avisa cuando el docente la pasa por primera vez después de la clase', () => {
    expect(
      shouldNotifyLateRollCall({ isAssignedTeacher: true, wasTakenBefore: false, occurrenceEndAt: endAt, now: new Date('2026-10-09T12:00:00.000Z') }),
    ).toBe(true)
  })

  it('no avisa si la pasa durante la clase', () => {
    expect(
      shouldNotifyLateRollCall({ isAssignedTeacher: true, wasTakenBefore: false, occurrenceEndAt: endAt, now: new Date('2026-10-08T13:20:00.000Z') }),
    ).toBe(false)
  })

  it('no vuelve a avisar cuando corrige una lista ya pasada', () => {
    expect(
      shouldNotifyLateRollCall({ isAssignedTeacher: true, wasTakenBefore: true, occurrenceEndAt: endAt, now: new Date('2026-10-09T12:00:00.000Z') }),
    ).toBe(false)
  })

  it('no avisa cuando la escribe administración', () => {
    expect(
      shouldNotifyLateRollCall({ isAssignedTeacher: false, wasTakenBefore: false, occurrenceEndAt: endAt, now: new Date('2026-10-09T12:00:00.000Z') }),
    ).toBe(false)
  })
})

describe('lateRollCallNotification', () => {
  it('dice qué clase, de cuándo y cuándo se pasó, en hora de Uruguay', () => {
    const n = lateRollCallNotification({
      subjectName: 'Matemática',
      groupLabel: '3.º B',
      occurrenceYmd: '2026-10-08',
      occurrenceStartAt: new Date('2026-10-08T13:00:00.000Z'),
      takenAt: new Date('2026-10-10T21:30:00.000Z'),
      teacherName: 'Ana Pérez',
    })
    expect(n).toEqual({
      type: 'ROLL_CALL_LATE',
      title: 'Lista pasada fuera de hora: Matemática · 3.º B',
      body: 'Clase del 08/10 a las 10:00. Ana Pérez la pasó el 10/10 a las 18:30.',
      actionUrl: '/admin/student-attendance',
    })
  })

  it('si la pasó el mismo día no repite la fecha', () => {
    const n = lateRollCallNotification({
      subjectName: 'Matemática',
      groupLabel: null,
      occurrenceYmd: '2026-10-08',
      occurrenceStartAt: new Date('2026-10-08T13:00:00.000Z'),
      takenAt: new Date('2026-10-08T18:00:00.000Z'),
      teacherName: null,
    })
    expect(n.body).toBe('Clase del 08/10 a las 10:00. El docente la pasó a las 15:00.')
  })
})
