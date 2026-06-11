import { describe, it, expect, beforeEach, vi } from 'vitest'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { $queryRaw: vi.fn() },
}))
vi.mock('../db/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('@prisma/client', () => ({
  Prisma: { sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }) },
}))

import { utcDay, findNonWorkingDayForDate, isNonWorkingDate } from './non-working-days.js'

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

  it('findNonWorkingDayForDate: en entorno test, si el query falla devuelve null', async () => {
    prismaMock.$queryRaw.mockRejectedValueOnce(new Error('db down'))
    expect(await findNonWorkingDayForDate(new Date('2026-06-08'))).toBeNull()
  })

  it('isNonWorkingDate: refleja si hay fila', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ id: 'n1' }])
    expect(await isNonWorkingDate(new Date('2026-06-08'))).toBe(true)
    prismaMock.$queryRaw.mockResolvedValueOnce([])
    expect(await isNonWorkingDate(new Date('2026-06-08'))).toBe(false)
  })
})
