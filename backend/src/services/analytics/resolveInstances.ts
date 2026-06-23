import { prisma } from '../../db/prisma.js'
import type { Attendance, AttendanceStatus } from '@prisma/client'
import { attachRoleCode, selectOrgRoleCode } from '../../identity/user-role-prisma.js'
import type { PlannedInstance, ResolvedAttendanceByInstance } from './models.js'
import { toYmdUtc } from './dateRange.js'
import {
  buildPresenceSpans,
  clampedOverlapMinutes,
  findCoveringSpan,
  userDateKey,
  type AttendanceRowLite,
  type PresenceSpan,
} from '../attendance/coverage-spans.js'

type AttendanceRow = Pick<Attendance, 'id' | 'userId' | 'eventId' | 'date' | 'time' | 'type' | 'status' | 'notes'>

function formatUserDisplayName(u: {
  name: string | null
  username: string | null
  firstName: string | null
  lastName: string | null
}) {
  if (u.name) return u.name
  const full = `${u.firstName || ''} ${u.lastName || ''}`.trim()
  if (full) return full
  return u.username || 'Sin nombre'
}

function normalizeAttendanceStatus(status: AttendanceStatus): ResolvedAttendanceByInstance['checkInStatusResolved'] {
  return status as any
}

/** Span de presencia (posiblemente abierto) que cubre la ventana planificada de la instancia. */
function findSpanCoveringPlannedInstance(
  planned: PlannedInstance,
  spansByUserDate: Map<string, PresenceSpan[]>,
): PresenceSpan | null {
  if (!planned.userIdRequired || !planned.plannedStartTime || !planned.plannedEndTime) return null
  const spans = spansByUserDate.get(userDateKey(planned.userIdRequired, planned.plannedDate)) ?? []
  return findCoveringSpan(
    {
      userId: planned.userIdRequired,
      ymd: planned.plannedDate,
      plannedStart: new Date(planned.plannedStartTime),
      plannedEnd: new Date(planned.plannedEndTime),
    },
    spans,
  )
}

function resolveDerivedCheckInStatus(params: {
  attendance: AttendanceRowLite
  plannedStartTime: Date | null
}): ResolvedAttendanceByInstance['checkInStatusResolved'] {
  if (params.plannedStartTime && new Date(params.attendance.time).getTime() <= new Date(params.plannedStartTime).getTime()) {
    return 'PRESENT'
  }
  return normalizeAttendanceStatus(params.attendance.status as AttendanceStatus)
}

function resolveDerivedCheckOutStatus(params: {
  attendance: AttendanceRowLite
  plannedEndTime: Date | null
}): ResolvedAttendanceByInstance['checkOutStatusResolved'] {
  if (params.plannedEndTime && new Date(params.attendance.time).getTime() < new Date(params.plannedEndTime).getTime()) {
    return 'EARLY_EXIT'
  }
  return 'EXIT'
}

export async function resolveAttendanceAndJustification(params: {
  plannedInstances: PlannedInstance[]
}) {
  const instances = params.plannedInstances
  const instanceByPlannedId = new Map(instances.map((i) => [i.plannedInstanceId, i]))

  const userIds = Array.from(new Set(instances.map((i) => i.userIdRequired).filter(Boolean))) as string[]

  if (instances.length === 0) {
    return [] as ResolvedAttendanceByInstance[]
  }

  const attendances = await prisma.attendance.findMany({
    where: {
      userId: { in: userIds },
      date: {
        gte: new Date(`${instances[0].plannedDate}T00:00:00.000Z`),
        lte: new Date(`${instances[instances.length - 1].plannedDate}T23:59:59.999Z`),
      },
      // Solo los tipos que usamos en métricas/exports.
      type: { in: ['CHECK_IN', 'CHECK_OUT'] },
    },
    select: {
      id: true,
      userId: true,
      eventId: true,
      date: true,
      time: true,
      type: true,
      status: true,
      notes: true,
    },
  })

  const userRowsRaw = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      email: true,
      name: true,
      username: true,
      firstName: true,
      lastName: true,
      ...selectOrgRoleCode,
    },
  })
  const userRows = userRowsRaw.map((u) => attachRoleCode(u))
  const userById = new Map(userRows.map((u) => [u.id, u]))

  // Licencias médicas activas para justificación de ausencias.
  // Criterio: solape por fecha en rango [minPlannedDate, maxPlannedDate].
  const minPlannedDate = instances[0].plannedDate
  const maxPlannedDate = instances[instances.length - 1].plannedDate
  const approvedLicenses = await prisma.medicalLeave.findMany({
    where: {
      status: 'ACTIVE' as any,
      userId: { in: userIds },
      startDate: { lte: new Date(`${maxPlannedDate}T23:59:59.999Z`) },
      endDate: { gte: new Date(`${minPlannedDate}T00:00:00.000Z`) },
    },
    select: { id: true, userId: true, startDate: true, endDate: true },
  })
  const licensesByUser = new Map<string, typeof approvedLicenses>()
  for (const l of approvedLicenses) {
    if (!licensesByUser.has(l.userId)) licensesByUser.set(l.userId, [])
    licensesByUser.get(l.userId)!.push(l)
  }

  const checkInByPlannedId = new Map<string, AttendanceRow[]>()
  const checkOutByPlannedId = new Map<string, AttendanceRow[]>()
  const spansByUserDate = buildPresenceSpans(attendances)

  // Match por (usuario, evento, fecha): una clase suplida tiene dos instancias para el
  // mismo evento/fecha (titular y suplente), así que cada marca debe ir a la instancia de
  // su propio usuario, no a la primera que coincida por evento+fecha.
  const instanceByUserEventDate = new Map<string, PlannedInstance>()
  for (const i of instances) {
    if (i.userIdRequired) instanceByUserEventDate.set(`${i.userIdRequired}|${i.eventId}|${i.plannedDate}`, i)
  }

  for (const att of attendances) {
    if (!att.eventId) continue
    const inst = instanceByUserEventDate.get(`${att.userId}|${att.eventId}|${toYmdUtc(att.date)}`)
    if (!inst) continue
    const plannedId = inst.plannedInstanceId
    if (att.type === 'CHECK_IN') {
      if (!checkInByPlannedId.has(plannedId)) checkInByPlannedId.set(plannedId, [])
      checkInByPlannedId.get(plannedId)!.push(att as AttendanceRow)
    } else {
      if (!checkOutByPlannedId.has(plannedId)) checkOutByPlannedId.set(plannedId, [])
      checkOutByPlannedId.get(plannedId)!.push(att as AttendanceRow)
    }
  }

  const resolved: ResolvedAttendanceByInstance[] = []

  for (const planned of instances) {
    const user = userById.get(planned.userIdRequired || '')
    const userDisplayName = user ? formatUserDisplayName(user) : 'Sin nombre'
    const userRole = user?.role || 'STAFF'
    const userEmail = user?.email || ''

    const licenses = planned.userIdRequired ? licensesByUser.get(planned.userIdRequired) || [] : []
    const plannedDate = planned.plannedDate
    let isJustifiedAbsence = false
    let licenseIdJustifying: string | null = null

    if (planned.userIdRequired) {
      for (const l of licenses) {
        const startYmd = toYmdUtc(l.startDate)
        const endYmd = toYmdUtc(l.endDate)
        if (startYmd <= plannedDate && plannedDate <= endYmd) {
          isJustifiedAbsence = true
          licenseIdJustifying = l.id
          break
        }
      }
    }

    const inArr = checkInByPlannedId.get(planned.plannedInstanceId) || []
    const outArr = checkOutByPlannedId.get(planned.plannedInstanceId) || []

    const selectedIn = inArr.length
      ? [...inArr].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())[0]
      : null
    const selectedOut = outArr.length
      ? [...outArr].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())[0]
      : null

    const span = findSpanCoveringPlannedInstance(planned, spansByUserDate)
    const effectiveIn = selectedIn ?? span?.checkIn ?? null
    const effectiveOut = selectedOut ?? span?.checkOut ?? null

    const actualInTime = effectiveIn ? new Date(effectiveIn.time) : null
    const plannedEnd = planned.plannedEndTime
    const actualOutTime = effectiveOut
      ? new Date(effectiveOut.time)
      : plannedEnd
        ? new Date(plannedEnd)
        : null

    let checkInStatusResolved: ResolvedAttendanceByInstance['checkInStatusResolved']
    if (selectedIn) {
      checkInStatusResolved = normalizeAttendanceStatus(selectedIn.status as AttendanceStatus)
    } else if (span?.checkIn) {
      checkInStatusResolved = resolveDerivedCheckInStatus({
        attendance: span.checkIn,
        plannedStartTime: planned.plannedStartTime,
      })
    } else {
      checkInStatusResolved = (isJustifiedAbsence ? 'ABSENT_JUSTIFIED' : 'ABSENT_NOT_JUSTIFIED') as any
    }

    let checkOutStatusResolved: ResolvedAttendanceByInstance['checkOutStatusResolved']
    if (selectedOut) {
      checkOutStatusResolved = normalizeAttendanceStatus(selectedOut.status as AttendanceStatus) as any
    } else if (span?.checkOut) {
      checkOutStatusResolved = resolveDerivedCheckOutStatus({
        attendance: span.checkOut,
        plannedEndTime: planned.plannedEndTime,
      })
    } else if (checkInStatusResolved === 'ABSENT_JUSTIFIED' || checkInStatusResolved === 'ABSENT_NOT_JUSTIFIED') {
      checkOutStatusResolved = checkInStatusResolved
    } else {
      // Checkout faltante: si hay endTime planificado, asumimos salida a fin para export/horas.
      checkOutStatusResolved = planned.plannedEndTime ? 'EXIT' : 'PRESENT'
    }

    const durationMinutes = clampedOverlapMinutes(
      actualInTime,
      actualOutTime,
      planned.plannedStartTime,
      planned.plannedEndTime,
    )

    resolved.push({
      planned,
      checkInStatusResolved,
      checkOutStatusResolved,
      hasCheckIn: Boolean(effectiveIn),
      hasCheckOut: Boolean(effectiveOut),
      actualInTime,
      actualOutTime,
      durationMinutes,
      isJustifiedAbsence,
      licenseIdJustifying,
      checkInNotes: effectiveIn?.notes ?? null,
      checkOutNotes: effectiveOut?.notes ?? null,
      userDisplayName,
      userRole,
      userEmail,
    })
  }

  return resolved
}
