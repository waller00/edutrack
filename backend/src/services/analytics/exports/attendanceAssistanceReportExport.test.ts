import { describe, expect, it, vi, beforeEach } from 'vitest'
import ExcelJS from 'exceljs'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    attendance: { findMany: vi.fn() },
    medicalLeave: { findMany: vi.fn() },
  },
}))

vi.mock('../../../db/prisma.js', () => ({ prisma: prismaMock }))

import {
  generateAttendanceAssistanceReportPdfFromAttendances,
  generateAttendanceAssistanceReportXlsxFromAttendances,
} from './attendanceAssistanceReportExport.js'

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

  it('generates a readable XLSX without duplicate headers when filters return no rows', async () => {
    prismaMock.attendance.findMany.mockResolvedValueOnce([])

    const buffer = await generateAttendanceAssistanceReportXlsxFromAttendances({
      filters: {
        from: '2026-05-01',
        to: '2026-05-31',
      },
    })

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer as any)
    const detail = workbook.getWorksheet('Detalle')

    expect(detail).toBeTruthy()
    expect(detail!.getRow(1).getCell(1).value).toBe('Fecha')
    expect(detail!.getRow(2).getCell(1).value).toBe('No hay datos para los filtros seleccionados')
    expect(detail!.getRow(2).getCell(1).value).not.toBe('Fecha')
    expect(detail!.getColumn(1).width).toBeGreaterThan(30)
  })
})
