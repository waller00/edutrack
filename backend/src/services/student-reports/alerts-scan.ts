import type { Prisma, StudentAlertType } from '@prisma/client'
import { prisma } from '../../db/prisma.js'
import { getActiveSchoolYearId } from '../school-year-service.js'
import { formatAbsenceUnits } from '../student-attendance/absence-weight.js'
import { loadAbsenceStreaks, loadAbsenceThresholds, loadAllGradeDrops } from './reports.js'
import { thresholdKey } from './rules.js'

/**
 * Alertas de estudiantes: detecta, guarda lo nuevo y avisa **una vez** a adscripción y dirección.
 *
 * Los detectores son los mismos cargadores que usa la pantalla de Reportes. La tabla
 * `StudentAlert` sólo recuerda qué se avisó: su unique `(tipo, alumno, clave)` hace que una racha,
 * un umbral o una baja se notifiquen una sola vez aunque el escaneo corra cada hora.
 */

export type AlertCandidate = {
  type: StudentAlertType
  studentId: string
  key: string
  title: string
  body: string
  payload: Prisma.InputJsonValue
}

/** Roles que reciben las alertas. */
export const ALERT_RECIPIENT_ROLES = ['DIRECCION', 'ADSCRIPTO'] as const

/** Con más alertas nuevas que esto, se manda un resumen en vez de una notificación por alerta. */
export const MAX_INDIVIDUAL_NOTIFICATIONS = 5

const TAB_BY_TYPE: Record<StudentAlertType, string> = {
  GRADE_DROP: 'bajas',
  ABSENCE_STREAK: 'seguidas',
  ABSENCE_THRESHOLD: 'faltas',
}

const fullName = (s: { firstName: string; lastName: string }) => `${s.lastName}, ${s.firstName}`
const gradeUnits = (hundredths: number) => formatAbsenceUnits(hundredths)

export async function collectAlertCandidates(schoolYearId: string): Promise<AlertCandidate[]> {
  const [thresholds, streaks, drops] = await Promise.all([
    loadAbsenceThresholds(schoolYearId),
    loadAbsenceStreaks(schoolYearId),
    loadAllGradeDrops(schoolYearId),
  ])
  const candidates: AlertCandidate[] = []
  for (const row of thresholds) {
    for (const threshold of row.reached) {
      candidates.push({
        type: 'ABSENCE_THRESHOLD',
        studentId: row.studentId,
        key: thresholdKey(threshold),
        title: `${fullName(row)} llegó a ${thresholdKey(threshold)} faltas`,
        body: `${row.courseName}: lleva ${formatAbsenceUnits(row.absenceHundredths)} faltas en el ciclo.`,
        payload: { ...row },
      })
    }
  }
  for (const row of streaks) {
    candidates.push({
      type: 'ABSENCE_STREAK',
      studentId: row.studentId,
      key: row.from,
      title: `${fullName(row)}: ${row.days} días seguidos de falta`,
      body: `${row.courseName}: faltó sin justificar desde el ${row.from}${row.open ? ' y sigue faltando' : ` hasta el ${row.to}`}.`,
      payload: { ...row },
    })
  }
  for (const result of drops) {
    for (const row of result.rows) {
      candidates.push({
        type: 'GRADE_DROP',
        studentId: row.studentId,
        key: `${result.period.id}:${row.subjectId}`,
        title: `${fullName(row)} bajó en ${row.subjectName}`,
        body: `${row.courseName}: de ${gradeUnits(row.previous)} (${result.previous?.name}) a ${gradeUnits(row.current)} (${result.period.name}).`,
        payload: { ...row, periodId: result.period.id, periodName: result.period.name, previousName: result.previous?.name ?? null },
      })
    }
  }
  return candidates
}

const identity = (a: { type: string; studentId: string; key: string }) => `${a.type}|${a.studentId}|${a.key}`

/** Las que todavía no se avisaron. */
export function newAlerts(
  candidates: readonly AlertCandidate[],
  existing: readonly { type: string; studentId: string; key: string }[],
): AlertCandidate[] {
  const seen = new Set(existing.map(identity))
  const fresh = new Map<string, AlertCandidate>()
  for (const candidate of candidates) {
    const id = identity(candidate)
    if (!seen.has(id) && !fresh.has(id)) fresh.set(id, candidate)
  }
  return [...fresh.values()]
}

/** Notificaciones a crear: una por alerta, o un resumen si son demasiadas. */
export function notificationsFor(alerts: readonly AlertCandidate[]) {
  if (alerts.length === 0) return []
  if (alerts.length > MAX_INDIVIDUAL_NOTIFICATIONS) {
    return [
      {
        title: `${alerts.length} alertas nuevas de estudiantes`,
        body: 'Faltas seguidas, umbrales de faltas o bajas de boletín. Revisalas en Reportes.',
        actionUrl: '/admin/reportes?tab=alertas',
      },
    ]
  }
  return alerts.map((a) => ({ title: a.title, body: a.body, actionUrl: `/admin/reportes?tab=${TAB_BY_TYPE[a.type]}` }))
}

export async function scanStudentAlerts(schoolYearId?: string | null): Promise<{ created: number }> {
  const yearId = schoolYearId ?? (await getActiveSchoolYearId(prisma))
  if (!yearId) return { created: 0 }

  const candidates = await collectAlertCandidates(yearId)
  if (candidates.length === 0) return { created: 0 }
  const existing = await prisma.studentAlert.findMany({
    where: { studentId: { in: [...new Set(candidates.map((c) => c.studentId))] } },
    select: { type: true, studentId: true, key: true },
  })
  const fresh = newAlerts(candidates, existing)
  if (fresh.length === 0) return { created: 0 }

  const { count } = await prisma.studentAlert.createMany({
    data: fresh.map((a) => ({ schoolYearId: yearId, studentId: a.studentId, type: a.type, key: a.key, payload: a.payload })),
    // Si dos escaneos corren a la vez, el unique evita el duplicado; el aviso extra es tolerable.
    skipDuplicates: true,
  })

  const recipients = await prisma.user.findMany({
    where: { isActive: true, isApproved: true, orgRole: { code: { in: [...ALERT_RECIPIENT_ROLES] } } },
    select: { id: true },
  })
  const notifications = notificationsFor(fresh)
  if (recipients.length && notifications.length) {
    await prisma.inAppNotification.createMany({
      data: recipients.flatMap((user) => notifications.map((n) => ({ userId: user.id, type: 'STUDENT_ALERT' as const, ...n }))),
    })
  }
  return { created: count }
}

// ─── Disparo ────────────────────────────────────────────────────────────────

const DEBOUNCE_MS = 2 * 60 * 1000
let pending: ReturnType<typeof setTimeout> | null = null

/**
 * Pide un escaneo en los próximos minutos. Lo llama el pase de lista: muchas listas guardadas
 * seguidas producen un solo escaneo, y el aviso de faltas no espera a la vuelta del reloj horario.
 */
export function scheduleStudentAlertScan(): void {
  if (pending) return
  pending = setTimeout(() => {
    pending = null
    scanStudentAlerts().catch((error) => console.error('[student-alerts] scan:', error))
  }, DEBOUNCE_MS)
  pending.unref?.()
}
