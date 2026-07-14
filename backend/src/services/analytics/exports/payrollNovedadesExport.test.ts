import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { PayrollEventRow, PayrollPersonReport } from './payrollAttendanceReport.js'

const { buildDataMock, prismaMock } = vi.hoisted(() => ({
  buildDataMock: vi.fn(),
  prismaMock: {
    nonWorkingDay: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    medicalLeave: { findMany: vi.fn() },
  },
}))

vi.mock('./payrollAttendanceReport.js', () => ({ buildPayrollAttendanceData: buildDataMock }))
vi.mock('../../../db/prisma.js', () => ({ prisma: prismaMock }))

import {
  buildPayrollNovedadesData,
  generatePayrollNovedadesCsv,
  generatePayrollNovedadesXlsx,
  mergeAndCountDays,
  type NovedadesData,
} from './payrollNovedadesExport.js'

function row(partial: Partial<PayrollEventRow>): PayrollEventRow {
  return {
    fecha: '2026-07-01',
    evento: 'Clase',
    tipoEvento: 'Clase',
    horaPlanIn: '08:00',
    horaPlanOut: '09:00',
    horaRealIn: '',
    horaRealOut: '',
    estado: '',
    statusCode: 'PRESENT',
    isCoverage: false,
    minTarde: 0,
    horasTrab: 0,
    licencia: 'NO',
    observaciones: '-',
    ...partial,
  }
}

function person(userId: string, nombre: string, rows: PayrollEventRow[]): PayrollPersonReport {
  return { userId, nombre, rol: 'Docente', email: '', rows, stats: {} as PayrollPersonReport['stats'] }
}

const PARAMS = { from: '2026-07-01', to: '2026-07-31', filters: { role: 'TEACHER' } }

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.nonWorkingDay.findMany.mockResolvedValue([])
  prismaMock.user.findMany.mockResolvedValue([])
  prismaMock.medicalLeave.findMany.mockResolvedValue([])
  buildDataMock.mockResolvedValue({ persons: [] })
})

describe('buildPayrollNovedadesData', () => {
  it('acumula horas dictadas (propias PRESENT/LATE), suplencias y faltas; excluye faltas en feriados', async () => {
    buildDataMock.mockResolvedValue({
      persons: [
        person('u1', 'Pérez, Ana', [
          row({ statusCode: 'PRESENT', horasTrab: 2 }),
          row({ statusCode: 'LATE', horasTrab: 1.5 }),
          row({ statusCode: 'SUBSTITUTED', horasTrab: 0 }),
          row({ statusCode: 'PRESENT', horasTrab: 3, isCoverage: true }), // suplencia hecha por Ana
          row({ statusCode: 'ABSENT_NOT_JUSTIFIED', fecha: '2026-07-10' }),
          row({ statusCode: 'ABSENT_NOT_JUSTIFIED', fecha: '2026-07-18' }), // feriado: no cuenta
          row({ statusCode: 'ABSENT_JUSTIFIED', fecha: '2026-07-20' }),
        ]),
      ],
    })
    prismaMock.nonWorkingDay.findMany.mockResolvedValue([{ date: new Date('2026-07-18T00:00:00.000Z') }])
    prismaMock.user.findMany.mockResolvedValue([{ id: 'u1', nationalId: '4.123.456-7' }])

    const data = await buildPayrollNovedadesData(PARAMS)

    expect(data.periodo).toBe('2026-07')
    expect(data.warnings).toEqual([])
    expect(data.rows).toEqual([
      expect.objectContaining({ ci: '4.123.456-7', codigo: 'HORAS_DICTADAS', cantidad: 3.5, unidad: 'HORAS' }),
      expect.objectContaining({ codigo: 'HORAS_SUPLENCIA', cantidad: 3 }),
      expect.objectContaining({ codigo: 'FALTAS_INJUSTIFICADAS', cantidad: 1, unidad: 'CANTIDAD' }),
    ])
  })

  it('licencias: clampea al mes y fusiona solapes; consulta sólo licencias ACTIVE del rango', async () => {
    buildDataMock.mockResolvedValue({ persons: [person('u1', 'Pérez, Ana', [])] })
    prismaMock.user.findMany.mockResolvedValue([{ id: 'u1', nationalId: '1.234.567-8' }])
    prismaMock.medicalLeave.findMany.mockResolvedValue([
      // Empieza 5 días antes del mes → clampea al 1° de julio; termina el 10.
      { userId: 'u1', startDate: new Date('2026-06-26T00:00:00Z'), endDate: new Date('2026-07-10T00:00:00Z') },
      // Solapa con la anterior: no debe duplicar días.
      { userId: 'u1', startDate: new Date('2026-07-08T00:00:00Z'), endDate: new Date('2026-07-12T00:00:00Z') },
    ])

    const data = await buildPayrollNovedadesData(PARAMS)

    expect(data.rows).toEqual([
      expect.objectContaining({ codigo: 'DIAS_LICENCIA', cantidad: 12, unidad: 'DIAS' }), // 1 al 12 de julio
    ])
    expect(prismaMock.medicalLeave.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'ACTIVE', userId: { in: ['u1'] } }) }),
    )
  })

  it('docente sin cédula: exporta con CI vacía y lo lista en advertencias', async () => {
    buildDataMock.mockResolvedValue({
      persons: [person('u2', 'Sin Cédula, Juan', [row({ statusCode: 'PRESENT', horasTrab: 4 })])],
    })
    prismaMock.user.findMany.mockResolvedValue([{ id: 'u2', nationalId: null }])

    const data = await buildPayrollNovedadesData(PARAMS)

    expect(data.rows[0]).toMatchObject({ ci: '', codigo: 'HORAS_DICTADAS', cantidad: 4 })
    expect(data.warnings).toEqual([{ userId: 'u2', nombre: 'Sin Cédula, Juan' }])
  })

  it('no emite filas en cero: persona sin novedades no aparece', async () => {
    buildDataMock.mockResolvedValue({
      persons: [person('u1', 'Pérez, Ana', [row({ statusCode: 'ABSENT_JUSTIFIED' })])],
    })
    prismaMock.user.findMany.mockResolvedValue([{ id: 'u1', nationalId: '1.111.111-1' }])

    const data = await buildPayrollNovedadesData(PARAMS)
    expect(data.rows).toEqual([])
  })
})

describe('mergeAndCountDays', () => {
  const from = new Date('2026-07-01T00:00:00Z')
  const to = new Date('2026-07-31T23:59:59Z')

  it('cuenta días inclusivos, clampea al rango y fusiona rangos contiguos', () => {
    expect(mergeAndCountDays([], from, to)).toBe(0)
    expect(
      mergeAndCountDays([{ start: new Date('2026-07-05T00:00:00Z'), end: new Date('2026-07-05T00:00:00Z') }], from, to),
    ).toBe(1)
    expect(
      mergeAndCountDays(
        [
          { start: new Date('2026-07-01T00:00:00Z'), end: new Date('2026-07-03T00:00:00Z') },
          { start: new Date('2026-07-04T00:00:00Z'), end: new Date('2026-07-06T00:00:00Z') }, // contiguo: se fusiona
          { start: new Date('2026-07-20T00:00:00Z'), end: new Date('2026-08-15T00:00:00Z') }, // clamp al 31
        ],
        from,
        to,
      ),
    ).toBe(6 + 12)
  })
})

describe('render CSV / XLSX', () => {
  const data: NovedadesData = {
    from: '2026-07-01',
    to: '2026-07-31',
    periodo: '2026-07',
    rows: [
      { ci: '4.123.456-7', nombre: 'Pérez; "Ana"', codigo: 'HORAS_DICTADAS', concepto: 'Horas dictadas', cantidad: 3.5, unidad: 'HORAS', periodo: '2026-07' },
      { ci: '', nombre: 'Sin Cédula, Juan', codigo: 'FALTAS_INJUSTIFICADAS', concepto: 'Inasistencias injustificadas', cantidad: 2, unidad: 'CANTIDAD', periodo: '2026-07' },
    ],
    warnings: [{ userId: 'u2', nombre: 'Sin Cédula, Juan' }],
  }

  it('CSV: BOM UTF-8, separador ";", horas con coma decimal y escaping de ";"/comillas', () => {
    const csv = generatePayrollNovedadesCsv(data)
    expect(csv.startsWith('\uFEFF')).toBe(true)
    const lines = csv.replace('\uFEFF', '').trimEnd().split('\n')
    expect(lines[0]).toBe('CI;Nombre;Codigo;Concepto;Cantidad;Unidad;Periodo')
    expect(lines[1]).toBe('4.123.456-7;"Pérez; ""Ana""";HORAS_DICTADAS;Horas dictadas;3,50;HORAS;2026-07')
    expect(lines[2]).toBe(';Sin Cédula, Juan;FALTAS_INJUSTIFICADAS;Inasistencias injustificadas;2;CANTIDAD;2026-07')
  })

  it('XLSX: hoja Novedades y hoja Advertencias cuando hay docentes sin CI', async () => {
    const buffer = await generatePayrollNovedadesXlsx(data)
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Novedades', 'Advertencias'])
    expect(wb.worksheets[0].getRow(4).getCell(1).value).toBe('4.123.456-7')
  })

  it('XLSX sin advertencias: una sola hoja con fila de "sin datos" si no hay filas', async () => {
    const empty: NovedadesData = { ...data, rows: [], warnings: [] }
    const buffer = await generatePayrollNovedadesXlsx(empty)
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    expect(wb.worksheets).toHaveLength(1)
  })
})
