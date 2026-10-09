/**
 * Reconciliación licencias médicas ↔ eventos ↔ asistencias (EduTrack).
 * - No cancela eventos.
 * - Marca / crea asistencia en ABSENT_JUSTIFIED cuando corresponde.
 * - No sobrescribe PRESENT/LATE sin dejar rastro (notas de conflicto).
 */
import type { AttendanceStatus, Event, MedicalLeave } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { expandRecurringEvent } from '../events/events-query.js'
import { licenseWindow } from './medical-leave-dates.js'

const AUDIT_PREFIX = '[LIC-AUTO]'

export function rangesOverlapInstant(a0: Date, a1: Date, b0: Date, b1: Date): boolean {
  return a0.getTime() <= b1.getTime() && b0.getTime() <= a1.getTime()
}

/** ¿La licencia cubre ese instante? Cubre sus días enteros en hora institucional (`licenseWindow`). */
export function licenseCoversInstant(license: Pick<MedicalLeave, 'startDate' | 'endDate'>, at: Date): boolean {
  const { from, to } = licenseWindow(license)
  return from.getTime() <= at.getTime() && at.getTime() <= to.getTime()
}

const DAY_MS = 24 * 60 * 60 * 1000

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

/** Acción con la que la conciliación crea una ausencia; distingue lo que la licencia creó de lo que justificó. */
const CREATED_ACTION = 'crear ausencia justificada por licencia'

type ReconciliationResult = {
  justified: number
  created: number
  conflicts: number
  skipped: number
  /** Ausencias que la licencia había justificado y volvieron a quedar sin justificar. */
  reverted: number
  /** Ausencias que la licencia había creado y ya no corresponden (o eran de clases que todavía no pasaron). */
  removed: number
}

type JustifiedRow = {
  status: AttendanceStatus
  time: Date
  notes: string | null
  _count: { justifications: number }
}

export type RevertAction = 'keep' | 'remove' | 'revert'

/**
 * Qué hacer con una asistencia que tocó la licencia, ahora que la licencia cambió.
 *
 * - Una justificación a mano (`AttendanceJustification`) no se toca nunca.
 * - Lo que la licencia **creó** se borra si ya no lo cubre o si la clase todavía no pasó: sin la
 *   fila, la ausencia se calcula en vivo (virtual) cuando termina la clase, con la licencia que
 *   corresponda en ese momento.
 * - Lo que la licencia **justificó** (era una falta sin justificar) vuelve a sin justificar.
 */
export function revertActionFor(
  row: JustifiedRow,
  licenseId: string,
  coversRow: boolean,
  now: Date,
): RevertAction {
  if (row.status !== 'ABSENT_JUSTIFIED' || row._count.justifications > 0) return 'keep'
  const createdByLicense = (row.notes ?? '').includes(`licencia=${licenseId} ${CREATED_ACTION}`)
  if (createdByLicense && row.time.getTime() > now.getTime()) return 'remove'
  if (coversRow) return 'keep'
  return createdByLicense ? 'remove' : 'revert'
}

/**
 * Deshace lo que la licencia ya no cubre: desactivada, o acortada. Antes las faltas que había
 * justificado quedaban justificadas igual.
 */
async function revertLicenseJustifications(license: MedicalLeave, now: Date): Promise<{ reverted: number; removed: number }> {
  const rows = await prisma.attendance.findMany({
    where: { userId: license.userId, notes: { contains: `licencia=${license.id} ` } },
    select: { id: true, status: true, time: true, notes: true, _count: { select: { justifications: true } } },
  })
  const active = String(license.status) === 'ACTIVE'
  let reverted = 0
  let removed = 0
  for (const row of rows) {
    const action = revertActionFor(row, license.id, active && licenseCoversInstant(license, row.time), now)
    if (action === 'remove') {
      await prisma.attendance.delete({ where: { id: row.id } })
      removed++
      continue
    }
    if (action !== 'revert') continue
    // Otra licencia vigente la sigue cubriendo: queda justificada.
    if (await findApprovedLicenseCoveringEventTime(license.userId, row.time, row.time)) continue
    await prisma.attendance.update({
      where: { id: row.id },
      data: {
        status: 'ABSENT_NOT_JUSTIFIED',
        notes: `${row.notes ? `${row.notes}\n` : ''}${auditNote(license.id, 'revertida: la licencia ya no cubre esta clase')}`,
      },
    })
    reverted++
  }
  return { reverted, removed }
}

/**
 * Alinea las asistencias del funcionario con la licencia, después de crearla, editarla o
 * desactivarla.
 *
 * **En vivo:** sólo toca las clases que ya terminaron. Antes, cargar el lunes una licencia para
 * el jueves creaba la ausencia del jueves en el momento; ahora aparece el jueves, cuando termina
 * la clase (la ausencia virtual ya mira las licencias). Y lo que la licencia ya no cubre se deshace.
 */
export async function reconcileAttendancesForMedicalLeave(licenseId: string, now = new Date()): Promise<ReconciliationResult> {
  const empty: ReconciliationResult = { justified: 0, created: 0, conflicts: 0, skipped: 0, reverted: 0, removed: 0 }
  const license = await prisma.medicalLeave.findUnique({ where: { id: licenseId } })
  if (!license) return empty

  const undone = await revertLicenseJustifications(license, now)
  // Días enteros: una clase de las 7:30 del primer día o de la tarde del último también es de la licencia.
  const { from: licenseStart, to: windowEnd } = licenseWindow(license)
  if (String(license.status) !== 'ACTIVE' || licenseStart.getTime() > now.getTime()) return { ...empty, ...undone }
  const licenseEnd = new Date(Math.min(windowEnd.getTime(), now.getTime()))

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
      // Una clase en curso o por venir todavía no tiene ausencia: aparece cuando termina.
      if (o.occEnd.getTime() > now.getTime()) continue
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
            notes: `${auditNote(license.id, CREATED_ACTION)} · evento=${o.parentEventId}`,
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
        // Cada edición de la licencia vuelve a conciliar: el mismo conflicto se anota una vez.
        if ((existing.notes ?? '').includes(`licencia=${license.id} CONFLICTO`)) {
          conflicts++
          continue
        }
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
      // Por día: el final de la ventana ya cae al día UTC siguiente y sumaría uno de más. Y sólo
      // hasta hoy, igual que las clases con evento.
      date: {
        gte: normalizeUtcDay(license.startDate),
        lte: normalizeUtcDay(new Date(Math.min(license.endDate.getTime(), now.getTime()))),
      },
    },
    data: {
      status: 'ABSENT_JUSTIFIED',
      notes: `${AUDIT_PREFIX} ${new Date().toISOString()} licencia=${license.id} (sin evento vinculado)`,
    },
  })
  justified += legacy.count

  return { justified, created, conflicts, skipped: unchanged, ...undone }
}

/**
 * Corrección única de los datos de antes: la conciliación creaba la ausencia justificada de las
 * clases futuras en el momento de cargar la licencia. Se borran las que todavía no pasaron (sin
 * justificación a mano); cuando la clase termine, la ausencia aparece en vivo. Devuelve cuántas
 * son; sin `apply` no borra nada.
 */
export async function removeFutureLicenseAbsences(apply: boolean, now = new Date()): Promise<number> {
  const where = {
    status: 'ABSENT_JUSTIFIED' as AttendanceStatus,
    time: { gt: now },
    notes: { contains: CREATED_ACTION },
    justifications: { none: {} },
  }
  if (!apply) return prisma.attendance.count({ where })
  const { count } = await prisma.attendance.deleteMany({ where })
  return count
}

/**
 * ¿Hay licencia activa que cubra el evento? La consulta trae con un día de margen —las fechas
 * guardadas son el mediodía o la medianoche UTC del día— y la ventana exacta se mira después.
 */
export async function findApprovedLicenseCoveringEventTime(userId: string, eventStart: Date, eventEnd: Date) {
  const leaves = await prisma.medicalLeave.findMany({
    where: {
      userId,
      status: 'ACTIVE' as any,
      startDate: { lte: new Date(eventEnd.getTime() + DAY_MS) },
      endDate: { gte: new Date(eventStart.getTime() - DAY_MS) },
    },
  })
  return (
    leaves.find((l) => {
      const { from, to } = licenseWindow(l)
      return rangesOverlapInstant(from, to, eventStart, eventEnd)
    }) ?? null
  )
}
