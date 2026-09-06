import type { InAppNotificationType, PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../db/prisma.js'

/**
 * Avisos de la libreta (RF-091).
 *
 * Reusa `InAppNotification` —la campana que ya existe— en vez de inventar un canal propio. Las
 * fallas de notificación **nunca** interrumpen la acción que las originó: observar una libreta
 * tiene que quedar registrado aunque el aviso no salga.
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

/** Inserta los avisos sin dejar que un fallo tumbe la operación principal. */
export async function notifyGradeBook(
  targets: readonly NotifyTarget[],
  notification: GradeBookNotification,
  db: PrismaClient = defaultPrisma,
): Promise<number> {
  if (targets.length === 0) return 0
  try {
    const result = await db.inAppNotification.createMany({
      data: targets.map((target) => ({
        userId: target.userId,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        actionUrl: notification.actionUrl,
      })),
    })
    return result.count
  } catch (error) {
    console.error('[gradebook] notify:', error)
    return 0
  }
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
    actionUrl: `/me/gradebook/${params.gradeBookId}`,
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
    actionUrl: `/me/gradebook/${params.gradeBookId}`,
  }
}

export function messageNotification(params: {
  subjectName: string
  authorName: string | null
  body: string
  gradeBookId: string
}): GradeBookNotification {
  return {
    type: 'GRADEBOOK_MESSAGE',
    title: `Mensaje en ${params.subjectName}`,
    body: `${params.authorName ?? 'Alguien'}: ${excerpt(params.body)}`,
    actionUrl: `/me/gradebook/${params.gradeBookId}`,
  }
}
