import type { AttendanceStatus, AttendanceType, EventType } from '@prisma/client'
import { prisma } from '../../../db/prisma.js'
import { mergeSchoolYearIntoAttendanceEventWhere } from '../../../attendance/attendance-school-year.js'
import { selectOrgRoleCode } from '../../../identity/user-role-prisma.js'

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

async function buildAttendanceDetailRowsFromAttendances(params: {
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
