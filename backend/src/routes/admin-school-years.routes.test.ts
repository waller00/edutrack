import { beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    schoolYear: { findUnique: vi.fn(), delete: vi.fn() },
    gradeBook: { count: vi.fn() },
  },
}))

vi.mock('../db/prisma.js', () => ({ prisma: prismaMock }))

import schoolYearsRoutes from './admin-school-years.js'

function app() {
  const a = express()
  a.use(express.json())
  a.use('/admin/school-years', schoolYearsRoutes)
  return a
}

const YEAR = {
  id: 'sy-2025',
  code: 2025,
  label: 'Ciclo 2025',
  status: 'CLOSED',
  startsOn: new Date('2025-03-01T03:00:00.000Z'),
  endsOn: new Date('2025-12-20T03:00:00.000Z'),
  createdAt: new Date('2025-01-01T00:00:00.000Z'),
  updatedAt: new Date('2025-01-01T00:00:00.000Z'),
}

describe('DELETE /admin/school-years/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.schoolYear.findUnique.mockResolvedValue(YEAR)
    prismaMock.schoolYear.delete.mockResolvedValue(YEAR)
    prismaMock.gradeBook.count.mockResolvedValue(0)
  })

  it('no borra un ciclo con libretas: caían en cascada con sus notas', async () => {
    prismaMock.gradeBook.count.mockResolvedValue(12)

    const res = await request(app()).delete('/admin/school-years/sy-2025')

    expect(res.status).toBe(409)
    expect(prismaMock.schoolYear.delete).not.toHaveBeenCalled()
  })

  it('borra un ciclo vacío', async () => {
    const res = await request(app()).delete('/admin/school-years/sy-2025')

    expect(res.status).toBe(200)
    expect(prismaMock.schoolYear.delete).toHaveBeenCalledWith({ where: { id: 'sy-2025' } })
  })
})
