import { Router, type Response } from 'express'
import { z } from 'zod'
import { authGuard, requirePermission } from '../middlewares/auth.js'
import { hitRateLimit } from '../middlewares/rate-limit.js'
import { decodeCursor } from './in-app-notifications.js'
import {
  MESSAGING_PERMISSION,
  MessagingError,
  conversationHeader,
  getOrCreateDirectConversation,
  listConversations,
  listMessages,
  markConversationRead,
  messagingSummary,
  searchContacts,
  sendMessage,
  setConversationStarred,
} from '../services/messaging/conversations.js'

/**
 * Mensajería interna entre el personal (`/messages`). Cada ruta trabaja sobre las conversaciones de
 * quien está en la sesión: no hay forma, ni para Administración, de leer conversaciones ajenas.
 */
const r = Router()
r.use(authGuard, requirePermission(MESSAGING_PERMISSION))

/** Por persona y no por IP: varios docentes comparten la red del liceo. */
const SEND_LIMIT = { bucket: 'messages-send', max: 30, windowSeconds: 60 }

const searchSchema = z.object({ q: z.string().max(80).optional().default('') })
const startSchema = z.object({ userId: z.string().uuid() })
const messagesQuerySchema = z.object({
  before: z.string().max(200).optional(),
  after: z.string().max(200).optional(),
  take: z.coerce.number().int().min(1).max(100).optional(),
})
const sendSchema = z.object({ body: z.string().trim().min(1, 'Escribí un mensaje.').max(4000, 'El mensaje es demasiado largo.') })
const starSchema = z.object({ starred: z.boolean() })
const idSchema = z.string().uuid()

function userIdOf(req: unknown): string {
  return String((req as { user?: { id?: string; sub?: string } }).user?.id ?? (req as { user?: { sub?: string } }).user?.sub ?? '')
}

function fail(res: Response, error: unknown, where: string) {
  if (error instanceof MessagingError) {
    return res.status(error.status).json({ code: error.code, message: error.message })
  }
  console.error(`[messages] ${where}:`, error)
  return res.status(500).json({ message: 'Error interno del servidor' })
}

/** Id de conversación válido; si no, 404 directo (no se consulta la base). */
function conversationIdOf(value: unknown, res: Response): string | null {
  const parsed = idSchema.safeParse(value)
  if (!parsed.success) {
    res.status(404).json({ code: 'CONVERSATION_NOT_FOUND', message: 'La conversación no existe.' })
    return null
  }
  return parsed.data
}

r.get('/summary', async (req, res) => {
  try {
    return res.json(await messagingSummary(userIdOf(req)))
  } catch (error) {
    return fail(res, error, 'summary')
  }
})

r.get('/contacts', async (req, res) => {
  const parsed = searchSchema.safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ message: 'Búsqueda inválida.' })
  try {
    return res.json({ data: await searchContacts(userIdOf(req), parsed.data.q) })
  } catch (error) {
    return fail(res, error, 'contacts')
  }
})

r.get('/conversations', async (req, res) => {
  const parsed = searchSchema.safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ message: 'Búsqueda inválida.' })
  try {
    return res.json({ data: await listConversations(userIdOf(req), parsed.data.q) })
  } catch (error) {
    return fail(res, error, 'conversations')
  }
})

r.post('/conversations', async (req, res) => {
  const parsed = startSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Elegí a quién escribirle.' })
  try {
    const id = await getOrCreateDirectConversation(userIdOf(req), parsed.data.userId)
    return res.status(201).json({ data: await conversationHeader(id, userIdOf(req)) })
  } catch (error) {
    return fail(res, error, 'start')
  }
})

r.get('/conversations/:id', async (req, res) => {
  const id = conversationIdOf(req.params.id, res)
  if (!id) return
  try {
    return res.json({ data: await conversationHeader(id, userIdOf(req)) })
  } catch (error) {
    return fail(res, error, 'header')
  }
})

r.get('/conversations/:id/messages', async (req, res) => {
  const id = conversationIdOf(req.params.id, res)
  if (!id) return
  const parsed = messagesQuerySchema.safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ message: 'Parámetros inválidos.' })
  try {
    const result = await listMessages(id, userIdOf(req), {
      before: decodeCursor(parsed.data.before),
      after: decodeCursor(parsed.data.after),
      take: parsed.data.take,
    })
    return res.json(result)
  } catch (error) {
    return fail(res, error, 'messages')
  }
})

r.post('/conversations/:id/messages', async (req, res) => {
  const id = conversationIdOf(req.params.id, res)
  if (!id) return
  const parsed = sendSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? 'Mensaje inválido.' })
  const userId = userIdOf(req)
  const hit = await hitRateLimit(SEND_LIMIT, userId)
  if (hit.limited) {
    res.setHeader('Retry-After', String(hit.retryAfterSeconds))
    return res.status(429).json({ message: 'Estás mandando muchos mensajes seguidos. Esperá un momento.' })
  }
  try {
    return res.status(201).json({ data: await sendMessage(id, userId, parsed.data.body) })
  } catch (error) {
    return fail(res, error, 'send')
  }
})

r.post('/conversations/:id/read', async (req, res) => {
  const id = conversationIdOf(req.params.id, res)
  if (!id) return
  try {
    await markConversationRead(id, userIdOf(req))
    return res.json({ ok: true })
  } catch (error) {
    return fail(res, error, 'read')
  }
})

r.put('/conversations/:id/star', async (req, res) => {
  const id = conversationIdOf(req.params.id, res)
  if (!id) return
  const parsed = starSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos.' })
  try {
    await setConversationStarred(id, userIdOf(req), parsed.data.starred)
    return res.json({ ok: true, starred: parsed.data.starred })
  } catch (error) {
    return fail(res, error, 'star')
  }
})

export default r
