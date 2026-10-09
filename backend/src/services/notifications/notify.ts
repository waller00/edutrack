import { randomUUID } from 'node:crypto'
import type { InAppNotificationType, PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../db/prisma.js'
import { sendWebPushPayloadToUser } from '../webPush.js'

export type NotificationInput = {
  type: InAppNotificationType
  title: string
  body: string
  /** Pantalla a la que lleva el aviso, en el mismo sitio (`/libreta/…`). */
  actionUrl: string | null
}

/**
 * Manda el mismo aviso como push a cada usuario, sin esperar: los push van a servidores externos y
 * no pueden demorar la respuesta de quien originó el aviso. Cada aviso lleva una etiqueta propia,
 * así dos avisos seguidos no se pisan en el celular.
 */
export function pushToUsers(userIds: readonly string[], notification: NotificationInput): Promise<void> {
  const tag = `edutrack-${randomUUID()}`
  return Promise.allSettled(
    userIds.map((userId) =>
      sendWebPushPayloadToUser(userId, {
        title: notification.title,
        body: notification.body,
        url: notification.actionUrl ?? '/',
        tag,
      }),
    ),
  ).then((results) => {
    for (const result of results) {
      if (result.status === 'rejected') console.error('[notify] push:', result.reason)
    }
  })
}

/**
 * Avisa a usuarios: deja el aviso en la campana y, salvo `push: false`, lo manda al celular o al
 * navegador de quienes activaron las notificaciones.
 *
 * Nunca rompe la acción que lo originó: un aviso que no sale queda en el log y nada más. Devuelve
 * cuántos avisos quedaron en la campana.
 */
export async function notifyUsers(
  userIds: readonly (string | null | undefined)[],
  notification: NotificationInput,
  options: { push?: boolean; db?: PrismaClient } = {},
): Promise<number> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))]
  if (ids.length === 0) return 0
  const db = options.db ?? defaultPrisma

  let created = 0
  try {
    const result = await db.inAppNotification.createMany({
      data: ids.map((userId) => ({
        userId,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        actionUrl: notification.actionUrl,
      })),
    })
    created = result.count
  } catch (error) {
    console.error('[notify] aviso en la campana:', error)
  }

  if (options.push !== false) void pushToUsers(ids, notification)
  return created
}
