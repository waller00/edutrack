import { prisma } from '../../prisma.js'
import type { Attendance, AttendanceStatus, EventType, Role } from '@prisma/client'
import type { PlannedInstance, ResolvedAttendanceByInstance } from './models.js'
import { toYmdUtc } from './dateRange.js'

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

function clampNonNegativeMinutes(msDelta: number) {
  const mins = msDelta / (1000 * 60)
  return mins <= 0 ? 0 : mins
}

function normalizeAttendanceStatus(status: AttendanceStatus): ResolvedAttendanceByInstance['checkInStatusResolved'] {
  return status as any
}

export async function resolveAttendanceAndJustification(params: {
  plannedInstances: PlannedInstance[]
}) {
  const instances = params.plannedInstances
  const instanceByPlannedId = new Map(instances.map((i) => [i.plannedInstanceId, i]))
  const plannedIds = instances.map((i) => i.plannedInstanceId)

  const userIds = Array.from(new Set(instances.map((i) => i.userIdRequired).filter(Boolean))) as string[]
  const eventIds = Array.from(new Set(instances.map((i) => i.eventId))) as string[]

  if (instances.length === 0) {
    return [] as ResolvedAttendanceByInstance[]
  }

  const attendances = await prisma.attendance.findMany({
    where: {
      userId: { in: userIds },
      eventId: { in: eventIds },
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

  const userRows = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, email: true, role: true, name: true, username: true, firstName: true, lastName: true },
  })
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

  const checkInByPlannedId = new Map<string, Attendance[]>()
  const checkOutByPlannedId = new Map<string, Attendance[]>()

  for (const att of attendances) {
    if (!att.eventId) continue
    const plannedId = `${att.eventId}_${toYmdUtc(att.date)}`
    if (!instanceByPlannedId.has(plannedId)) continue
    if (att.type === 'CHECK_IN') {
      if (!checkInByPlannedId.has(plannedId)) checkInByPlannedId.set(plannedId, [])
      checkInByPlannedId.get(plannedId)!.push(att as any)
    } else {
      if (!checkOutByPlannedId.has(plannedId)) checkOutByPlannedId.set(plannedId, [])
      checkOutByPlannedId.get(plannedId)!.push(att as any)
    }
  }

  const resolved: ResolvedAttendanceByInstance[] = []

  for (const planned of instances) {
    const user = userById.get(planned.userIdRequired || '')
    const userDisplayName = user ? formatUserDisplayName(user) : 'Sin nombre'
    const userRole = (user?.role || 'STAFF') as Role
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

    const actualInTime = selectedIn ? new Date(selectedIn.time) : null
    const plannedEnd = planned.plannedEndTime
    const actualOutTime = selectedOut
      ? new Date(selectedOut.time)
      : plannedEnd
        ? new Date(plannedEnd)
        : null

    let checkInStatusResolved: ResolvedAttendanceByInstance['checkInStatusResolved']
    if (selectedIn) {
      checkInStatusResolved = normalizeAttendanceStatus(selectedIn.status as AttendanceStatus)
    } else {
      checkInStatusResolved = (isJustifiedAbsence ? 'ABSENT_JUSTIFIED' : 'ABSENT_NOT_JUSTIFIED') as any
    }

    let checkOutStatusResolved: ResolvedAttendanceByInstance['checkOutStatusResolved']
    if (selectedOut) {
      checkOutStatusResolved = normalizeAttendanceStatus(selectedOut.status as AttendanceStatus) as any
    } else if (checkInStatusResolved === 'ABSENT_JUSTIFIED' || checkInStatusResolved === 'ABSENT_NOT_JUSTIFIED') {
      checkOutStatusResolved = checkInStatusResolved
    } else {
      // Checkout faltante: si hay endTime planificado, asumimos salida a fin para export/horas.
      checkOutStatusResolved = planned.plannedEndTime ? 'EXIT' : 'PRESENT'
    }

    const durationMinutes = actualInTime && actualOutTime ? clampNonNegativeMinutes(actualOutTime.getTime() - actualInTime.getTime()) : 0

    resolved.push({
      planned,
      checkInStatusResolved,
      checkOutStatusResolved,
      hasCheckIn: Boolean(selectedIn),
      hasCheckOut: Boolean(selectedOut),
      actualInTime,
      actualOutTime,
      durationMinutes,
      isJustifiedAbsence,
      licenseIdJustifying,
      checkInNotes: selectedIn?.notes ?? null,
      checkOutNotes: selectedOut?.notes ?? null,
      userDisplayName,
      userRole,
      userEmail,
    })
  }

  return resolved
}
