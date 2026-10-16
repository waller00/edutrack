import { prisma } from '../../db/prisma.js'
import { formatUruguayHhMm, uruguayYmdOfInstant } from '../../config/app-timezone.js'
import { notifyUsers, type NotificationInput } from '../notifications/notify.js'

/**
 * Lista pasada fuera de hora.
 *
 * El docente puede pasar la lista hasta una semana después de la clase (`edit-window.ts`), pero
 * Dirección quiere enterarse cuando pasa: una lista pasada días después es menos confiable y es
 * algo para conversar con el docente. Se avisa sólo la primera vez que la lista queda tomada; las
 * correcciones posteriores no vuelven a avisar.
 */

export const LATE_ROLL_CALL_RECIPIENT_ROLES = ['DIRECCION'] as const

/**
 * ¿Hay que avisar? Sólo cuando quien la pasa es el docente de la clase (titular o suplente), es la
 * primera vez y la clase ya terminó. Administración corrigiendo una lista ajena no es "el docente
 * la pasó tarde": esa escritura ya queda auditada.
 */
export function shouldNotifyLateRollCall(params: {
  isAssignedTeacher: boolean
  wasTakenBefore: boolean
  occurrenceEndAt: Date
  now: Date
}): boolean {
  if (!params.isAssignedTeacher || params.wasTakenBefore) return false
  return params.now.getTime() > params.occurrenceEndAt.getTime()
}

function ddmm(ymd: string): string {
  const [, m, d] = ymd.split('-')
  return `${d}/${m}`
}

export function lateRollCallNotification(params: {
  subjectName: string | null
  groupLabel: string | null
  occurrenceYmd: string
  occurrenceStartAt: Date
  takenAt: Date
  teacherName: string | null
}): NotificationInput {
  const what = [params.subjectName, params.groupLabel].filter(Boolean).join(' · ') || 'una clase'
  const takenYmd = uruguayYmdOfInstant(params.takenAt)
  const takenWhen =
    takenYmd === params.occurrenceYmd
      ? `a las ${formatUruguayHhMm(params.takenAt)}`
      : `el ${ddmm(takenYmd)} a las ${formatUruguayHhMm(params.takenAt)}`
  return {
    type: 'ROLL_CALL_LATE',
    title: `Lista pasada fuera de hora: ${what}`,
    body: `Clase del ${ddmm(params.occurrenceYmd)} a las ${formatUruguayHhMm(params.occurrenceStartAt)}. ${
      params.teacherName ?? 'El docente'
    } la pasó ${takenWhen}.`,
    actionUrl: '/admin/student-attendance',
  }
}

/** Deja el aviso a Dirección. Nunca lanza: la lista ya quedó guardada y eso es lo que importa. */
export async function notifyLateRollCall(input: Parameters<typeof lateRollCallNotification>[0]): Promise<void> {
  try {
    const recipients = await prisma.user.findMany({
      where: { isActive: true, isApproved: true, orgRole: { code: { in: [...LATE_ROLL_CALL_RECIPIENT_ROLES] } } },
      select: { id: true },
    })
    await notifyUsers(
      recipients.map((user) => user.id),
      lateRollCallNotification(input),
    )
  } catch (error) {
    console.error('[student-attendance] aviso de lista fuera de hora:', error)
  }
}
