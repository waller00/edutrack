import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'
import { DateTime } from 'luxon'
import type { AttendanceStatus, EventType } from '@prisma/client'
import { prisma } from '../../../db/prisma.js'
import { APP_TIMEZONE } from '../../../config/app-timezone.js'
import { selectOrgRoleCode, attachRoleCode } from '../../../identity/user-role-prisma.js'
import { getPlannedInstances } from '../planInstances.js'
import { resolveAttendanceAndJustification } from '../resolveInstances.js'
import { toYmdInUruguay } from '../dateRange.js'
import type { PlannedInstance, ResolvedAttendanceByInstance } from '../models.js'
import {
  buildPresenceSpans,
  coverageForOccurrence,
  type AttendanceRowLite,
} from '../../attendance/coverage-spans.js'
import { scopeUserIdsFor, resolveScopedSchoolYearId } from './exportScope.js'
import { addNoDataRow, formatWorksheetForExport } from './excel-format.js'

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export type PayrollReportFilters = {
  role?: string
  userId?: string
  eventId?: string
  eventType?: EventType
  status?: AttendanceStatus
  schoolYearId?: string
  allYears?: boolean
}

export type PayrollEventRow = {
  fecha: string
  evento: string
  tipoEvento: string
  horaPlanIn: string
  horaPlanOut: string
  horaRealIn: string
  horaRealOut: string
  estado: string
  minTarde: number
  horasTrab: number
  licencia: 'SI' | 'NO'
  observaciones: string
}

export type PayrollStats = {
  esperadas: number
  presente: number
  tarde: number
  ausenteJustificado: number
  ausenteNoJustificado: number
  suplido: number
  cobertura: number
  pctPuntualidad: number
  pctAsistencia: number
  pctAusentismo: number
  horasTrabajadas: number
  horasPlanificadas: number
  deltaHoras: number
  minTardeAcumulados: number
  minTardePromedio: number
}

export type PayrollPersonReport = {
  userId: string
  nombre: string
  rol: string
  email: string
  rows: PayrollEventRow[]
  stats: PayrollStats
}

export type PayrollReportData = {
  from: string
  to: string
  filterLines: string[]
  persons: PayrollPersonReport[]
  total: PayrollStats
}

// Instancia resuelta + bandera de cobertura (suplente que cubre una clase ajena).
type ResolvedItem = ResolvedAttendanceByInstance & { isCoverage?: boolean }

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<string, string> = {
  PRESENT: 'Presente',
  LATE: 'Tarde',
  ABSENT_JUSTIFIED: 'Ausente justificado',
  ABSENT_NOT_JUSTIFIED: 'Ausente no justificado',
  SUBSTITUTED: 'Suplido',
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  JORNADA_LABORAL: 'Jornada laboral',
  REUNION: 'Reunión',
  CLASE: 'Clase',
  EVENTO: 'Evento',
  CAPACITACION: 'Capacitación',
  CITA_MEDICA: 'Cita médica',
}

const ROLE_LABELS: Record<string, string> = {
  TEACHER: 'Docente',
  STAFF: 'Equipo administrativo',
  ADMIN: 'Administrador',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function roundTo(n: number, decimals = 2) {
  const f = 10 ** decimals
  return Math.round(n * f) / f
}

function pct(part: number, total: number) {
  if (total <= 0) return 0
  return roundTo((part / total) * 100)
}

function fmtUyHm(d: Date | null) {
  if (!d) return ''
  return DateTime.fromJSDate(d, { zone: 'utc' }).setZone(APP_TIMEZONE).toFormat('HH:mm')
}

function plannedMinutesOf(start: Date | null, end: Date | null) {
  if (!start || !end) return 0
  return Math.max(0, (end.getTime() - start.getTime()) / 60000)
}

function lateMinutesOf(item: ResolvedItem) {
  if (item.checkInStatusResolved !== 'LATE') return 0
  if (!item.actualInTime || !item.planned.plannedStartTime) return 0
  const ms = item.actualInTime.getTime() - item.planned.plannedStartTime.getTime()
  return ms > 0 ? Math.round(ms / 60000) : 0
}

function isPresenceStatus(status: string, isCoverage?: boolean) {
  return isCoverage || status === 'PRESENT' || status === 'LATE'
}

function sanitizeSingleLine(v: unknown) {
  return String(v ?? '')
    .replaceAll(/[\r\n]+/g, ' ')
    .trim()
}

function displayNameOf(u: {
  name: string | null
  username: string | null
  firstName: string | null
  lastName: string | null
}) {
  if (u.name) return u.name
  const full = `${u.firstName || ''} ${u.lastName || ''}`.trim()
  return full || u.username || 'Sin nombre'
}

// ---------------------------------------------------------------------------
// Construcción de datos
// ---------------------------------------------------------------------------

/** Instancias sintéticas de cobertura: el suplente que cubre una clase ajena (suma presencia y horas). */
async function buildCoverageItems(params: {
  fromDate: Date
  toDate: Date
  userIds: string[] | null
  eventId?: string
  eventType?: EventType
  schoolYearId?: string
}): Promise<ResolvedItem[]> {
  // Las suplencias son siempre sobre clases; si se filtra por otro tipo, no hay cobertura.
  if (params.eventType && params.eventType !== 'CLASE') return []

  const where: any = {
    date: { gte: params.fromDate, lte: params.toDate },
  }
  if (params.userIds) where.substituteUserId = { in: params.userIds }
  if (params.eventId) where.eventId = params.eventId
  if (params.schoolYearId) where.event = { schoolYearId: params.schoolYearId }

  const subs = await (prisma as any).substitution.findMany({
    where,
    include: {
      event: { select: { id: true, title: true, type: true, status: true } },
      substitute: {
        select: { id: true, name: true, username: true, firstName: true, lastName: true, email: true, ...selectOrgRoleCode },
      },
    },
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
  })

  if (subs.length === 0) return []

  // Fichajes reales de los suplentes para calcular horas efectivas de cobertura.
  const subUserIds: string[] = Array.from(new Set<string>(subs.map((s: any) => String(s.substituteUserId))))
  const punches = await prisma.attendance.findMany({
    where: {
      userId: { in: subUserIds },
      date: { gte: params.fromDate, lte: params.toDate },
      type: { in: ['CHECK_IN', 'CHECK_OUT'] },
    },
    select: { id: true, userId: true, eventId: true, date: true, time: true, type: true, status: true, notes: true },
  })
  const spans = buildPresenceSpans(punches as AttendanceRowLite[])

  const items: ResolvedItem[] = []
  for (const s of subs) {
    const ymd = toYmdInUruguay(s.date)
    const plannedStart: Date = s.startTime
    const plannedEnd: Date = s.endTime
    const cov = coverageForOccurrence(
      { userId: s.substituteUserId, ymd, plannedStart, plannedEnd },
      spans,
    )
    const durationMinutes = cov.covered ? cov.overlapMinutes : plannedMinutesOf(plannedStart, plannedEnd)
    const actualIn = cov.span ? new Date(cov.span.checkIn.time) : plannedStart
    const actualOut = cov.span?.checkOut ? new Date(cov.span.checkOut.time) : plannedEnd

    const subUser = attachRoleCode(s.substitute)
    const planned: PlannedInstance = {
      plannedInstanceId: `${s.eventId}_${ymd}_sub_${s.substituteUserId}`,
      eventId: s.eventId,
      eventTitle: s.event.title,
      eventType: s.event.type,
      eventStatus: s.event.status,
      isRecurringInstance: false,
      plannedDate: ymd,
      plannedStartTime: plannedStart,
      plannedEndTime: plannedEnd,
      userIdRequired: s.substituteUserId,
      courseOfferingId: null,
      courseLabel: null,
      subjectLabel: null,
    }

    items.push({
      planned,
      checkInStatusResolved: 'PRESENT',
      checkOutStatusResolved: 'EXIT',
      hasCheckIn: cov.covered,
      hasCheckOut: Boolean(cov.span?.checkOut),
      actualInTime: actualIn,
      actualOutTime: actualOut,
      durationMinutes,
      isJustifiedAbsence: false,
      licenseIdJustifying: null,
      checkInNotes: `Suplencia cubierta: ${s.reason}`,
      checkOutNotes: null,
      userDisplayName: displayNameOf(s.substitute),
      userRole: subUser.role || 'TEACHER',
      userEmail: s.substitute.email || '',
      isCoverage: true,
    })
  }

  return items
}

function computeStats(items: ResolvedItem[]): PayrollStats {
  let presente = 0
  let tarde = 0
  let ausenteJustificado = 0
  let ausenteNoJustificado = 0
  let suplido = 0
  let cobertura = 0
  let horasTrabajadasMin = 0
  let horasPlanificadasMin = 0
  let minTardeAcumulados = 0

  for (const it of items) {
    const st = it.checkInStatusResolved
    if (it.isCoverage) cobertura += 1
    if (st === 'PRESENT') presente += 1
    else if (st === 'LATE') tarde += 1
    else if (st === 'ABSENT_JUSTIFIED') ausenteJustificado += 1
    else if (st === 'ABSENT_NOT_JUSTIFIED') ausenteNoJustificado += 1
    else if (st === 'SUBSTITUTED') suplido += 1

    horasTrabajadasMin += it.durationMinutes
    horasPlanificadasMin += plannedMinutesOf(it.planned.plannedStartTime, it.planned.plannedEndTime)
    minTardeAcumulados += lateMinutesOf(it)
  }

  const esperadas = items.length
  const presenciaTotal = presente + tarde
  const ausenciasTotal = ausenteJustificado + ausenteNoJustificado + suplido
  const horasTrabajadas = roundTo(horasTrabajadasMin / 60)
  const horasPlanificadas = roundTo(horasPlanificadasMin / 60)

  return {
    esperadas,
    presente,
    tarde,
    ausenteJustificado,
    ausenteNoJustificado,
    suplido,
    cobertura,
    pctPuntualidad: pct(presente, presenciaTotal),
    pctAsistencia: pct(presenciaTotal, esperadas),
    pctAusentismo: pct(ausenciasTotal, esperadas),
    horasTrabajadas,
    horasPlanificadas,
    deltaHoras: roundTo(horasTrabajadas - horasPlanificadas),
    minTardeAcumulados,
    minTardePromedio: tarde > 0 ? roundTo(minTardeAcumulados / tarde) : 0,
  }
}

function toEventRow(it: ResolvedItem): PayrollEventRow {
  const presence = isPresenceStatus(it.checkInStatusResolved, it.isCoverage)
  const estado = it.isCoverage ? 'Cobertura (suplencia)' : STATUS_LABELS[it.checkInStatusResolved] ?? it.checkInStatusResolved
  return {
    fecha: it.planned.plannedDate,
    evento: it.isCoverage ? `${it.planned.eventTitle} (suplencia)` : it.planned.eventTitle || 'Sin título',
    tipoEvento: EVENT_TYPE_LABELS[it.planned.eventType] ?? it.planned.eventType,
    horaPlanIn: fmtUyHm(it.planned.plannedStartTime),
    horaPlanOut: fmtUyHm(it.planned.plannedEndTime),
    horaRealIn: presence ? fmtUyHm(it.actualInTime) : '',
    horaRealOut: presence ? fmtUyHm(it.actualOutTime) : '',
    estado,
    minTarde: lateMinutesOf(it),
    horasTrab: roundTo(it.durationMinutes / 60),
    licencia: it.isJustifiedAbsence ? 'SI' : 'NO',
    observaciones: sanitizeSingleLine(it.checkInNotes || it.checkOutNotes || '') || '-',
  }
}

function buildFilterLines(filters: PayrollReportFilters, personById: Map<string, PayrollPersonReport>) {
  const lines: string[] = []
  if (filters.role) lines.push(`Rol: ${ROLE_LABELS[filters.role] ?? filters.role}`)
  if (filters.userId) {
    const p = personById.get(filters.userId)
    lines.push(`Persona: ${p?.nombre ?? filters.userId}`)
  }
  if (filters.eventType) lines.push(`Tipo de evento: ${EVENT_TYPE_LABELS[filters.eventType] ?? filters.eventType}`)
  if (filters.eventId) lines.push(`Evento ID: ${filters.eventId}`)
  if (filters.status) lines.push(`Estado: ${STATUS_LABELS[filters.status] ?? filters.status}`)
  if (filters.allYears) lines.push('Ciclo: todos los ciclos')
  return lines
}

export async function buildPayrollAttendanceData(params: {
  from: string
  to: string
  filters: PayrollReportFilters
}): Promise<PayrollReportData> {
  const { from, to, filters } = params
  const fromDate = new Date(`${from}T00:00:00.000Z`)
  const toDate = new Date(`${to}T23:59:59.999Z`)

  const allYearsExport = filters.allYears === true
  const userIds = await scopeUserIdsFor(filters)
  const schoolYearId = await resolveScopedSchoolYearId(filters, allYearsExport)

  // 1) Instancias esperadas de titulares.
  const plannedInstances = await getPlannedInstances({
    from,
    to,
    userId: filters.userId,
    userIds: userIds || undefined,
    eventType: filters.eventType,
    schoolYearId,
  })
  const titularItems: ResolvedItem[] = await resolveAttendanceAndJustification({ plannedInstances })

  // 2) Instancias de cobertura (suplente).
  const coverageItems = await buildCoverageItems({
    fromDate,
    toDate,
    userIds,
    eventId: filters.eventId,
    eventType: filters.eventType,
    schoolYearId,
  })

  // 3) Filtros post-resolución (eventId / status). type no aplica a un formato evento-por-evento.
  let items = [...titularItems, ...coverageItems]
  if (filters.eventId) items = items.filter((it) => it.planned.eventId === filters.eventId)
  if (filters.status) items = items.filter((it) => it.checkInStatusResolved === filters.status)

  // 4) Agrupar por persona.
  const byUser = new Map<string, ResolvedItem[]>()
  for (const it of items) {
    const uid = it.planned.userIdRequired
    if (!uid) continue
    if (!byUser.has(uid)) byUser.set(uid, [])
    byUser.get(uid)!.push(it)
  }

  const persons: PayrollPersonReport[] = []
  for (const [userId, userItems] of byUser) {
    userItems.sort((a, b) => {
      if (a.planned.plannedDate !== b.planned.plannedDate) return a.planned.plannedDate.localeCompare(b.planned.plannedDate)
      const ai = a.planned.plannedStartTime?.getTime() ?? 0
      const bi = b.planned.plannedStartTime?.getTime() ?? 0
      return ai - bi
    })
    const sample = userItems[0]
    persons.push({
      userId,
      nombre: sample.userDisplayName || 'Sin nombre',
      rol: ROLE_LABELS[sample.userRole] ?? sample.userRole,
      email: sample.userEmail || '',
      rows: userItems.map(toEventRow),
      stats: computeStats(userItems),
    })
  }
  persons.sort((a, b) => a.nombre.localeCompare(b.nombre))

  const personById = new Map(persons.map((p) => [p.userId, p]))
  const total = computeStats(items)

  return {
    from,
    to,
    filterLines: buildFilterLines(filters, personById),
    persons,
    total,
  }
}

// ---------------------------------------------------------------------------
// Render XLSX
// ---------------------------------------------------------------------------

const SUMMARY_HEADERS = [
  'Persona',
  'Rol',
  'Esperadas',
  'Presente',
  'Tarde',
  'Aus. Just.',
  'Aus. No Just.',
  'Suplido',
  'Cobertura',
  '% Puntualidad',
  '% Asistencia',
  '% Ausentismo',
  'Horas Trab.',
  'Horas Plan.',
  'Δ Horas',
  'Min Tarde',
  'Min Tarde Prom.',
]

const DETAIL_HEADERS = [
  'Fecha',
  'Evento',
  'Tipo',
  'Plan. Entrada',
  'Plan. Salida',
  'Real Entrada',
  'Real Salida',
  'Estado',
  'Min Tarde',
  'Horas Trab.',
  'Licencia',
  'Observaciones',
]

function statsRow(label: string, role: string, s: PayrollStats) {
  return [
    label,
    role,
    s.esperadas,
    s.presente,
    s.tarde,
    s.ausenteJustificado,
    s.ausenteNoJustificado,
    s.suplido,
    s.cobertura,
    s.pctPuntualidad,
    s.pctAsistencia,
    s.pctAusentismo,
    s.horasTrabajadas,
    s.horasPlanificadas,
    s.deltaHoras,
    s.minTardeAcumulados,
    s.minTardePromedio,
  ]
}

function safeSheetName(base: string, used: Set<string>) {
  let name = (base || 'Persona').replaceAll(/[\\/?*[\]:]/g, ' ').slice(0, 28).trim() || 'Persona'
  let candidate = name
  let i = 2
  while (used.has(candidate.toLowerCase())) {
    candidate = `${name.slice(0, 25)} ${i}`
    i += 1
  }
  used.add(candidate.toLowerCase())
  return candidate
}

export async function generatePayrollAttendanceXlsx(data: PayrollReportData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'EduTrack'

  // HOJA Resumen
  const summary = workbook.addWorksheet('Resumen')
  summary.addRow(['EduTrack'])
  summary.addRow(['Reporte', 'Asistencias por persona (liquidación)'])
  summary.addRow(['Período', `${data.from} a ${data.to}`])
  if (data.filterLines.length) {
    summary.addRow(['Filtros', data.filterLines.join('  |  ')])
  }
  summary.addRow([])
  summary.getRow(1).font = { bold: true, size: 14 }

  const headerRowNumber = summary.lastRow!.number + 1
  summary.addRow(SUMMARY_HEADERS)
  for (const p of data.persons) summary.addRow(statsRow(p.nombre, p.rol, p.stats))
  summary.addRow(statsRow('TOTAL', '', data.total))
  if (data.persons.length === 0) addNoDataRow(summary, SUMMARY_HEADERS.length)
  const totalRow = summary.lastRow!
  if (data.persons.length > 0) totalRow.font = { bold: true }
  formatWorksheetForExport(summary, { headerRow: headerRowNumber, maxWidth: 30, autoFilter: false, freezeHeader: false })

  // HOJA por persona
  const used = new Set<string>(['resumen'])
  for (const p of data.persons) {
    const sheet = workbook.addWorksheet(safeSheetName(p.nombre, used))
    sheet.addRow([p.nombre])
    sheet.addRow(['Rol', p.rol])
    if (p.email) sheet.addRow(['Email', p.email])
    sheet.addRow(['Período', `${data.from} a ${data.to}`])
    sheet.addRow([])
    sheet.getRow(1).font = { bold: true, size: 13 }

    const detailHeaderRow = sheet.lastRow!.number + 1
    sheet.addRow(DETAIL_HEADERS)
    for (const r of p.rows) {
      sheet.addRow([
        r.fecha,
        r.evento,
        r.tipoEvento,
        r.horaPlanIn,
        r.horaPlanOut,
        r.horaRealIn,
        r.horaRealOut,
        r.estado,
        r.minTarde,
        r.horasTrab,
        r.licencia,
        r.observaciones,
      ])
    }
    if (p.rows.length === 0) addNoDataRow(sheet, DETAIL_HEADERS.length)

    // Bloque de estadísticas al final
    sheet.addRow([])
    const st = p.stats
    const statLines: Array<[string, string | number]> = [
      ['Asistencias esperadas', st.esperadas],
      ['Presente', st.presente],
      ['Tarde', st.tarde],
      ['Ausente justificado', st.ausenteJustificado],
      ['Ausente no justificado', st.ausenteNoJustificado],
      ['Suplido', st.suplido],
      ['Cobertura (suplencias cubiertas)', st.cobertura],
      ['% Puntualidad', `${st.pctPuntualidad}%`],
      ['% Asistencia', `${st.pctAsistencia}%`],
      ['% Ausentismo', `${st.pctAusentismo}%`],
      ['Horas trabajadas', st.horasTrabajadas],
      ['Horas planificadas', st.horasPlanificadas],
      ['Δ Horas (trab - plan)', st.deltaHoras],
      ['Min tarde acumulados', st.minTardeAcumulados],
      ['Min tarde promedio', st.minTardePromedio],
    ]
    const statTitleRow = sheet.addRow(['Estadísticas'])
    statTitleRow.font = { bold: true }
    for (const [k, v] of statLines) sheet.addRow([k, v])

    formatWorksheetForExport(sheet, { headerRow: detailHeaderRow, maxWidth: 40, autoFilter: false, freezeHeader: false })
  }

  const out = await workbook.xlsx.writeBuffer()
  return Buffer.from(out)
}

// ---------------------------------------------------------------------------
// Render PDF
// ---------------------------------------------------------------------------

function truncate(text: string, max: number) {
  const t = sanitizeSingleLine(text)
  if (t.length <= max) return t
  return `${t.slice(0, Math.max(1, max - 1))}…`
}

type PdfCol = { header: string; w: number; get: (r: PayrollEventRow) => string }

export async function generatePayrollAttendancePdf(data: PayrollReportData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 40 })
  const chunks: Buffer[] = []
  doc.on('data', (c) => chunks.push(c as Buffer))

  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right
  const marginLeft = doc.page.margins.left
  const bottomY = doc.page.height - doc.page.margins.bottom

  // Header documento
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#1F4E79').text('EduTrack', { width: usableWidth })
  doc.moveDown(0.2)
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#111827').text('Reporte: Asistencias por persona (liquidación)', { width: usableWidth })
  doc.moveDown(0.1)
  doc.font('Helvetica').fontSize(10).fillColor('#374151').text(`Período: ${data.from} a ${data.to}`, { width: usableWidth })
  for (const l of data.filterLines) doc.text(l, { width: usableWidth })
  doc.moveDown(0.6)

  const baseCols: PdfCol[] = [
    { header: 'Fecha', w: 52, get: (r) => r.fecha },
    { header: 'Evento', w: 95, get: (r) => r.evento },
    { header: 'Tipo', w: 58, get: (r) => r.tipoEvento },
    { header: 'P.Ent', w: 34, get: (r) => r.horaPlanIn },
    { header: 'P.Sal', w: 34, get: (r) => r.horaPlanOut },
    { header: 'R.Ent', w: 34, get: (r) => r.horaRealIn },
    { header: 'R.Sal', w: 34, get: (r) => r.horaRealOut },
    { header: 'Estado', w: 72, get: (r) => r.estado },
    { header: 'Tarde', w: 30, get: (r) => (r.minTarde ? String(r.minTarde) : '') },
    { header: 'Horas', w: 34, get: (r) => (r.horasTrab ? String(r.horasTrab) : '') },
    { header: 'Lic', w: 24, get: (r) => r.licencia },
    { header: 'Obs', w: 60, get: (r) => r.observaciones },
  ]
  const totalW = baseCols.reduce((s, c) => s + c.w, 0)
  const scale = usableWidth / totalW
  const cols = baseCols.map((c) => ({ ...c, w: c.w * scale }))
  const tableFont = 7.5
  const rowH = 14
  const pad = 2

  const colX = (i: number) => marginLeft + cols.slice(0, i).reduce((s, c) => s + c.w, 0)

  function drawHeader(y: number) {
    doc.font('Helvetica-Bold').fontSize(tableFont)
    for (let i = 0; i < cols.length; i++) {
      const x = colX(i)
      doc.rect(x, y, cols[i].w, rowH).fillAndStroke('#2F5597', '#2F5597')
      doc.fillColor('#FFFFFF').text(truncate(cols[i].header, Math.floor(cols[i].w / (tableFont * 0.55))), x + pad, y + 4, {
        width: cols[i].w - pad * 2,
        height: rowH,
      })
    }
    doc.fillColor('#000000')
  }

  function drawRow(y: number, r: PayrollEventRow, index: number) {
    const bg = index % 2 === 0 ? '#F9FAFB' : '#FFFFFF'
    doc.font('Helvetica').fontSize(tableFont)
    for (let i = 0; i < cols.length; i++) {
      const x = colX(i)
      doc.rect(x, y, cols[i].w, rowH).fillAndStroke(bg, '#E5E7EB')
      doc.fillColor('#111827')
      const maxChars = Math.max(1, Math.floor((cols[i].w - pad * 2) / (tableFont * 0.55)))
      doc.text(truncate(cols[i].get(r), maxChars), x + pad, y + 3, { width: cols[i].w - pad * 2, height: rowH })
    }
  }

  function ensure(yNeeded: number) {
    if (yNeeded > bottomY) {
      doc.addPage()
      return doc.page.margins.top
    }
    return doc.y
  }

  function renderStatsBlock(title: string, s: PayrollStats) {
    const y = ensure(doc.y + 90)
    doc.y = y
    // Reset de X: tras dibujar la tabla, doc.x quedó en la última columna (derecha).
    doc.x = marginLeft
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text(title, marginLeft, doc.y, { width: usableWidth })
    doc.moveDown(0.2)
    doc.font('Helvetica').fontSize(9).fillColor('#374151')
    const lines = [
      `Asistencias esperadas: ${s.esperadas}`,
      `Presente: ${s.presente}   Tarde: ${s.tarde}`,
      `Ausente just.: ${s.ausenteJustificado}   Ausente no just.: ${s.ausenteNoJustificado}`,
      `Suplido: ${s.suplido}   Cobertura: ${s.cobertura}`,
      `% Puntualidad: ${s.pctPuntualidad}%   % Asistencia: ${s.pctAsistencia}%   % Ausentismo: ${s.pctAusentismo}%`,
      `Horas trabajadas: ${s.horasTrabajadas}   Horas planificadas: ${s.horasPlanificadas}   Δ: ${s.deltaHoras}`,
      `Min tarde acumulados: ${s.minTardeAcumulados}   Promedio: ${s.minTardePromedio}`,
    ]
    for (const l of lines) doc.text(l, marginLeft, doc.y, { width: usableWidth })
    doc.moveDown(0.6)
  }

  if (data.persons.length === 0) {
    doc.font('Helvetica').fontSize(10).fillColor('#374151').text('No hay datos para los filtros seleccionados.', { width: usableWidth })
    return finalize(doc, chunks)
  }

  for (const p of data.persons) {
    // Título de persona
    const y = ensure(doc.y + 40 + rowH)
    doc.y = y
    doc.x = marginLeft
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#1F4E79').text(p.nombre, marginLeft, doc.y, { width: usableWidth })
    doc.font('Helvetica').fontSize(9).fillColor('#374151').text(`${p.rol}${p.email ? '  ·  ' + p.email : ''}`, marginLeft, doc.y, { width: usableWidth })
    doc.moveDown(0.3)

    // Tabla evento por evento
    let tableY = doc.y
    if (tableY + rowH * 2 > bottomY) {
      doc.addPage()
      tableY = doc.page.margins.top
    }
    drawHeader(tableY)
    tableY += rowH
    for (let i = 0; i < p.rows.length; i++) {
      if (tableY + rowH > bottomY) {
        doc.addPage()
        tableY = doc.page.margins.top
        drawHeader(tableY)
        tableY += rowH
      }
      drawRow(tableY, p.rows[i], i)
      tableY += rowH
    }
    doc.y = tableY + 8

    renderStatsBlock('Estadísticas', p.stats)
  }

  // Total general (solo tiene sentido cuando hay más de una persona)
  if (data.persons.length > 1) {
    const y = ensure(doc.y + 100)
    doc.y = y
    doc.x = marginLeft
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#1F4E79').text('Total general', marginLeft, doc.y, { width: usableWidth })
    doc.moveDown(0.2)
    renderStatsBlock('Estadísticas (todas las personas)', data.total)
  }

  return finalize(doc, chunks)
}

async function finalize(doc: PDFKit.PDFDocument, chunks: Buffer[]) {
  const finished = new Promise<void>((resolve, reject) => {
    doc.on('end', () => resolve())
    doc.on('error', (e) => reject(e))
  })
  doc.end()
  await finished
  return Buffer.concat(chunks)
}

// ---------------------------------------------------------------------------
// Render CSV (plano, una fila por instancia, con columna persona)
// ---------------------------------------------------------------------------

const CSV_COLUMNS = [
  'Persona',
  'Rol',
  'Fecha',
  'Evento',
  'Tipo',
  'Plan Entrada',
  'Plan Salida',
  'Real Entrada',
  'Real Salida',
  'Estado',
  'Min Tarde',
  'Horas Trab',
  'Licencia',
  'Observaciones',
] as const

function csvEscape(v: unknown) {
  const s = String(v ?? '')
  if (/[",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`
  return s
}

export function generatePayrollAttendanceCsv(data: PayrollReportData): string {
  const header = CSV_COLUMNS.join(',')
  const lines: string[] = []
  for (const p of data.persons) {
    for (const r of p.rows) {
      lines.push(
        [
          p.nombre,
          p.rol,
          r.fecha,
          r.evento,
          r.tipoEvento,
          r.horaPlanIn,
          r.horaPlanOut,
          r.horaRealIn,
          r.horaRealOut,
          r.estado,
          r.minTarde,
          r.horasTrab,
          r.licencia,
          r.observaciones,
        ]
          .map(csvEscape)
          .join(','),
      )
    }
  }
  return `${header}\n${lines.join('\n')}\n`
}
