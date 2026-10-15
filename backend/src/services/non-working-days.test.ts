import { describe, it, expect, beforeEach, vi } from 'vitest'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { $queryRaw: vi.fn() },
}))
vi.mock('../db/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('@prisma/client', () => ({
  Prisma: { sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }) },
}))

import { utcDay, findNonWorkingDayForDate, findNonWorkingDayForInstant, isNonWorkingDate } from './non-working-days.js'

describe('non-working-days', () => {
  beforeEach(() => prismaMock.$queryRaw.mockReset())

  it('utcDay: trunca a medianoche UTC', () => {
    expect(utcDay(new Date('2026-06-08T15:30:45.123Z')).toISOString()).toBe('2026-06-08T00:00:00.000Z')
  })

  it('findNonWorkingDayForDate: devuelve la fila o null', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([
      { id: 'n1', date: new Date('2026-06-08'), type: 'HOLIDAY', reason: 'Feriado', notes: null },
    ])
    expect((await findNonWorkingDayForDate(new Date('2026-06-08')))?.id).toBe('n1')

    prismaMock.$queryRaw.mockResolvedValueOnce([])
    expect(await findNonWorkingDayForDate(new Date('2026-06-08'))).toBeNull()
  })

  it('findNonWorkingDayForDate: si el query falla, el error se propaga (no se toma como día hábil)', async () => {
    prismaMock.$queryRaw.mockRejectedValueOnce(new Error('db down'))
    await expect(findNonWorkingDayForDate(new Date('2026-06-08'))).rejects.toThrow('db down')
  })

  it('findNonWorkingDayForInstant: una clase nocturna mira el feriado de SU día, no el de mañana', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([])
    // 21:30 del 7 de junio en Uruguay = 00:30 UTC del 8.
    await findNonWorkingDayForInstant(new Date('2026-06-08T00:30:00.000Z'))
    const day = prismaMock.$queryRaw.mock.calls[0][0].values[0] as Date
    expect(day.toISOString()).toBe('2026-06-07T00:00:00.000Z')
  })

  it('isNonWorkingDate: refleja si hay fila', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: 'n1' }])
    expect(await isNonWorkingDate(new Date('2026-06-08'))).toBe(true)
    prismaMock.$queryRaw.mockResolvedValueOnce([])
    expect(await isNonWorkingDate(new Date('2026-06-08'))).toBe(false)
  })
})
