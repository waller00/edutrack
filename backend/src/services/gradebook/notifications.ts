import type { InAppNotificationType, PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../db/prisma.js'
import { notifyUsers } from '../notifications/notify.js'

/**
 * Avisos de la libreta (RF-091).
 *
 * Reusa `InAppNotification` —la campana que ya existe— en vez de inventar un canal propio, y
 * además sale por push a quien lo activó. Las fallas de notificación **nunca** interrumpen la
 * acción que las originó: observar una libreta tiene que quedar registrado aunque el aviso no salga.
 */

export type NotifyTarget = { userId: string }

export type GradeBookNotification = {
  type: InAppNotificationType
  title: string
  body: string
  actionUrl: string
}

/**
 * A quién avisar de algo que pasa en una libreta.
 *
 * El titular siempre; los suplentes no, porque su vínculo es con una clase puntual y llenarles la
 * campana de movimientos de libretas que cubrieron un día sería ruido. Nunca se avisa a quien
 * originó la acción: nadie necesita que le notifiquen lo que acaba de hacer.
 */
export async function resolveGradeBookRecipients(
  gradeBookId: string,
  excludeUserId: string | null,
  db: PrismaClient = defaultPrisma,
): Promise<NotifyTarget[]> {
  const gradeBook = await db.gradeBook.findUnique({
    where: { id: gradeBookId },
    select: { teacherUserId: true },
  })
  const teacherId = gradeBook?.teacherUserId
  if (!teacherId || teacherId === excludeUserId) return []
  return [{ userId: teacherId }]
}

/** Deja los avisos en la campana y los manda por push, sin que un fallo tumbe la operación principal. */
export async function notifyGradeBook(
  targets: readonly NotifyTarget[],
  notification: GradeBookNotification,
  db: PrismaClient = defaultPrisma,
): Promise<number> {
  return notifyUsers(
    targets.map((target) => target.userId),
    notification,
    { db },
  )
}

/** Corta un texto largo para el cuerpo del aviso, sin partir a mitad de palabra. */
export function excerpt(text: string, max = 160): string {
  const clean = text.trim().replace(/\s+/g, ' ')
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${cut.slice(0, lastSpace > max / 2 ? lastSpace : max)}…`
}

export function observationNotification(params: {
  subjectName: string
  periodName: string | null
  sectionLabel: string
  observations: string
  gradeBookId: string
}): GradeBookNotification {
  const scope = params.periodName ? `${params.subjectName} · ${params.periodName}` : params.subjectName
  return {
    type: 'GRADEBOOK_OBSERVATION',
    title: `Observación en ${scope}`,
    body: `${params.sectionLabel}: ${excerpt(params.observations)}`,
    // El docente ve lo que le observaron en "Mensajes del director".
    actionUrl: `/libreta/${params.gradeBookId}/mensajes`,
  }
}

/**
 * Administración reabrió un período cerrado. Es lo que habilita al docente a corregir lo que le
 * observaron: sin el aviso, la libreta queda abierta y nadie se entera.
 */
export function reopenedNotification(params: {
  subjectName: string
  periodName: string
  reason: string
  gradeBookId: string
}): GradeBookNotification {
  return {
    type: 'GRADEBOOK_PERIOD_REOPENED',
    title: `Se reabrió ${params.subjectName} · ${params.periodName}`,
    body: `Podés corregir y volver a cerrar. Motivo: ${excerpt(params.reason)}`,
    actionUrl: `/libreta/${params.gradeBookId}/mensajes`,
  }
}

export function endorsedNotification(params: {
  subjectName: string
  periodName: string
  gradeBookId: string
}): GradeBookNotification {
  return {
    type: 'GRADEBOOK_ENDORSED',
    title: `Libreta visada: ${params.subjectName}`,
    body: `Dirección visó el período ${params.periodName}.`,
    actionUrl: `/libreta/${params.gradeBookId}/mensajes`,
  }
}

/**
 * Aviso de un mensaje de la libreta. Al docente lo lleva a "Mensajes del director"; a quien
 * supervisa (la respuesta del docente a un mensaje suyo), a "Visado y seguimiento", que es donde
 * escribe.
 */
export function messageNotification(params: {
  subjectName: string
  authorName: string | null
  body: string
  gradeBookId: string
  recipient?: 'teacher' | 'supervisor'
}): GradeBookNotification {
  const section = params.recipient === 'supervisor' ? 'visado' : 'mensajes'
  return {
    type: 'GRADEBOOK_MESSAGE',
    title: params.recipient === 'supervisor' ? `Respuesta en ${params.subjectName}` : `Mensaje en ${params.subjectName}`,
    body: `${params.authorName ?? 'Alguien'}: ${excerpt(params.body)}`,
    actionUrl: `/libreta/${params.gradeBookId}/${section}`,
  }
}

type ThreadMessage = { id: string; parentId: string | null; authorRoleCode: string }

/**
 * Los hilos que abrió un rol, con todas sus respuestas. Es "Mensajes del director": el docente ve
 * lo que le escribió Dirección y lo que él mismo contestó ahí, no el resto del intercambio.
 */
export function threadsStartedBy<T extends ThreadMessage>(messages: readonly T[], roleCode: string): T[] {
  const roots = new Set(messages.filter((m) => !m.parentId && m.authorRoleCode === roleCode).map((m) => m.id))
  return messages.filter((m) => (m.parentId ? roots.has(m.parentId) : roots.has(m.id)))
}

/**
 * Aviso de adscripción al docente: "a esta libreta le falta esto".
 *
 * Usa `GRADEBOOK_PERIOD_CLOSING`, que estaba **declarado en el enum y sin producir nunca**. El
 * cuerpo dice qué falta y cuánto: un "revisá tu libreta" no le ahorra el trabajo de buscar.
 */
export function completionRequestNotification(params: {
  subjectName: string
  detail: string
  gradeBookId: string
  periodId?: string
  /** Después de la reunión lo que falta es la R y cerrar, no completar. */
  stage?: 'before' | 'after'
}): GradeBookNotification {
  return {
    type: 'GRADEBOOK_PERIOD_CLOSING',
    title: `${params.stage === 'after' ? 'Falta cerrar' : 'Falta completar'} ${params.subjectName}`,
    body: params.detail,
    actionUrl: `/libreta/${params.gradeBookId}/cierre${params.periodId ? `?periodId=${params.periodId}` : ''}`,
  }
}

/**
 * Un solo aviso por docente con todas sus libretas pendientes: "avisar a todos" no puede llenarle
 * la campana con una notificación por materia.
 */
export function completionDigestNotification(params: {
  periodName: string
  stage: 'before' | 'after'
  items: ReadonlyArray<{ label: string; detail: string }>
}): GradeBookNotification {
  const count = params.items.length
  const libretas = count === 1 ? '1 libreta' : `${count} libretas`
  return {
    type: 'GRADEBOOK_PERIOD_CLOSING',
    title:
      params.stage === 'after'
        ? `${params.periodName}: falta cerrar ${libretas}`
        : `${params.periodName}: falta completar ${libretas}`,
    body: excerpt(params.items.map((item) => `${item.label}: ${item.detail}`).join(' · '), 900),
    actionUrl: '/libreta',
  }
}
