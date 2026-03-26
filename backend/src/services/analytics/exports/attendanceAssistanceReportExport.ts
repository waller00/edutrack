import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'
import type { AttendanceStatus, AttendanceType, EventType, Role } from '@prisma/client'
import { prisma } from '../../../prisma.js'

type AttendanceDetailReportFilters = {
  from: string
  to: string
  userId?: string | undefined
  eventId?: string | undefined
  eventType?: EventType | undefined
  type?: AttendanceType | undefined
  status?: AttendanceStatus | undefined
  role?: Role | undefined
}

type AttendanceDetailReportRow = {
  // Tabla (requerida)
  fecha: string
  usuario: string
  rol: string
  eventoTurno: string
  estado: 'PRESENTE' | 'TARDE' | 'AUSENTE'
  horaEntrada: string
  horaSalida: string
  minTarde: number
  horasTrab: number
  licencia: 'SI' | 'NO'
  observaciones: string

  // Campos internos (ranking/métricas)
  userId: string
}

type TopUserAbsences = { userId: string; usuario: string; ausencias: number }
type TopUserPunctuality = { userId: string; usuario: string; puntualidadPct: number; presentes: number; tardes: number }
type TopAbsenceDays = { fecha: string; ausencias: number }

type AttendanceDetailReportMetrics = {
  totalRegistros: number
  pctPresente: number
  pctTarde: number
  pctAusente: number
  totalHorasTrab: number
  promMinTarde: number
  licenciasActivas: number
  topUsuariosAusencias: TopUserAbsences[]
  topUsuariosPuntualidad: TopUserPunctuality[]
  topDiasAusentismo: TopAbsenceDays[]
}

function ymdUtc(d: Date) {
  return d.toISOString().slice(0, 10)
}

function fmtTimeHM(d: Date | null) {
  return d ? d.toISOString().slice(11, 16) : ''
}

function clampNonNegativeMinutes(ms: number) {
  const mins = ms / (1000 * 60)
  return mins < 0 ? 0 : mins
}

function sanitizeSingleLine(v: unknown) {
  return String(v ?? '')
    .replace(/\r\n/g, ' ')
    .replace(/\n/g, ' ')
    .replace(/\r/g, ' ')
    .trim()
}

function truncateAscii(s: string, max: number) {
  const t = sanitizeSingleLine(s)
  if (t.length <= max) return t
  if (max <= 3) return t.slice(0, max)
  return `${t.slice(0, max - 3)}...`
}

function buildPlannedTimeFromTemplate(params: { date: Date; template: Date | null }) {
  if (!params.template) return null
  const dd = params.date
  const t = params.template
  return new Date(Date.UTC(dd.getUTCFullYear(), dd.getUTCMonth(), dd.getUTCDate(), t.getUTCHours(), t.getUTCMinutes(), 0, 0))
}

function minutesDiff(plannedStart: Date | null, actualIn: Date | null) {
  if (!plannedStart || !actualIn) return 0
  return clampNonNegativeMinutes(actualIn.getTime() - plannedStart.getTime())
}

function durationHours(actualIn: Date | null, actualOut: Date | null) {
  if (!actualIn || !actualOut) return 0
  const mins = clampNonNegativeMinutes(actualOut.getTime() - actualIn.getTime())
  return Number((mins / 60).toFixed(2))
}

function mapEstadoFromCheckInStatus(status: AttendanceStatus | null | undefined): AttendanceDetailReportRow['estado'] {
  if (!status) return 'AUSENTE'
  if (status === 'PRESENT') return 'PRESENTE'
  if (status === 'LATE') return 'TARDE'
  if (status === 'ABSENT_NOT_JUSTIFIED' || status === 'ABSENT_JUSTIFIED') return 'AUSENTE'
  // Para seguridad, si llega un estado inesperado lo tratamos como AUSENTE.
  return 'AUSENTE'
}

function computePercent(part: number, total: number) {
  if (total <= 0) return 0
  return Number(((part / total) * 100).toFixed(2))
}

function safeAvg(nums: number[]) {
  if (!nums.length) return 0
  const sum = nums.reduce((a, b) => a + b, 0)
  return Number((sum / nums.length).toFixed(2))
}

async function buildAttendanceDetailReport(params: { filters: AttendanceDetailReportFilters }) {
  const { from, to } = params.filters

  const fromDate = new Date(`${from}T00:00:00.000Z`)
  const toDate = new Date(`${to}T23:59:59.999Z`)

  const baseWhere: any = {
    date: {
      gte: fromDate,
      lte: toDate,
    },
  }

  if (params.filters.userId) baseWhere.userId = params.filters.userId
  if (params.filters.eventId) baseWhere.eventId = params.filters.eventId
  if (params.filters.eventType) {
    baseWhere.event = { type: params.filters.eventType }
    baseWhere.eventId = { not: null }
  }
  if (params.filters.role) baseWhere.user = { role: params.filters.role }

  // Selección “por filtros”: definimos qué instancias entran al reporte
  // usando tipo/estado a nivel de registro, y luego completamos las filas con
  // entrada+salida dentro de la instancia.
  const candidateWhere: any = { ...baseWhere }
  if (params.filters.type) candidateWhere.type = params.filters.type
  if (params.filters.status) candidateWhere.status = params.filters.status

  const candidateAttendances = await prisma.attendance.findMany({
    where: candidateWhere,
    select: { userId: true, eventId: true, date: true },
  })

  const candidateKeys = new Set<string>()
  for (const a of candidateAttendances) {
    const key = `${a.userId}_${a.eventId || 'null'}_${ymdUtc(a.date)}`
    candidateKeys.add(key)
  }

  if (candidateKeys.size === 0) {
    const metrics: AttendanceDetailReportMetrics = {
      totalRegistros: 0,
      pctPresente: 0,
      pctTarde: 0,
      pctAusente: 0,
      totalHorasTrab: 0,
      promMinTarde: 0,
      licenciasActivas: 0,
      topUsuariosAusencias: [],
      topUsuariosPuntualidad: [],
      topDiasAusentismo: [],
    }
    return { rows: [] as AttendanceDetailReportRow[], metrics }
  }

  const allAttendances = await prisma.attendance.findMany({
    where: baseWhere,
    include: {
      user: { select: { id: true, name: true, username: true, email: true, role: true, firstName: true, lastName: true } },
      event: { select: { id: true, title: true, type: true, startTime: true, endTime: true } },
    },
    orderBy: [{ date: 'desc' }, { time: 'desc' }],
  })

  type Group = {
    fechaDate: Date
    eventTitle: string
    eventType: EventType | null
    plannedStartTemplate: Date | null
    plannedEndTemplate: Date | null
    userId: string
    usuario: string
    rol: string
    checkIn: (typeof allAttendances)[number] | null
    checkOut: (typeof allAttendances)[number] | null
  }

  const keyOf = (a: (typeof allAttendances)[number]) => `${a.userId}_${a.eventId || 'null'}_${ymdUtc(a.date)}`
  const groups = new Map<string, Group>()

  for (const att of allAttendances) {
    const key = keyOf(att)
    if (!candidateKeys.has(key)) continue

    const displayName = att.user.name || att.user.username || `${att.user.firstName ?? ''} ${att.user.lastName ?? ''}`.trim() || 'Sin nombre'
    const grupo = (() => {
      const existing = groups.get(key)
      if (existing) return existing
      return {
        fechaDate: att.date,
        eventTitle: att.event?.title || '',
        eventType: att.event?.type || null,
        plannedStartTemplate: att.event?.startTime ?? null,
        plannedEndTemplate: att.event?.endTime ?? null,
        userId: att.userId,
        usuario: displayName,
        rol: String(att.user.role),
        checkIn: null,
        checkOut: null,
      }
    })()

    if (!groups.has(key)) groups.set(key, grupo)
    const g = groups.get(key)!

    if (att.type === 'CHECK_IN') {
      if (!g.checkIn || att.time < g.checkIn.time) g.checkIn = att
    } else {
      if (!g.checkOut || att.time > g.checkOut.time) g.checkOut = att
    }
  }

  const instanceKeys = Array.from(groups.keys())
  const userIds = Array.from(new Set(instanceKeys.map((k) => groups.get(k)!.userId)))

  const approvedLicenses = await prisma.medicalLeave.findMany({
    where: {
      userId: { in: userIds },
      status: 'ACTIVE' as any,
      startDate: { lte: toDate },
      endDate: { gte: fromDate },
    },
    select: { id: true, userId: true, startDate: true, endDate: true },
  })

  const licensesByUser = new Map<string, typeof approvedLicenses>()
  for (const l of approvedLicenses) {
    if (!licensesByUser.has(l.userId)) licensesByUser.set(l.userId, [])
    licensesByUser.get(l.userId)!.push(l)
  }

  const rows: AttendanceDetailReportRow[] = []
  for (const k of instanceKeys) {
    const g = groups.get(k)!
    const fecha = ymdUtc(g.fechaDate)

    const plannedStart = buildPlannedTimeFromTemplate({ date: g.fechaDate, template: g.plannedStartTemplate })
    const actualIn = g.checkIn?.time ?? null
    const actualOut = g.checkOut?.time ?? null

    const estado = mapEstadoFromCheckInStatus(g.checkIn?.status)
    const minTardeRaw = minutesDiff(plannedStart, actualIn)
    const minTarde = estado === 'TARDE' ? Number(minTardeRaw.toFixed(2)) : 0
    const horasTrab = estado === 'AUSENTE' ? 0 : durationHours(actualIn, actualOut)

    let licencia: AttendanceDetailReportRow['licencia'] = 'NO'
    if (estado === 'AUSENTE') {
      const uLic = licensesByUser.get(g.userId) || []
      for (const l of uLic) {
        const lStart = ymdUtc(l.startDate)
        const lEnd = ymdUtc(l.endDate)
        if (lStart <= fecha && fecha <= lEnd) {
          licencia = 'SI'
          break
        }
      }
    }

    const obsRaw = g.checkIn?.notes || g.checkOut?.notes || ''
    const observaciones = truncateAscii(obsRaw ? sanitizeSingleLine(obsRaw) : '', 60) || '-'

    const eventoTurno = truncateAscii(g.eventTitle || (g.eventType ? String(g.eventType) : ''), 30) || 'N/A'

    rows.push({
      fecha,
      usuario: truncateAscii(g.usuario, 22) || 'Sin nombre',
      rol: truncateAscii(g.rol, 12) || 'N/A',
      eventoTurno,
      estado,
      horaEntrada: estado === 'AUSENTE' ? '' : fmtTimeHM(actualIn),
      horaSalida: estado === 'AUSENTE' ? '' : fmtTimeHM(actualOut),
      minTarde,
      horasTrab,
      licencia,
      observaciones,
      userId: g.userId,
    })
  }

  // Orden requerido: Fecha DESC
  rows.sort((a, b) => b.fecha.localeCompare(a.fecha) || a.usuario.localeCompare(b.usuario))

  const totalRegistros = rows.length
  const countPresente = rows.filter((r) => r.estado === 'PRESENTE').length
  const countTarde = rows.filter((r) => r.estado === 'TARDE').length
  const countAusente = rows.filter((r) => r.estado === 'AUSENTE').length

  const totalHorasTrab = Number(rows.reduce((sum, r) => sum + (Number(r.horasTrab) || 0), 0).toFixed(2))
  const promMinTarde = safeAvg(rows.filter((r) => r.estado === 'TARDE').map((r) => Number(r.minTarde) || 0))

  const licenciasActivas = new Set(approvedLicenses.map((l) => l.id)).size

  const byUserAbs = new Map<string, TopUserAbsences>()
  const byUserPun = new Map<string, { usuario: string; presentes: number; tardes: number }>()
  for (const r of rows) {
    const absExisting = byUserAbs.get(r.userId)
    if (absExisting) {
      if (r.estado === 'AUSENTE') absExisting.ausencias++
    } else {
      byUserAbs.set(r.userId, { userId: r.userId, usuario: r.usuario, ausencias: r.estado === 'AUSENTE' ? 1 : 0 })
    }

    const pun = byUserPun.get(r.userId) || { usuario: r.usuario, presentes: 0, tardes: 0 }
    if (r.estado === 'PRESENTE') pun.presentes++
    if (r.estado === 'TARDE') pun.tardes++
    byUserPun.set(r.userId, pun)
  }

  const topUsuariosAusencias = Array.from(byUserAbs.values())
    .sort((a, b) => b.ausencias - a.ausencias || a.usuario.localeCompare(b.usuario))
    .slice(0, 3)

  const topUsuariosPuntualidad = Array.from(byUserPun.entries())
    .map(([userId, u]) => ({
      userId,
      usuario: u.usuario,
      puntualidadPct: computePercent(u.presentes, u.presentes + u.tardes),
      presentes: u.presentes,
      tardes: u.tardes,
    }))
    .sort((a, b) => b.puntualidadPct - a.puntualidadPct || b.presentes - a.presentes || a.usuario.localeCompare(b.usuario))
    .slice(0, 3)

  const byDay = new Map<string, number>()
  for (const r of rows) {
    if (r.estado !== 'AUSENTE') continue
    byDay.set(r.fecha, (byDay.get(r.fecha) || 0) + 1)
  }

  const topDiasAusentismo = Array.from(byDay.entries())
    .map(([fecha, ausencias]) => ({ fecha, ausencias }))
    .sort((a, b) => b.ausencias - a.ausencias || a.fecha.localeCompare(b.fecha))
    .slice(0, 3)

  const metrics: AttendanceDetailReportMetrics = {
    totalRegistros,
    pctPresente: computePercent(countPresente, totalRegistros),
    pctTarde: computePercent(countTarde, totalRegistros),
    pctAusente: computePercent(countAusente, totalRegistros),
    totalHorasTrab,
    promMinTarde,
    licenciasActivas,
    topUsuariosAusencias,
    topUsuariosPuntualidad,
    topDiasAusentismo,
  }

  return { rows, metrics }
}

function buildFilterLines(filters: AttendanceDetailReportFilters, rows: AttendanceDetailReportRow[]) {
  const lines: string[] = []
  lines.push(`Rango: ${filters.from} a ${filters.to}`)
  if (filters.role) lines.push(`Rol: ${filters.role}`)
  if (filters.userId) {
    const u = rows.find((r) => r.userId === filters.userId)
    lines.push(`Usuario: ${u?.usuario || filters.userId}`)
  }
  if (filters.eventId) lines.push(`Evento ID: ${filters.eventId}`)
  if (filters.eventType) lines.push(`Tipo evento: ${filters.eventType}`)
  if (filters.type) lines.push(`Tipo: ${filters.type}`)
  if (filters.status) lines.push(`Estado filtro: ${filters.status}`)
  return lines.map((l) => truncateAscii(l, 70))
}

function autoWidthColumns(sheet: ExcelJS.Worksheet, maxExtra = 2) {
  sheet.columns.forEach((col) => {
    const header = col.header ? String(col.header) : ''
    let maxLen = header.length
    const colNum = col.number
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const v = row.getCell(colNum).value
      if (v === null || v === undefined) return
      const s = typeof v === 'string' ? v : JSON.stringify(v)
      maxLen = Math.max(maxLen, s.length)
    })
    const target = Math.min(60, Math.max(8, Math.ceil((maxLen + maxExtra) * 1.05)))
    col.width = target
  })
}

function formatPct(n: number) {
  return `${Number(n.toFixed(2))}%`
}

export async function generateAttendanceAssistanceReportXlsxFromAttendances(params: { filters: AttendanceDetailReportFilters }) {
  const { rows, metrics } = await buildAttendanceDetailReport({ filters: params.filters })

  const workbook = new ExcelJS.Workbook()

  // HOJA: Resumen
  const summary = workbook.addWorksheet('Resumen')
  summary.getRow(1).height = 20

  summary.addRow(['EduTrack'])
  summary.addRow(['Reporte', 'Asistencia (BI)'])
  summary.addRow(['Periodo', `${params.filters.from} a ${params.filters.to}`])

  const filterLines = buildFilterLines(params.filters, rows)
  summary.addRow(['Filtros', ''])
  for (const fl of filterLines) summary.addRow([fl, ''])

  summary.addRow([])
  summary.addRow(['Métricas', ''])
  summary.addRow(['Total de registros', String(metrics.totalRegistros)])
  summary.addRow(['% Presente', formatPct(metrics.pctPresente)])
  summary.addRow(['% Tarde', formatPct(metrics.pctTarde)])
  summary.addRow(['% Ausente', formatPct(metrics.pctAusente)])
  summary.addRow(['Total horas trabajadas', String(metrics.totalHorasTrab)])
  summary.addRow(['Prom. llegada tarde (min)', String(metrics.promMinTarde)])
  summary.addRow(['Licencias activas', String(metrics.licenciasActivas)])

  summary.getRow(1).font = { bold: true, size: 14 }
  // (No usamos índices fijos aquí; al final aplicamos auto-width y estilos a las secciones agregadas)

  // HOJA: Detalle
  const detail = workbook.addWorksheet('Detalle')
  detail.columns = [
    { header: 'Fecha', key: 'fecha', width: 12 },
    { header: 'Usuario', key: 'usuario', width: 22 },
    { header: 'Rol', key: 'rol', width: 14 },
    { header: 'Evento/Turno', key: 'eventoTurno', width: 18 },
    { header: 'Estado', key: 'estado', width: 12 },
    { header: 'HoraEntrada', key: 'horaEntrada', width: 14 },
    { header: 'HoraSalida', key: 'horaSalida', width: 14 },
    { header: 'MinTarde', key: 'minTarde', width: 12 },
    { header: 'HorasTrab', key: 'horasTrab', width: 12 },
    { header: 'Licencia', key: 'licencia', width: 10 },
    { header: 'Observaciones', key: 'observaciones', width: 22 },
  ]

  const detailHeaderRow = detail.addRow(detail.columns.map((c) => c.header))
  detailHeaderRow.eachCell((cell) => {
    cell.font = { bold: true }
    cell.alignment = { vertical: 'middle', wrapText: false }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } }
  })

  for (const r of rows) {
    detail.addRow([
      r.fecha,
      r.usuario,
      r.rol,
      r.eventoTurno,
      r.estado,
      r.horaEntrada,
      r.horaSalida,
      r.minTarde,
      r.horasTrab,
      r.licencia,
      r.observaciones,
    ])
  }

  if (rows.length === 0) {
    detail.addRow(['No hay datos para los filtros seleccionados', '', '', '', '', '', '', '', '', '', ''])
  }

  detail.views = [{ state: 'frozen', ySplit: 1 }]
  detail.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: detail.columns.length } }

  // Sanitizar: evitar saltos de línea en celdas
  detail.eachRow((row) => {
    if (row.number >= 2) row.height = row.height || 18
    row.eachCell((cell) => {
      if (typeof cell.value === 'string') cell.value = sanitizeSingleLine(cell.value)
    })
  })

  autoWidthColumns(detail)

  // HOJA: tabla en "Resumen" (debajo de métricas), desde fila 17
  // Nota: no permitimos saltos de línea en celdas; los valores ya vienen truncados/limpios.
  const desiredStartRow = 17
  if (summary.lastRow.number < desiredStartRow - 1) {
    while (summary.lastRow.number < desiredStartRow - 1) summary.addRow(new Array(11).fill(''))
  }

  const summaryTableHeaders = [
    'Fecha',
    'Usuario',
    'Rol',
    'Evento/Turno',
    'Estado',
    'Hora entrada',
    'Hora salida',
    'Min tard (min)',
    'Horas trab',
    'Lic (SI/NO)',
    'Observaciones',
  ]

  const headerRow = summary.addRow(summaryTableHeaders)
  headerRow.font = { bold: true }
  headerRow.height = 20
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } }
    cell.alignment = { vertical: 'middle', wrapText: false }
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
    }
  })

  for (const r of rows) {
    const row = summary.addRow([
      r.fecha,
      r.usuario,
      r.rol,
      r.eventoTurno,
      r.estado,
      r.horaEntrada,
      r.horaSalida,
      r.minTarde,
      r.horasTrab,
      r.licencia,
      r.observaciones,
    ])
    // Estabilidad visual: altura suficiente para que no se vea "corto".
    row.height = 18
    row.eachCell((cell) => {
      if (typeof cell.value === 'string') cell.value = sanitizeSingleLine(cell.value)
      cell.alignment = { vertical: 'middle', wrapText: false }
      // Bordes finos para mantener claridad del layout.
      cell.border = {
        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      }
    })
  }

  if (rows.length === 0) {
    const msgRow = summary.addRow(['No hay datos para los filtros seleccionados', '', '', '', '', '', '', '', '', '', ''])
    msgRow.height = 18
    msgRow.eachCell((cell) => (cell.alignment = { vertical: 'middle', wrapText: false }))
  }

  // auto width al final para que considere también la tabla insertada
  autoWidthColumns(summary)

  // HOJA: Ranking (opcional, pero lo incluimos para cumplir top lists)
  const ranking = workbook.addWorksheet('Ranking')
  const titleAus = ranking.addRow(['Top usuarios - más ausencias'])
  titleAus.font = { bold: true }
  const hdrAus = ranking.addRow(['Usuario', 'Ausencias'])
  hdrAus.font = { bold: true }
  for (const t of metrics.topUsuariosAusencias) ranking.addRow([t.usuario, t.ausencias])

  ranking.addRow([])

  const titlePun = ranking.addRow(['Top usuarios - más puntualidad'])
  titlePun.font = { bold: true }
  const hdrPun = ranking.addRow(['Usuario', 'PuntualidadPct', 'Presentes', 'Tardes'])
  hdrPun.font = { bold: true }
  for (const t of metrics.topUsuariosPuntualidad) ranking.addRow([t.usuario, formatPct(t.puntualidadPct), t.presentes, t.tardes])

  ranking.addRow([])

  const titleDays = ranking.addRow(['Top días - mayor ausentismo'])
  titleDays.font = { bold: true }
  const hdrDays = ranking.addRow(['Fecha', 'Ausencias'])
  hdrDays.font = { bold: true }
  for (const d of metrics.topDiasAusentismo) ranking.addRow([d.fecha, d.ausencias])

  autoWidthColumns(ranking)

  return workbook.xlsx.writeBuffer()
}

function pdfTruncateForWidth(text: string, colWidth: number, fontSize: number, padding = 2) {
  const maxChars = Math.max(1, Math.floor((colWidth - padding * 2) / (fontSize * 0.55)))
  return truncateAscii(text, maxChars)
}

export async function generateAttendanceAssistanceReportPdfFromAttendances(params: { filters: AttendanceDetailReportFilters }) {
  const { rows, metrics } = await buildAttendanceDetailReport({ filters: params.filters })

  const doc = new PDFDocument({ size: 'A4', margin: 40 })
  const chunks: Buffer[] = []
  doc.on('data', (c) => chunks.push(c as Buffer))

  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right
  const marginLeft = doc.page.margins.left
  const bottomY = doc.page.height - doc.page.margins.bottom

  const headerLines = buildFilterLines(params.filters, rows)

  // HEADER
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#1F4E79').text('EduTrack', { width: usableWidth })
  doc.moveDown(0.2)
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#111827').text('Reporte: Asistencia (BI)', { width: usableWidth })
  doc.moveDown(0.1)
  doc.font('Helvetica').fontSize(10).fillColor('#374151').text(`Periodo: ${params.filters.from} a ${params.filters.to}`, { width: usableWidth })
  doc.moveDown(0.4)

  doc.fontSize(10).font('Helvetica-Bold').fillColor('#111827').text('Filtros aplicados', { width: usableWidth })
  doc.moveDown(0.1)
  doc.font('Helvetica').fontSize(9).fillColor('#374151')
  for (const l of headerLines.filter((x) => x.startsWith('Rol:') || x.startsWith('Usuario:') || x.startsWith('Evento') || x.startsWith('Tipo') || x.startsWith('Estado'))) {
    // Cada línea se dibuja por separado para evitar saltos de línea.
    doc.text(l, { width: usableWidth })
  }
  doc.moveDown(0.6)

  // SECCIÓN: MÉTRICAS (cards)
  doc.moveDown(0.1)
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#111827').text('Métricas', { width: usableWidth })
  doc.moveDown(0.2)

  const cardGap = 10
  const cardW = (usableWidth - cardGap) / 2
  const cardH = 46
  const cardFontLabel = 9
  const cardFontValue = 13
  const cardX1 = marginLeft
  const cardX2 = marginLeft + cardW + cardGap
  const cardsStartY = doc.y

  const cards: Array<{ label: string; value: string }> = [
    { label: 'Total registros', value: String(metrics.totalRegistros) },
    { label: '% Presente', value: formatPct(metrics.pctPresente) },
    { label: '% Tarde', value: formatPct(metrics.pctTarde) },
    { label: '% Ausente', value: formatPct(metrics.pctAusente) },
    { label: 'Horas trabajadas', value: String(metrics.totalHorasTrab) },
    { label: 'Prom. min tarde', value: String(metrics.promMinTarde) },
  ]

  // 2 filas x 3 tarjetas
  for (let i = 0; i < cards.length; i++) {
    const row = Math.floor(i / 2)
    const col = i % 2
    const x = col === 0 ? cardX1 : cardX2
    const cy = cardsStartY + row * (cardH + 8)

    // Dibujo de tarjeta: borde + contenido
    doc.rect(x, cy, cardW, cardH).stroke('#D1D5DB')
    doc.font('Helvetica-Bold').fontSize(cardFontLabel).fillColor('#374151').text(truncateAscii(cards[i].label, 22), x + 8, cy + 8, { width: cardW - 16 })
    doc.font('Helvetica-Bold').fontSize(cardFontValue).fillColor('#111827').text(truncateAscii(cards[i].value, 18), x + 8, cy + 24, { width: cardW - 16 })
  }

  // Avanzar el cursor vertical (doc.y) después de las tarjetas para evitar superposición
  const cardRows = Math.ceil(cards.length / 2)
  doc.y = cardsStartY + cardRows * (cardH + 8) + 10

  doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text('Licencias y ausentismo', { width: usableWidth })
  doc.moveDown(0.15)
  doc.font('Helvetica').fontSize(9).fillColor('#374151')
  doc.text(`Licencias activas: ${metrics.licenciasActivas}`, { width: usableWidth })
  if (metrics.topDiasAusentismo.length) {
    doc.text('Días con mayor ausentismo:', { width: usableWidth })
    for (const d of metrics.topDiasAusentismo) {
      doc.text(`- ${d.fecha}: ${d.ausencias} aus.`, { width: usableWidth })
    }
  } else {
    doc.text('Días con mayor ausentismo: -', { width: usableWidth })
  }

  doc.moveDown(0.3)

  // SECCIÓN: RANKING
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text('Ranking', { width: usableWidth })
  doc.moveDown(0.15)
  doc.font('Helvetica').fontSize(9).fillColor('#374151')

  if (metrics.topUsuariosPuntualidad.length) {
    doc.text('Top puntualidad:', { width: usableWidth })
    for (const t of metrics.topUsuariosPuntualidad) {
      doc.text(`- ${t.usuario}: ${formatPct(t.puntualidadPct)} (${t.presentes} pres., ${t.tardes} tard.)`, { width: usableWidth })
    }
  } else {
    doc.text('Top puntualidad: -', { width: usableWidth })
  }

  doc.moveDown(0.2)
  if (metrics.topUsuariosAusencias.length) {
    doc.text('Top ausencias:', { width: usableWidth })
    for (const t of metrics.topUsuariosAusencias) {
      doc.text(`- ${t.usuario}: ${t.ausencias} aus.`, { width: usableWidth })
    }
  } else {
    doc.text('Top ausencias: -', { width: usableWidth })
  }

  doc.moveDown(0.4)

  // TABLA: Detalle (con paginación)
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text('Detalle', { width: usableWidth })
  doc.moveDown(0.15)

  const tableFont = 7.5
  const rowH = 14
  const pad = 2
  const colDefs = [
    { key: 'fecha', header: 'Fecha', w: 32, getter: (r: AttendanceDetailReportRow) => r.fecha },
    { key: 'usuario', header: 'Usuario', w: 60, getter: (r: AttendanceDetailReportRow) => r.usuario },
    { key: 'rol', header: 'Rol', w: 24, getter: (r: AttendanceDetailReportRow) => r.rol },
    { key: 'eventoTurno', header: 'Evento/Turno', w: 46, getter: (r: AttendanceDetailReportRow) => r.eventoTurno },
    { key: 'estado', header: 'Estado', w: 34, getter: (r: AttendanceDetailReportRow) => r.estado },
    { key: 'horaEntrada', header: 'Ent', w: 34, getter: (r: AttendanceDetailReportRow) => r.horaEntrada },
    { key: 'horaSalida', header: 'Sal', w: 34, getter: (r: AttendanceDetailReportRow) => r.horaSalida },
    { key: 'minTarde', header: 'Min', w: 34, getter: (r: AttendanceDetailReportRow) => (r.minTarde ? String(r.minTarde) : '') },
    { key: 'horasTrab', header: 'Horas', w: 42, getter: (r: AttendanceDetailReportRow) => (r.horasTrab ? String(r.horasTrab) : '') },
    { key: 'licencia', header: 'Lic', w: 28, getter: (r: AttendanceDetailReportRow) => r.licencia },
    { key: 'observaciones', header: 'Obs', w: 55, getter: (r: AttendanceDetailReportRow) => r.observaciones },
  ]

  const totalTableW = colDefs.reduce((s, c) => s + c.w, 0)
  const scale = usableWidth / totalTableW
  const scaledCols = colDefs.map((c) => ({ ...c, w: c.w * scale }))

  function colX(i: number) {
    return marginLeft + scaledCols.slice(0, i).reduce((s, c) => s + c.w, 0)
  }

  function ensureSpace(yPos: number) {
    return yPos + rowH <= bottomY
  }

  function drawHeaderRow(tableY: number) {
    doc.font('Helvetica-Bold').fontSize(tableFont)
    for (let i = 0; i < scaledCols.length; i++) {
      const x = colX(i)
      const w = scaledCols[i].w
      doc.rect(x, tableY, w, rowH).fillAndStroke('#2F5597', '#2F5597')
      const label = truncateAscii(scaledCols[i].header, Math.floor(w / (tableFont * 0.55)))
      doc.fillColor('#FFFFFF').text(label, x + pad, tableY + 4, { width: w - pad * 2, height: rowH, align: 'left' })
      doc.fillColor('#000000')
    }
  }

  function drawDataRow(tableY: number, r: AttendanceDetailReportRow, index: number) {
    // Color alternado para legibilidad
    const bg = index % 2 === 0 ? '#F9FAFB' : '#FFFFFF'
    doc.font('Helvetica').fontSize(tableFont).fillColor('#111827')
    for (let i = 0; i < scaledCols.length; i++) {
      const x = colX(i)
      const w = scaledCols[i].w
      doc.rect(x, tableY, w, rowH).fillAndStroke(bg, '#E5E7EB')
      // `fillAndStroke` puede dejar alterado el fillColor interno de pdfkit;
      // forzamos el color de texto en cada celda para que sea visible.
      doc.fillColor('#111827')

      const raw = sanitizeSingleLine(scaledCols[i].getter(r))
      const maxChars = Math.max(1, Math.floor((w - pad * 2) / (tableFont * 0.55)))
      const text = truncateAscii(raw, maxChars)

      doc.text(text, x + pad, tableY + 3, { width: w - pad * 2, height: rowH, align: 'left' })
    }
  }

  if (rows.length === 0) {
    doc.font('Helvetica').fontSize(10).fillColor('#374151').text('No hay datos para los filtros seleccionados.', { width: usableWidth })
    doc.end()
    return Buffer.concat(chunks)
  }

  let tableY = doc.y
  // Evitar una página con solo el header: si no entra al menos la primera fila,
  // movemos el bloque completo a una nueva página antes de dibujar el header.
  if (!ensureSpace(tableY + rowH)) {
    doc.addPage()
    tableY = doc.page.margins.top
  }
  drawHeaderRow(tableY)
  tableY += rowH

  for (let i = 0; i < rows.length; i++) {
    if (!ensureSpace(tableY)) {
      doc.addPage()
      tableY = doc.page.margins.top
      drawHeaderRow(tableY)
      tableY += rowH
    }
    drawDataRow(tableY, rows[i], i)
    tableY += rowH
  }

  doc.end()

  await new Promise<void>((resolve, reject) => {
    doc.on('end', () => resolve())
    doc.on('error', (e) => reject(e))
  })

  return Buffer.concat(chunks)
}
