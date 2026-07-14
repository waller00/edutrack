import ExcelJS from 'exceljs'
import { prisma } from '../../../db/prisma.js'
import {
  buildPayrollAttendanceData,
  type PayrollPersonReport,
  type PayrollReportFilters,
} from './payrollAttendanceReport.js'
import { addNoDataRow, formatWorksheetForExport } from './excel-format.js'

/**
 * Novedades de liquidación de sueldos (liceos privados UY).
 *
 * Genera el archivo mensual que importan los sistemas de sueldos uruguayos (GNS Personal, Memory,
 * Kash, LIDESU): una fila por docente×concepto con la cantidad del período, usando la cédula
 * (`User.nationalId`) como clave — es el identificador que usan BPS/ATYRO y todos esos sistemas.
 * Sin montos: EduTrack aporta cantidades (horas/faltas/días); las tarifas viven en el sistema de
 * sueldos. Deriva todo del pipeline de conciliación existente (`buildPayrollAttendanceData`).
 */

export type NovedadUnit = 'HORAS' | 'CANTIDAD' | 'DIAS'

export type NovedadConcept = { code: string; label: string; unit: NovedadUnit }

/** Códigos estables; se pueden re-mapear por sistema pasando otro set al builder. */
export const NOVEDADES_CONCEPTS = {
  HORAS_DICTADAS: { code: 'HORAS_DICTADAS', label: 'Horas dictadas', unit: 'HORAS' },
  HORAS_SUPLENCIA: { code: 'HORAS_SUPLENCIA', label: 'Horas de suplencia', unit: 'HORAS' },
  FALTAS_INJUSTIFICADAS: { code: 'FALTAS_INJUSTIFICADAS', label: 'Inasistencias injustificadas', unit: 'CANTIDAD' },
  DIAS_LICENCIA: { code: 'DIAS_LICENCIA', label: 'Días de licencia médica', unit: 'DIAS' },
} as const satisfies Record<string, NovedadConcept>

export type NovedadesConceptSet = typeof NOVEDADES_CONCEPTS

export type NovedadRow = {
  ci: string
  nombre: string
  codigo: string
  concepto: string
  cantidad: number
  unidad: NovedadUnit
  periodo: string
}

export type NovedadesWarning = { userId: string; nombre: string }

export type NovedadesData = {
  from: string
  to: string
  /** Período YYYY-MM (ayuda al mapeo en los importadores). */
  periodo: string
  rows: NovedadRow[]
  /** Docentes sin cédula cargada: se exportan con CI vacía y se listan acá. */
  warnings: NovedadesWarning[]
}

function roundTo2(n: number) {
  return Math.round(n * 100) / 100
}

function toEpochDay(d: Date) {
  return Math.floor(d.getTime() / 86_400_000)
}

/**
 * Días calendario cubiertos por los rangos dentro de `[fromDate, toDate]`, fusionando solapes
 * para no contar doble (una docente puede tener licencias contiguas o superpuestas).
 */
export function mergeAndCountDays(
  ranges: Array<{ start: Date; end: Date }>,
  fromDate: Date,
  toDate: Date,
): number {
  const lo = toEpochDay(fromDate)
  const hi = toEpochDay(toDate)
  const clamped = ranges
    .map((r) => [Math.max(toEpochDay(r.start), lo), Math.min(toEpochDay(r.end), hi)] as const)
    .filter(([s, e]) => s <= e)
    .sort((a, b) => a[0] - b[0])

  let total = 0
  let curStart: number | null = null
  let curEnd = 0
  for (const [s, e] of clamped) {
    if (curStart === null || s > curEnd + 1) {
      if (curStart !== null) total += curEnd - curStart + 1
      curStart = s
      curEnd = e
    } else {
      curEnd = Math.max(curEnd, e)
    }
  }
  if (curStart !== null) total += curEnd - curStart + 1
  return total
}

export type PersonConceptTotals = { horasDictadas: number; horasSuplencia: number; faltas: number }

/**
 * Acumula los conceptos de asistencia de una persona a partir de las filas ya conciliadas.
 * Las faltas en días no laborables (feriados) no se cuentan: el pipeline global todavía no
 * descuenta `NonWorkingDay`, así que se filtra acá por fecha.
 */
export function accumulatePersonConcepts(
  person: PayrollPersonReport,
  nonWorkingYmd: Set<string>,
): PersonConceptTotals {
  let horasDictadas = 0
  let horasSuplencia = 0
  let faltas = 0
  for (const r of person.rows) {
    if (r.isCoverage) {
      horasSuplencia += r.horasTrab
    } else if (r.statusCode === 'PRESENT' || r.statusCode === 'LATE') {
      horasDictadas += r.horasTrab
    } else if (r.statusCode === 'ABSENT_NOT_JUSTIFIED' && !nonWorkingYmd.has(r.fecha)) {
      faltas += 1
    }
  }
  return { horasDictadas: roundTo2(horasDictadas), horasSuplencia: roundTo2(horasSuplencia), faltas }
}

function pushConceptRow(
  rows: NovedadRow[],
  base: { ci: string; nombre: string; periodo: string },
  concept: NovedadConcept,
  cantidad: number,
) {
  if (cantidad <= 0) return // las novedades son deltas: los importadores no esperan filas en cero
  rows.push({ ...base, codigo: concept.code, concepto: concept.label, cantidad, unidad: concept.unit })
}

export async function buildPayrollNovedadesData(
  params: { from: string; to: string; filters: PayrollReportFilters },
  concepts: NovedadesConceptSet = NOVEDADES_CONCEPTS,
): Promise<NovedadesData> {
  const data = await buildPayrollAttendanceData(params)
  const fromDate = new Date(`${params.from}T00:00:00.000Z`)
  const toDate = new Date(`${params.to}T23:59:59.999Z`)
  const periodo = params.from.slice(0, 7)
  const userIds = data.persons.map((p) => p.userId)

  const [nonWorkingDays, users, leaves] = await Promise.all([
    prisma.nonWorkingDay.findMany({ where: { date: { gte: fromDate, lte: toDate } }, select: { date: true } }),
    userIds.length
      ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, nationalId: true } })
      : Promise.resolve([]),
    userIds.length
      ? prisma.medicalLeave.findMany({
          where: { status: 'ACTIVE', userId: { in: userIds }, startDate: { lte: toDate }, endDate: { gte: fromDate } },
          select: { userId: true, startDate: true, endDate: true },
        })
      : Promise.resolve([]),
  ])

  const nonWorkingYmd = new Set(nonWorkingDays.map((d) => d.date.toISOString().slice(0, 10)))
  const ciByUser = new Map(users.map((u) => [u.id, u.nationalId ?? '']))
  const leavesByUser = new Map<string, Array<{ start: Date; end: Date }>>()
  for (const l of leaves) {
    if (!leavesByUser.has(l.userId)) leavesByUser.set(l.userId, [])
    leavesByUser.get(l.userId)!.push({ start: l.startDate, end: l.endDate })
  }

  const rows: NovedadRow[] = []
  const warnings: NovedadesWarning[] = []
  for (const person of data.persons) {
    const ci = ciByUser.get(person.userId) ?? ''
    if (!ci) warnings.push({ userId: person.userId, nombre: person.nombre })
    const base = { ci, nombre: person.nombre, periodo }
    const totals = accumulatePersonConcepts(person, nonWorkingYmd)
    pushConceptRow(rows, base, concepts.HORAS_DICTADAS, totals.horasDictadas)
    pushConceptRow(rows, base, concepts.HORAS_SUPLENCIA, totals.horasSuplencia)
    pushConceptRow(rows, base, concepts.FALTAS_INJUSTIFICADAS, totals.faltas)
    pushConceptRow(
      rows,
      base,
      concepts.DIAS_LICENCIA,
      mergeAndCountDays(leavesByUser.get(person.userId) ?? [], fromDate, toDate),
    )
  }

  return { from: params.from, to: params.to, periodo, rows, warnings }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

const HEADERS = ['CI', 'Nombre', 'Codigo', 'Concepto', 'Cantidad', 'Unidad', 'Periodo'] as const

function csvEscape(v: unknown) {
  const s = String(v ?? '')
  if (/[";\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`
  return s
}

/** Horas con coma decimal (Excel/importadores es-UY); cantidades y días como enteros. */
function fmtCantidad(cantidad: number, unidad: NovedadUnit) {
  return unidad === 'HORAS' ? cantidad.toFixed(2).replace('.', ',') : String(cantidad)
}

/** CSV con separador `;` y BOM UTF-8: es lo que Excel es-UY y los importadores locales esperan. */
export function generatePayrollNovedadesCsv(data: NovedadesData): string {
  const lines = [HEADERS.join(';')]
  for (const r of data.rows) {
    lines.push(
      [r.ci, r.nombre, r.codigo, r.concepto, fmtCantidad(r.cantidad, r.unidad), r.unidad, r.periodo]
        .map(csvEscape)
        .join(';'),
    )
  }
  return `\uFEFF${lines.join('\n')}\n`
}

export async function generatePayrollNovedadesXlsx(data: NovedadesData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Novedades')
  sheet.addRow([`Novedades de liquidación de sueldos — ${data.periodo}`])
  sheet.addRow([`Período: ${data.from} a ${data.to}`])
  sheet.addRow([...HEADERS])
  for (const r of data.rows) {
    sheet.addRow([r.ci, r.nombre, r.codigo, r.concepto, r.cantidad, r.unidad, r.periodo])
  }
  if (data.rows.length === 0) addNoDataRow(sheet, HEADERS.length)
  formatWorksheetForExport(sheet, { headerRow: 3 })

  if (data.warnings.length > 0) {
    const ws = workbook.addWorksheet('Advertencias')
    ws.addRow(['Docentes sin cédula (CI): completar en el perfil del usuario y volver a exportar'])
    ws.addRow(['Nombre', 'ID de usuario'])
    for (const w of data.warnings) ws.addRow([w.nombre, w.userId])
    formatWorksheetForExport(ws, { headerRow: 2 })
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
