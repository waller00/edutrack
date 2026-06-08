import { describe, it, expect, vi } from 'vitest'
import { findEventOverlapConflict, type EventSchedule } from './event-overlap.js'

const SY = 'sy-1'

// Hora civil Uruguay (UTC-3): 08:00 UY === 11:00 UTC.
function uy(ymd: string, hh: number, mm = 0): Date {
  return new Date(`${ymd}T${String(hh + 3).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00.000Z`)
}

function dbWith(rows: any[]) {
  return { event: { findMany: vi.fn().mockResolvedValue(rows) } }
}

function nonRecurring(over: Partial<EventSchedule> = {}): EventSchedule {
  return {
    type: 'CLASE',
    assignedUserId: 'teacher-1',
    startTime: uy('2025-06-02', 8),
    endTime: uy('2025-06-02', 9),
    startDate: uy('2025-06-02', 8),
    isRecurring: false,
    daysOfWeek: [],
    schoolYearId: SY,
    courseOfferingId: 'grp-1',
    ...over,
  }
}

describe('findEventOverlapConflict — docente', () => {
  it('detecta dos clases no recurrentes que se pisan el mismo día', async () => {
    const existing = { id: 'e-existing', title: 'Mate', ...nonRecurring({ startTime: uy('2025-06-02', 8, 30), endTime: uy('2025-06-02', 9, 30) }) }
    const conflict = await findEventOverlapConflict(dbWith([existing]), nonRecurring({ assignedUserId: 'teacher-1', courseOfferingId: 'grp-2' }))
    expect(conflict?.kind).toBe('TEACHER')
    expect(conflict?.eventId).toBe('e-existing')
  })

  it('no marca conflicto si los horarios no se tocan', async () => {
    const existing = { id: 'e-existing', title: 'Mate', ...nonRecurring({ startTime: uy('2025-06-02', 9), endTime: uy('2025-06-02', 10) }) }
    const conflict = await findEventOverlapConflict(dbWith([existing]), nonRecurring({ courseOfferingId: 'grp-2' }))
    expect(conflict).toBeNull()
  })

  it('no marca conflicto si es otro día', async () => {
    const existing = { id: 'e-existing', title: 'Mate', ...nonRecurring({ startTime: uy('2025-06-03', 8), endTime: uy('2025-06-03', 9), startDate: uy('2025-06-03', 8) }) }
    const conflict = await findEventOverlapConflict(dbWith([existing]), nonRecurring({ courseOfferingId: 'grp-2' }))
    expect(conflict).toBeNull()
  })

  it('excluye el propio evento y su familia de versiones', async () => {
    const existing = { id: 'e-existing', title: 'Mate', revisionOf: 'root-1', ...nonRecurring({ startTime: uy('2025-06-02', 8, 30), endTime: uy('2025-06-02', 9, 30) }) }
    const candidate = nonRecurring({ id: 'e-new', revisionOf: 'root-1', courseOfferingId: 'grp-2' })
    const conflict = await findEventOverlapConflict(dbWith([existing]), candidate)
    expect(conflict).toBeNull()
  })
})

describe('findEventOverlapConflict — recurrencia', () => {
  it('detecta solape entre recurrente y no recurrente en un día que cae en daysOfWeek', async () => {
    // 2025-06-02 es lunes (weekday 1).
    const recurring = {
      id: 'e-rec',
      title: 'Clase semanal',
      ...nonRecurring({ isRecurring: true, daysOfWeek: [1, 3], recurrenceEnd: uy('2025-12-01', 9) }),
    }
    const candidate = nonRecurring({ courseOfferingId: 'grp-2', startTime: uy('2025-06-02', 8, 15), endTime: uy('2025-06-02', 9) })
    const conflict = await findEventOverlapConflict(dbWith([recurring]), candidate)
    expect(conflict?.eventId).toBe('e-rec')
  })

  it('no marca conflicto si el día no está en daysOfWeek', async () => {
    // 2025-06-03 es martes (weekday 2), no está en [1,3].
    const recurring = {
      id: 'e-rec',
      title: 'Clase semanal',
      ...nonRecurring({ isRecurring: true, daysOfWeek: [1, 3], recurrenceEnd: uy('2025-12-01', 9) }),
    }
    const candidate = nonRecurring({
      courseOfferingId: 'grp-2',
      startTime: uy('2025-06-03', 8, 15),
      endTime: uy('2025-06-03', 9),
      startDate: uy('2025-06-03', 8),
    })
    const conflict = await findEventOverlapConflict(dbWith([recurring]), candidate)
    expect(conflict).toBeNull()
  })
})

describe('findEventOverlapConflict — grupo', () => {
  it('detecta dos clases del mismo grupo a la misma hora con distinto docente', async () => {
    const existing = { id: 'e-existing', title: 'Mate', ...nonRecurring({ assignedUserId: 'teacher-2' }) }
    // Distinto docente: el chequeo de docente no aplica; debe saltar por grupo.
    const candidate = nonRecurring({ assignedUserId: 'teacher-1', courseOfferingId: 'grp-1' })
    const db = {
      event: {
        findMany: vi
          .fn()
          // 1ª llamada (docente teacher-1) → sin filas; 2ª llamada (grupo grp-1) → existing.
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([existing]),
      },
    }
    const conflict = await findEventOverlapConflict(db, candidate)
    expect(conflict?.kind).toBe('GROUP')
  })

  it('jornada laboral no valida grupo', async () => {
    const candidate = nonRecurring({ type: 'JORNADA_LABORAL', courseOfferingId: 'grp-1' })
    const db = { event: { findMany: vi.fn().mockResolvedValue([]) } }
    const conflict = await findEventOverlapConflict(db, candidate)
    expect(conflict).toBeNull()
    // Solo se consultó el solape de docente, no el de grupo.
    expect(db.event.findMany).toHaveBeenCalledTimes(1)
  })
})
