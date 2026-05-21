import { describe, expect, it, vi, beforeEach } from 'vitest'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    attendance: { findMany: vi.fn() },
    medicalLeave: { findMany: vi.fn() },
  },
}))

vi.mock('../../../db/prisma.js', () => ({ prisma: prismaMock }))

import { generateAttendanceAssistanceReportPdfFromAttendances } from './attendanceAssistanceReportExport.js'

describe('attendance assistance report export', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('generates a valid PDF when the selected filters return no rows', async () => {
    prismaMock.attendance.findMany.mockResolvedValueOnce([])

    const buffer = await generateAttendanceAssistanceReportPdfFromAttendances({
      filters: {
        from: '2026-05-01',
        to: '2026-05-31',
      },
    })

    expect(buffer.length).toBeGreaterThan(100)
    expect(buffer.subarray(0, 4).toString('ascii')).toBe('%PDF')
  })
})
