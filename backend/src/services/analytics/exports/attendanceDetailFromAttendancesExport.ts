import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'
import type { AttendanceStatus, AttendanceType, EventType } from '@prisma/client'
import { prisma } from '../../../db/prisma.js'
import { mergeSchoolYearIntoAttendanceEventWhere } from '../../../attendance/attendance-school-year.js'
import { selectOrgRoleCode } from '../../../identity/user-role-prisma.js'
import type { ResolvedAttendanceByInstance } from '../models.js'

const COLUMNS = [
  'Fecha',
  'Tipo',
  'Estado',
  'Hora Registro',
  'Usuario ID',
  'Usuario',
  'Rol',
  'Evento ID',
  'Evento',
  'Turno/Tipo Evento',
  'Instancia Planificada ID',
  'Hora Planificada Inicio',
  'Hora Real Entrada',
  'Hora Real Salida',
  'Duración Real (min)',
  'Brecha (min)',
  'Horas (min) Incompletas',
  'Notas',
  'Licencia Asociada ID',
  'Licencia Asociada Estado',
] as const

type AttendanceRowSource = {
  attendanceId: string
  userId: string
  userDisplayName: string
  userRole: string
  userEmail: string
  type: AttendanceType
  status: AttendanceStatus
  date: Date
  time: Date
  notes: string | null
  eventId: string | null
  eventTitle: string | null
  eventType: EventType | null
  plannedStartTimeTemplate: Date | null
  plannedEndTimeTemplate: Date | null
}

type PlannedTimes = {
  plannedStartTime: Date | null
  plannedEndTime: Date | null
}

function ymdUtc(d: Date) {
  return d.toISOString().slice(0, 10)
}

function buildPlannedTimeFromTemplate(params: { date: Date; template: Date | null }) {
  if (!params.template) return null
  const dd = params.date
  const t = params.template
  return new Date(
    Date.UTC(
      dd.getUTCFullYear(),
      dd.getUTCMonth(),
      dd.getUTCDate(),
      t.getUTCHours(),
      t.getUTCMinutes(),
      0,
      0,
    ),
  )
}

function fmtIso(d: Date | null) {
  return d ? d.toISOString() : ''
}

function clampNonNegativeMinutes(ms: number) {
  const mins = ms / (1000 * 60)
  return mins < 0 ? 0 : mins
}

function csvEscape(v: unknown) {
  const s = String(v ?? '')
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function toLicenseEstado(isJustified: boolean) {
  return isJustified ? 'ACTIVE' : ''
}

function isAbsenceStatus(status: AttendanceStatus) {
  const value = String(status)
  return value === 'ABSENT_NOT_JUSTIFIED' || value === 'ABSENT_JUSTIFIED' || value === 'SUBSTITUTED'
}

export async function buildAttendanceDetailRowsFromAttendances(params: {
  filters: {
    from: string
    to: string
    userId?: string
    eventId?: string
    eventType?: EventType
    type?: AttendanceType
    status?: AttendanceStatus
    role?: string
    schoolYearId?: string
  }
}) {
  const { from, to } = params.filters

  const where: any = {
    date: {
      gte: new Date(`${from}T00:00:00.000Z`),
      lte: new Date(`${to}T23:59:59.999Z`),
    },
  }
  if (params.filters.userId) where.userId = params.filters.userId
  if (params.filters.eventId) where.eventId = params.filters.eventId
  if (params.filters.eventType) {
    where.event = { type: params.filters.eventType }
    where.eventId = { not: null }
  }
  if (params.filters.type) where.type = params.filters.type
  if (params.filters.status) where.status = params.filters.status
  if (params.filters.role) where.user = { orgRole: { code: params.filters.role } }
  if (params.filters.schoolYearId) {
    mergeSchoolYearIntoAttendanceEventWhere(where, params.filters.schoolYearId)
  }

  const attendances = await prisma.attendance.findMany({
    where,
    include: {
      user: { select: { id: true, name: true, email: true, username: true, firstName: true, lastName: true, ...selectOrgRoleCode } },
      event: { select: { id: true, title: true, type: true, startTime: true, endTime: true } },
    },
    orderBy: [{ date: 'desc' }],
  })

  const allUserIds = Array.from(new Set(attendances.map((a) => a.userId)))
  const minDate = attendances.length ? attendances.reduce((m, a) => (a.date < m ? a.date : m), attendances[0].date) : new Date(`${from}T00:00:00.000Z`)
  const maxDate = attendances.length ? attendances.reduce((m, a) => (a.date > m ? a.date : m), attendances[0].date) : new Date(`${to}T23:59:59.999Z`)

  const approvedLicenses = await prisma.medicalLeave.findMany({
    where: {
      userId: { in: allUserIds },
      status: 'ACTIVE' as any,
      startDate: { lte: maxDate },
      endDate: { gte: minDate },
    },
    select: { id: true, userId: true, startDate: true, endDate: true, reason: true },
  })

  const licensesByUser = new Map<string, typeof approvedLicenses>()
  for (const l of approvedLicenses) {
    if (!licensesByUser.has(l.userId)) licensesByUser.set(l.userId, [])
    licensesByUser.get(l.userId)!.push(l)
  }

  // Construimos pares in/out por (userId,eventId,dateYmd)
  const keyOf = (a: typeof attendances[number]) => `${a.userId}_${a.eventId || 'null'}_${ymdUtc(a.date)}`
  const groups = new Map<string, { checkIn: typeof attendances[number] | null; checkOut: typeof attendances[number] | null }>()
  for (const a of attendances) {
    const k = keyOf(a)
    if (!groups.has(k)) groups.set(k, { checkIn: null, checkOut: null })
    const g = groups.get(k)!
    if (a.type === 'CHECK_IN') {
      if (!g.checkIn || a.time < g.checkIn.time) g.checkIn = a
    } else {
      if (!g.checkOut || a.time > g.checkOut.time) g.checkOut = a
    }
  }

  const rows: Record<string, unknown>[] = []
  for (const a of attendances) {
    const plannedStartTime = buildPlannedTimeFromTemplate({ date: a.date, template: a.event?.startTime ?? null })
    const plannedEndTime = buildPlannedTimeFromTemplate({ date: a.date, template: a.event?.endTime ?? null })

    const g = groups.get(keyOf(a))!
    const actualIn = g.checkIn ? g.checkIn.time : null
    const actualOut = g.checkOut ? g.checkOut.time : null
    const durationMinutes = actualIn && actualOut ? clampNonNegativeMinutes(actualOut.getTime() - actualIn.getTime()) : 0
    const breachMinutes = plannedStartTime && actualIn ? (actualIn.getTime() - plannedStartTime.getTime()) / (1000 * 60) : 0

    let licenseId = ''
    let licenseStatus = ''
    if (isAbsenceStatus(a.status)) {
      const uLic = licensesByUser.get(a.userId) || []
      const aYmd = ymdUtc(a.date)
      for (const l of uLic) {
        const lStart = ymdUtc(l.startDate)
        const lEnd = ymdUtc(l.endDate)
        if (lStart <= aYmd && aYmd <= lEnd) {
          licenseId = l.id
          licenseStatus = toLicenseEstado(true)
          break
        }
      }
    }

    const fecha = ymdUtc(a.date)
    const plannedStartIso = fmtIso(plannedStartTime)
    const plannedEndIso = fmtIso(plannedEndTime)

    rows.push({
      Fecha: fecha,
      Tipo: a.type,
      Estado: a.status,
      'Hora Registro': fmtIso(a.time),
      'Usuario ID': a.userId,
      Usuario: a.user.name || a.user.username || `${a.user.firstName ?? ''} ${a.user.lastName ?? ''}`.trim() || 'Sin nombre',
      Rol: a.user.orgRole?.code ?? '',
      'Evento ID': a.eventId || '',
      Evento: a.event?.title || '',
      'Turno/Tipo Evento': a.event?.type || '',
      'Instancia Planificada ID': '',
      'Hora Planificada Inicio': plannedStartIso,
      'Hora Real Entrada': actualIn ? fmtIso(actualIn) : '',
      'Hora Real Salida': actualOut ? fmtIso(actualOut) : plannedEndIso,
      'Duración Real (min)': Number(durationMinutes.toFixed(2)),
      'Brecha (min)': Number(breachMinutes.toFixed(2)),
      'Horas (min) Incompletas': actualIn && !actualOut ? Number(durationMinutes.toFixed(2)) : 0,
      Notas: a.notes || '',
      'Licencia Asociada ID': licenseId,
      'Licencia Asociada Estado': licenseStatus,
    })
  }

  // Orden: Fecha asc, Tipo, Usuario ID, Hora Registro
  rows.sort((x, y) => {
    const fx = String(x['Fecha'])
    const fy = String(y['Fecha'])
    if (fx !== fy) return fx.localeCompare(fy)
    const tx = String(x['Tipo'])
    const ty = String(y['Tipo'])
    if (tx !== ty) return tx.localeCompare(ty)
    const ux = String(x['Usuario ID'])
    const uy = String(y['Usuario ID'])
    if (ux !== uy) return ux.localeCompare(uy)
    return String(x['Hora Registro']).localeCompare(String(y['Hora Registro']))
  })

  return rows
}

export async function generateAttendanceDetailXlsxFromAttendances(params: {
  filters: {
    from: string
    to: string
    userId?: string
    eventId?: string
    eventType?: EventType
    type?: AttendanceType
    status?: AttendanceStatus
    role?: string
    schoolYearId?: string
  }
}) {
  const rows = await buildAttendanceDetailRowsFromAttendances({ filters: params.filters })
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Asistencia_Detallada')

  sheet.addRow([...COLUMNS])
  for (const r of rows) {
    sheet.addRow(COLUMNS.map((c) => (r as any)[c]))
  }
  sheet.getRow(1).font = { bold: true }
  return workbook.xlsx.writeBuffer()
}

export async function generateAttendanceDetailCsvFromAttendances(params: {
  filters: {
    from: string
    to: string
    userId?: string
    eventId?: string
    eventType?: EventType
    type?: AttendanceType
    status?: AttendanceStatus
    role?: string
    schoolYearId?: string
  }
}) {
  const rows = await buildAttendanceDetailRowsFromAttendances({ filters: params.filters })
  const header = COLUMNS.map((c) => c).join(',')
  const lines = rows.map((r) => COLUMNS.map((c) => csvEscape((r as any)[c])).join(','))
  return `${header}\n${lines.join('\n')}\n`
}

export async function generateAttendanceDetailPdfFromAttendances(params: {
  filters: {
    from: string
    to: string
    userId?: string
    eventId?: string
    eventType?: EventType
    type?: AttendanceType
    status?: AttendanceStatus
    role?: string
    schoolYearId?: string
  }
}) {
  const rows = await buildAttendanceDetailRowsFromAttendances({ filters: params.filters })
  const doc = new PDFDocument({ size: 'A4', margin: 40 })
  const chunks: Buffer[] = []
  doc.on('data', (c) => chunks.push(c as Buffer))

  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right

  let userNameForFilter: string | null = null
  if (params.filters.userId) {
    const row = rows.find((x) => String((x as any)['Usuario ID']) === params.filters.userId)
    userNameForFilter = row ? String((row as any)['Usuario'] || '') : null

    if (!userNameForFilter) {
      const u = await prisma.user.findUnique({
        where: { id: params.filters.userId },
        select: { id: true, name: true, username: true, email: true, firstName: true, lastName: true },
      })
      userNameForFilter =
        u?.name ||
        u?.username ||
        u?.email ||
        `${u?.firstName ?? ''} ${u?.lastName ?? ''}`.trim() ||
        null
    }
  }

  doc.fontSize(16).font('Helvetica-Bold').text('EduTrack - Asistencia Detallada', { width: usableWidth })
  doc.moveDown(0.2)
  doc.fontSize(10).font('Helvetica').text(`Periodo: ${params.filters.from} a ${params.filters.to}`, { width: usableWidth })

  const filterParts: string[] = []
  if (params.filters.role) filterParts.push(`Rol=${params.filters.role}`)
  if (params.filters.userId) filterParts.push(`Usuario=${userNameForFilter || params.filters.userId}`)
  if (params.filters.eventType) filterParts.push(`TipoEvento=${params.filters.eventType}`)
  if (params.filters.eventId) filterParts.push(`Evento=${params.filters.eventId}`)
  if (params.filters.type) filterParts.push(`Tipo=${params.filters.type}`)
  if (params.filters.status) filterParts.push(`Estado=${params.filters.status}`)
  if (filterParts.length) doc.fontSize(9).font('Helvetica').text(`Filtros: ${filterParts.join(' | ')}`, { width: usableWidth })

  doc.moveDown(0.4)

  const get = (r: Record<string, any>, k: (typeof COLUMNS)[number]) => r[k] ?? ''
  const collapseWhitespace = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim()
  const cut = (s: unknown, max = 80) => {
    const t = collapseWhitespace(s)
    if (!t) return ''
    return t.length > max ? `${t.slice(0, max)}...` : t
  }

  // Resumen + mini gráfico (para que el PDF no sea solo “texto por registro”)
  const estadoCounts: Record<string, number> = {}
  for (const r of rows) {
    const st = String((r as any)['Estado'] ?? '')
    estadoCounts[st] = (estadoCounts[st] ?? 0) + 1
  }

  const present: number = estadoCounts['PRESENT'] ?? 0
  const late: number = estadoCounts['LATE'] ?? 0
  const absentNotJustified: number = estadoCounts['ABSENT_NOT_JUSTIFIED'] ?? 0
  const absentJustified: number = estadoCounts['ABSENT_JUSTIFIED'] ?? 0
  const exit: number = estadoCounts['EXIT'] ?? 0
  const earlyExit: number = estadoCounts['EARLY_EXIT'] ?? 0

  const isCheckIn = !params.filters.type || params.filters.type === 'CHECK_IN'
  const summaryTotal = isCheckIn ? present + late + absentNotJustified + absentJustified : exit + earlyExit
  const presenceRate = isCheckIn && summaryTotal > 0 ? (present / summaryTotal) * 100 : 0
  const lateRate = isCheckIn && summaryTotal > 0 ? (late / summaryTotal) * 100 : 0
  const absenceRate = isCheckIn && summaryTotal > 0 ? ((absentNotJustified + absentJustified) / summaryTotal) * 100 : 0

  doc.font('Helvetica-Bold').fontSize(10).text('Resumen (filtro actual)', { width: usableWidth })
  doc.font('Helvetica').fontSize(9)
  doc.text(
    isCheckIn
      ? `Total: ${summaryTotal} | Presencia: ${Number(presenceRate.toFixed(2))}% | Tarde: ${Number(lateRate.toFixed(2))}% | Ausencias: ${Number(absenceRate.toFixed(2))}%`
      : `Total: ${summaryTotal} | Salida: ${exit} | Salida Anticipada: ${earlyExit}`,
    { width: usableWidth },
  )

  if (isCheckIn) {
    // Gráfico de barras simple (PRESENT / LATE / ABSENT)
    const max = Math.max(1, present, late, absentNotJustified + absentJustified)
    const baseX = doc.page.margins.left
    const baseY = doc.y + 6
    const chartHeight = 70
    const barW = 110
    const gap = 12
    const bar1H = (present / max) * chartHeight
    const bar2H = (late / max) * chartHeight
    const bar3H = ((absentNotJustified + absentJustified) / max) * chartHeight

    doc.fontSize(8)
    // Etiquetas arriba
    const drawBar = (x: number, label: string, value: number, h: number) => {
      const y = baseY + (chartHeight - h)
      doc.rect(x, y, barW, h).fill('#16a34a') // green
      doc.fillColor('black')
      doc.text(label, x, baseY + chartHeight + 2, { width: barW, align: 'center' })
      doc.text(String(value), x, y - 10, { width: barW, align: 'center' })
      doc.fillColor('black')
    }

    // PRESENT
    doc.fillColor('#16a34a')
    drawBar(baseX, 'Presente', present, bar1H)
    // LATE
    doc.fillColor('#f59e0b')
    drawBar(baseX + barW + gap, 'Tarde', late, bar2H)
    // ABSENT
    doc.fillColor('#dc2626')
    drawBar(baseX + (barW + gap) * 2, 'Ausente', absentNotJustified + absentJustified, bar3H)

    doc.moveDown(1.1)
  } else {
    const max = Math.max(1, exit, earlyExit)
    const baseX = doc.page.margins.left
    const baseY = doc.y + 6
    const chartHeight = 70
    const barW = 200
    const gap = 10
    const bar1H = (exit / max) * chartHeight
    const bar2H = (earlyExit / max) * chartHeight

    doc.fontSize(8)
    const drawBar2 = (x: number, label: string, value: number, h: number, color: string) => {
      const y = baseY + (chartHeight - h)
      doc.rect(x, y, barW, h).fill(color)
      doc.fillColor('black')
      doc.text(label, x, baseY + chartHeight + 2, { width: barW, align: 'center' })
      doc.text(String(value), x, y - 10, { width: barW, align: 'center' })
      doc.fillColor('black')
    }

    doc.fillColor('#2563eb') // blue
    drawBar2(baseX, 'Salida', exit, bar1H, '#2563eb')
    doc.fillColor('#f97316') // orange
    drawBar2(baseX + barW + gap, 'Anticipada', earlyExit, bar2H, '#f97316')

    doc.moveDown(1.1)
  }

  // Cabecera “tabla”
  doc.font('Helvetica-Bold').fontSize(9)
  doc.text('Fecha | Usuario | Estado | Hora | Duración(min) | Brecha(min) | Notas', { width: usableWidth })
  doc.moveDown(0.1)
  doc.font('Helvetica').fontSize(8.5)

  for (const r of rows) {
    // Una “fila” compacta con 1-2 líneas máximo para que no sea un monstruo ilegible
    const fecha = get(r as any, 'Fecha')
    const usuario = cut(get(r as any, 'Usuario'), 24)
    const estado = get(r as any, 'Estado')
    const hora = cut(get(r as any, 'Hora Registro'), 22)
    const dur = get(r as any, 'Duración Real (min)')
    const brecha = get(r as any, 'Brecha (min)')
    const notas = cut(get(r as any, 'Notas'), 60) || '—'

    doc.text(`${fecha} | ${usuario} | ${estado} | ${hora} | ${dur} | ${brecha} | ${notas}`, { width: usableWidth })

    const evento = cut(get(r as any, 'Evento'), 28)
    const turno = cut(get(r as any, 'Turno/Tipo Evento'), 18)
    const licenciaEstado = get(r as any, 'Licencia Asociada Estado')
    const licenciaId = get(r as any, 'Licencia Asociada ID')
    const licencia = licenciaEstado ? `${licenciaEstado}${licenciaId ? ` (ID:${licenciaId})` : ''}` : ''

    const line2Parts = [
      evento ? `Evento: ${evento}` : '',
      turno ? `Turno: ${turno}` : '',
      licencia ? `Licencia: ${licencia}` : '',
    ].filter(Boolean)
    if (line2Parts.length) doc.text(line2Parts.join(' | '), { width: usableWidth })
  }

  doc.end()

  await new Promise<void>((resolve, reject) => {
    doc.on('end', () => resolve())
    doc.on('error', (e) => reject(e))
  })

  return Buffer.concat(chunks)
}
