/**
 * Reconciliación licencias médicas ↔ eventos ↔ asistencias (EduTrack).
 * - No cancela eventos.
 * - Marca / crea asistencia en ABSENT_JUSTIFIED cuando corresponde.
 * - No sobrescribe PRESENT/LATE sin dejar rastro (notas de conflicto).
 */
import type { AttendanceStatus, Event, MedicalLeave } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { expandRecurringEvent } from '../events/events-query.js'

const AUDIT_PREFIX = '[LIC-AUTO]'

export function rangesOverlapInstant(a0: Date, a1: Date, b0: Date, b1: Date): boolean {
  return a0.getTime() <= b1.getTime() && b0.getTime() <= a1.getTime()
}

/** Licencia activa en sentido de vigencia: [start, end] por instantes. */
export function licenseCoversInstant(license: Pick<MedicalLeave, 'startDate' | 'endDate'>, at: Date): boolean {
  return license.startDate.getTime() <= at.getTime() && at.getTime() <= license.endDate.getTime()
}

function auditNote(licenseId: string, action: string) {
  return `${AUDIT_PREFIX} ${new Date().toISOString()} licencia=${licenseId} ${action}`
}

function normalizeUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0))
}

type Occurrence = {
  parentEventId: string
  attendanceDay: Date
  occStart: Date
  occEnd: Date
}

function collectOccurrencesForLicenseWindow(
  event: Event & { childEvents?: Event[] },
  licenseStart: Date,
  licenseEnd: Date,
): Occurrence[] {
  const expanded = expandRecurringEvent(event, licenseStart.toISOString(), licenseEnd.toISOString())
  const out: Occurrence[] = []

  for (const occ of expanded) {
    if (occ.status === 'CANCELLED') continue
    const occStart = occ.startTime ? new Date(occ.startTime) : new Date(occ.startDate)
    const occEnd = occ.endTime ? new Date(occ.endTime) : occStart
    if (!rangesOverlapInstant(licenseStart, licenseEnd, occStart, occEnd)) continue

    const parentEventId: string =
      (occ as any).originalEventId ??
      (String(occ.id).includes('_') ? String(occ.id).split('_')[0] : String(occ.id))

    out.push({
      parentEventId,
      attendanceDay: normalizeUtcDay(occStart),
      occStart,
      occEnd,
    })
  }

  return out
}

/**
 * Tras crear o editar una licencia ACTIVE: alinea asistencias de eventos del funcionario
 * cuyo horario cae dentro de la vigencia.
 */
export async function reconcileAttendancesForMedicalLeave(licenseId: string): Promise<{
  justified: number
  created: number
  conflicts: number
  skipped: number
}> {
  const license = await prisma.medicalLeave.findUnique({ where: { id: licenseId } })
  if (!license || String(license.status) !== 'ACTIVE') {
    return { justified: 0, created: 0, conflicts: 0, skipped: 0 }
  }

  const licenseStart = license.startDate
  const licenseEnd = license.endDate

  const events = await prisma.event.findMany({
    where: {
      assignedUserId: license.userId,
      status: { not: 'CANCELLED' },
    },
    include: {
      childEvents: true,
    },
  })

  let justified = 0
  let created = 0
  let conflicts = 0
  let unchanged = 0

  const seen = new Set<string>()

  for (const ev of events) {
    const occs = collectOccurrencesForLicenseWindow(ev as any, licenseStart, licenseEnd)

    for (const o of occs) {
      const key = `${o.parentEventId}|${o.attendanceDay.toISOString()}`
      if (seen.has(key)) continue
      seen.add(key)

      const existing = await prisma.attendance.findFirst({
        where: {
          userId: license.userId,
          eventId: o.parentEventId,
          type: 'CHECK_IN',
          date: o.attendanceDay,
        },
      })

      if (!existing) {
        await prisma.attendance.create({
          data: {
            userId: license.userId,
            eventId: o.parentEventId,
            schoolYearId: ev.schoolYearId,
            type: 'CHECK_IN',
            status: 'ABSENT_JUSTIFIED' as AttendanceStatus,
            date: o.attendanceDay,
            time: o.occStart,
            notes: `${auditNote(license.id, 'crear ausencia justificada por licencia')} · evento=${o.parentEventId}`,
          },
        })
        created++
        continue
      }

      if (existing.status === 'ABSENT_NOT_JUSTIFIED') {
        await prisma.attendance.update({
          where: { id: existing.id },
          data: {
            status: 'ABSENT_JUSTIFIED',
            notes: `${existing.notes ? `${existing.notes}\n` : ''}${auditNote(license.id, 'ABSENT_NOT_JUSTIFIED→ABSENT_JUSTIFIED')}`,
          },
        })
        justified++
        continue
      }

      if (existing.status === 'ABSENT_JUSTIFIED') {
        unchanged++
        continue
      }

      if (existing.status === 'PRESENT' || existing.status === 'LATE') {
        await prisma.attendance.update({
          where: { id: existing.id },
          data: {
            notes: `${existing.notes ? `${existing.notes}\n` : ''}${auditNote(
              license.id,
              `CONFLICTO: había ${existing.status} con licencia superpuesta; revisar manualmente`,
            )}`,
          },
        })
        conflicts++
        continue
      }

      unchanged++
    }
  }

  // Compatibilidad: registros viejos sin eventId pero en rango (solo CHECK_IN no justificados)
  const legacy = await prisma.attendance.updateMany({
    where: {
      userId: license.userId,
      eventId: null,
      type: 'CHECK_IN',
      status: 'ABSENT_NOT_JUSTIFIED',
      date: { gte: normalizeUtcDay(licenseStart), lte: normalizeUtcDay(licenseEnd) },
    },
    data: {
      status: 'ABSENT_JUSTIFIED',
      notes: `${AUDIT_PREFIX} ${new Date().toISOString()} licencia=${license.id} (sin evento vinculado)`,
    },
  })
  justified += legacy.count

  return { justified, created, conflicts, skipped: unchanged }
}

/** ¿Hay licencia activa que cubra el instante del evento (inicio)? */
export async function findApprovedLicenseCoveringEventTime(userId: string, eventStart: Date, eventEnd: Date) {
  const leaves = await prisma.medicalLeave.findMany({
    where: {
      userId,
      status: 'ACTIVE' as any,
      startDate: { lte: eventEnd },
      endDate: { gte: eventStart },
    },
  })
  return leaves.find((l) => rangesOverlapInstant(l.startDate, l.endDate, eventStart, eventEnd)) ?? null
}
