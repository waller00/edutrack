import { Prisma } from '@prisma/client'
import { prisma } from '../../db/prisma.js'
import { sendWebPushPayloadToUser } from '../webPush.js'
import { displayNameOf, matchesSearch, messagePreview, pairKeyOf } from './text.js'

/**
 * Mensajería interna entre el personal: conversaciones 1 a 1, destacadas y no leídas. Las
 * observaciones de cada libreta (`GradeBookMessage`) son otra cosa y siguen allá.
 */

export const MESSAGING_PERMISSION = 'messaging.use'

/** Errores que la ruta traduce a un status. */
export class MessagingError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/** Quién puede recibir mensajes: cuenta habilitada y un perfil activo con el permiso. */
const MESSAGEABLE_USER: Prisma.UserWhereInput = {
  isActive: true,
  isApproved: true,
  orgRole: { active: true, grants: { some: { enabled: true, permission: { code: MESSAGING_PERMISSION } } } },
}

/** Lo único que se muestra de otro usuario: nada de correo, cédula ni teléfono. */
const CONTACT_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  name: true,
  orgRole: { select: { label: true } },
} as const

type ContactRow = Prisma.UserGetPayload<{ select: typeof CONTACT_SELECT }>

export type Contact = { id: string; name: string; roleLabel: string | null }

function toContact(user: ContactRow): Contact {
  return { id: user.id, name: displayNameOf(user), roleLabel: user.orgRole?.label ?? null }
}

/** Directorio para empezar una conversación. El personal de un liceo entra entero en memoria. */
export async function searchContacts(meId: string, query: string, take = 20): Promise<Contact[]> {
  const users = await prisma.user.findMany({
    where: { ...MESSAGEABLE_USER, id: { not: meId } },
    select: CONTACT_SELECT,
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    take: 1000,
  })
  return users.filter((user) => matchesSearch(user, query)).slice(0, take).map(toContact)
}

/** Busca o crea la conversación con otro usuario. El `pairKey` único evita duplicados aunque los dos escriban a la vez. */
export async function getOrCreateDirectConversation(meId: string, otherId: string): Promise<string> {
  if (otherId === meId) throw new MessagingError(400, 'SELF_CONVERSATION', 'No podés escribirte a vos mismo.')
  const other = await prisma.user.findFirst({ where: { ...MESSAGEABLE_USER, id: otherId }, select: { id: true } })
  if (!other) throw new MessagingError(409, 'CONTACT_UNAVAILABLE', 'Esa persona no puede recibir mensajes.')

  const conversation = await prisma.conversation.upsert({
    where: { pairKey: pairKeyOf(meId, otherId) },
    update: {},
    create: {
      pairKey: pairKeyOf(meId, otherId),
      members: { create: [{ userId: meId }, { userId: otherId }] },
    },
    select: { id: true },
  })
  return conversation.id
}

/** El usuario es miembro de la conversación; si no, 404 (no se revela que existe). */
async function requireMembership(conversationId: string, userId: string) {
  const member = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    select: { lastReadAt: true, starred: true },
  })
  if (!member) throw new MessagingError(404, 'CONVERSATION_NOT_FOUND', 'La conversación no existe.')
  return member
}

/** Mensajes ajenos sin leer, por conversación. Una sola consulta para toda la lista. */
async function unreadByConversation(userId: string): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<Array<{ conversationId: string; unread: number }>>`
    SELECT m."conversationId" AS "conversationId", COUNT(*)::int AS "unread"
    FROM "DirectMessage" m
    JOIN "ConversationMember" cm ON cm."conversationId" = m."conversationId" AND cm."userId" = ${userId}
    WHERE m."authorUserId" IS DISTINCT FROM ${userId}
      AND (cm."lastReadAt" IS NULL OR m."createdAt" > cm."lastReadAt")
    GROUP BY m."conversationId"`
  return new Map(rows.map((row) => [row.conversationId, Number(row.unread)]))
}

/** Lo que muestra el ícono del encabezado. Liviano: se consulta en el polling. */
export async function messagingSummary(userId: string) {
  const unread = await unreadByConversation(userId)
  let unreadMessages = 0
  for (const count of unread.values()) unreadMessages += count
  return { unreadConversations: unread.size, unreadMessages }
}

export type ConversationListItem = {
  id: string
  starred: boolean
  unread: number
  lastMessageAt: string
  other: Contact | null
  lastMessage: { preview: string; mine: boolean; createdAt: string } | null
}

/** Mis conversaciones, la más reciente primero. `query` filtra por el nombre del otro. */
export async function listConversations(userId: string, query = ''): Promise<ConversationListItem[]> {
  const [memberships, unread] = await Promise.all([
    prisma.conversationMember.findMany({
      where: { userId },
      select: {
        starred: true,
        conversation: {
          select: {
            id: true,
            lastMessageAt: true,
            members: { where: { userId: { not: userId } }, select: { user: { select: CONTACT_SELECT } } },
            messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { body: true, authorUserId: true, createdAt: true } },
          },
        },
      },
      orderBy: { conversation: { lastMessageAt: 'desc' } },
      take: 300,
    }),
    unreadByConversation(userId),
  ])

  return memberships
    .filter(({ conversation }) => {
      const other = conversation.members[0]?.user
      return !query.trim() || (other ? matchesSearch(other, query) : false)
    })
    .map(({ starred, conversation }) => {
      const otherUser = conversation.members[0]?.user
      const last = conversation.messages[0]
      return {
        id: conversation.id,
        starred,
        unread: unread.get(conversation.id) ?? 0,
        lastMessageAt: conversation.lastMessageAt.toISOString(),
        other: otherUser ? toContact(otherUser) : null,
        lastMessage: last
          ? { preview: messagePreview(last.body), mine: last.authorUserId === userId, createdAt: last.createdAt.toISOString() }
          : null,
      }
    })
}

/** La cabecera de una conversación: el otro y si la destaqué. */
export async function conversationHeader(conversationId: string, userId: string) {
  const member = await requireMembership(conversationId, userId)
  const other = await prisma.conversationMember.findFirst({
    where: { conversationId, userId: { not: userId } },
    select: { user: { select: CONTACT_SELECT } },
  })
  return { id: conversationId, starred: member.starred, other: other ? toContact(other.user) : null }
}

export type MessageItem = { id: string; body: string; createdAt: string; mine: boolean }

type Cursor = { createdAt: Date; id: string }

/**
 * Mensajes de la conversación, en orden cronológico.
 * - `before`: los anteriores a ese (botón "cargar anteriores").
 * - `after`: sólo los posteriores (el polling de la conversación abierta).
 * - sin ninguno: los últimos `take`.
 */
export async function listMessages(
  conversationId: string,
  userId: string,
  opts: { before?: Cursor | null; after?: Cursor | null; take?: number } = {},
): Promise<{ data: MessageItem[]; hasMore: boolean }> {
  await requireMembership(conversationId, userId)
  const take = Math.min(Math.max(opts.take ?? 30, 1), 100)

  if (opts.after) {
    const rows = await prisma.directMessage.findMany({
      where: {
        conversationId,
        OR: [
          { createdAt: { gt: opts.after.createdAt } },
          { createdAt: opts.after.createdAt, id: { gt: opts.after.id } },
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 100,
    })
    return { data: rows.map((row) => toMessage(row, userId)), hasMore: false }
  }

  const rows = await prisma.directMessage.findMany({
    where: {
      conversationId,
      ...(opts.before
        ? {
            OR: [
              { createdAt: { lt: opts.before.createdAt } },
              { createdAt: opts.before.createdAt, id: { lt: opts.before.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: take + 1,
  })
  const hasMore = rows.length > take
  return { data: rows.slice(0, take).reverse().map((row) => toMessage(row, userId)), hasMore }
}

function toMessage(row: { id: string; body: string; createdAt: Date; authorUserId: string | null }, userId: string): MessageItem {
  return { id: row.id, body: row.body, createdAt: row.createdAt.toISOString(), mine: row.authorUserId === userId }
}

/**
 * Manda un mensaje: lo guarda, mueve la conversación arriba, lo da por leído para quien lo escribió
 * y le avisa al otro por push (los mensajes no van a la campana: tienen su propio ícono).
 */
export async function sendMessage(conversationId: string, userId: string, body: string): Promise<MessageItem> {
  await requireMembership(conversationId, userId)
  const now = new Date()
  const [created] = await prisma.$transaction([
    prisma.directMessage.create({ data: { conversationId, authorUserId: userId, body, createdAt: now } }),
    prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: now } }),
    prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { lastReadAt: now },
    }),
  ])

  void notifyRecipients(conversationId, userId, body).catch((error) =>
    console.error('[messaging] push:', error),
  )
  return toMessage(created, userId)
}

async function notifyRecipients(conversationId: string, authorId: string, body: string) {
  const [author, recipients] = await Promise.all([
    prisma.user.findUnique({ where: { id: authorId }, select: { firstName: true, lastName: true, name: true } }),
    prisma.conversationMember.findMany({ where: { conversationId, userId: { not: authorId } }, select: { userId: true } }),
  ])
  const title = author ? displayNameOf(author) : 'Mensaje nuevo'
  await Promise.all(
    recipients.map(({ userId }) =>
      sendWebPushPayloadToUser(userId, {
        title,
        body: messagePreview(body, 140),
        url: `/mensajes?c=${conversationId}`,
        // Una por conversación: varios mensajes seguidos del mismo no apilan avisos.
        tag: `msg-${conversationId}`,
      }),
    ),
  )
}

/** Todo lo de la conversación queda leído para el usuario. */
export async function markConversationRead(conversationId: string, userId: string): Promise<void> {
  await requireMembership(conversationId, userId)
  await prisma.conversationMember.update({
    where: { conversationId_userId: { conversationId, userId } },
    data: { lastReadAt: new Date() },
  })
}

/** Destacar es de cada uno: el otro no se entera. */
export async function setConversationStarred(conversationId: string, userId: string, starred: boolean): Promise<void> {
  await requireMembership(conversationId, userId)
  await prisma.conversationMember.update({
    where: { conversationId_userId: { conversationId, userId } },
    data: { starred },
  })
}
