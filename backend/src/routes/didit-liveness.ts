import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../prisma.js'
import { getOrCreateSystemSettings, isDiditConfigured } from '../system-settings.js'

const r = Router()

const DIDIT_SESSION_URL = 'https://verification.didit.me/v3/session/'

const LIVENESS_TTL_MS = 24 * 60 * 60 * 1000

/** Rate limit simple por IP (sesiones Didit anónimas). */
type Rl = { t: number; c: number }
const rl = new Map<string, Rl>()
function rateKey(ip: string) {
  return `didit:${ip || 'x'}`
}
function allowDiditCreate(ip: string) {
  const w = 15 * 60 * 1000
  const max = 8
  const k = rateKey(ip)
  const n = Date.now()
  const cur = rl.get(k)
  if (!cur || n - cur.t > w) {
    rl.set(k, { t: n, c: 1 })
    return true
  }
  if (cur.c >= max) return false
  cur.c += 1
  return true
}

r.post('/didit/liveness-session', async (req, res) => {
  const settings = await getOrCreateSystemSettings()
  if (!settings.livenessCheckEnabled) {
    return res.status(400).json({ message: 'La prueba de vida no está habilitada en el sistema.' })
  }
  if (!isDiditConfigured()) {
    return res.status(503).json({ message: 'Didit no está configurado en el servidor.' })
  }
  const ip = String((req as any).ip || req.socket?.remoteAddress || '')
  if (!allowDiditCreate(ip)) {
    return res.status(429).json({ message: 'Demasiados intentos. Probá de nuevo en unos minutos.' })
  }
  const parsed = z
    .object({ email: z.string().email().optional() })
    .safeParse(req.body || {})
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos inválidos' })
  }
  const email = parsed.data.email?.trim().toLowerCase() || null
  const front = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '')
  const callback = `${front}/register?liveness=1`
  const apiKey = process.env.DIDIT_API_KEY!.trim()
  const workflowId = process.env.DIDIT_WORKFLOW_ID!.trim()
  const expiresAt = new Date(Date.now() + LIVENESS_TTL_MS)
  const row = await prisma.livenessSession.create({
    data: {
      expiresAt,
      status: 'PENDING',
      email: email || undefined,
    },
  })
  let didit: any
  try {
    const dr = await fetch(DIDIT_SESSION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({
        workflow_id: workflowId,
        callback,
        vendor_data: row.id,
        contact_details: email
          ? { email, email_lang: 'es', send_notification_emails: false }
          : undefined,
      }),
    })
    const text = await dr.text()
    didit = text ? JSON.parse(text) : {}
    if (!dr.ok) {
      console.error('[Didit] create session', dr.status, text)
      await prisma.livenessSession
        .update({ where: { id: row.id }, data: { status: 'ERROR', diditStatusRaw: `http_${dr.status}` } })
        .catch(() => {})
      return res.status(502).json({ message: 'No se pudo iniciar la verificación con Didit. Reintentá luego.' })
    }
  } catch (e) {
    console.error('[Didit] fetch', e)
    await prisma.livenessSession
      .update({ where: { id: row.id }, data: { status: 'ERROR', diditStatusRaw: 'fetch_error' } })
      .catch(() => {})
    return res.status(502).json({ message: 'Error de conexión con Didit.' })
  }
  const diditSessionId = typeof didit.session_id === 'string' ? didit.session_id : null
  const verificationUrl = typeof didit.verification_url === 'string' ? didit.verification_url : null
  if (!diditSessionId || !verificationUrl) {
    await prisma.livenessSession
      .update({ where: { id: row.id }, data: { status: 'ERROR', diditStatusRaw: 'bad_response' } })
      .catch(() => {})
    return res.status(502).json({ message: 'Respuesta inválida de Didit.' })
  }
  await prisma.livenessSession.update({
    where: { id: row.id },
    data: { diditSessionId, diditStatusRaw: 'created' },
  })
  return res.json({
    livenessToken: row.id,
    verificationUrl,
    diditSessionId,
  })
})

r.get('/liveness/status', async (req, res) => {
  const token = z.string().uuid().safeParse(String((req.query as { token?: string }).token || '').trim())
  if (!token.success) {
    return res.status(400).json({ message: 'Token inválido' })
  }
  const s = await prisma.livenessSession.findUnique({ where: { id: token.data } })
  if (!s) {
    return res.status(404).json({ message: 'Sesión no encontrada' })
  }
  const expired = s.expiresAt < new Date() && s.status !== 'APPROVED'
  return res.json({
    status: s.status,
    approved: s.status === 'APPROVED' && !s.consumedAt,
    consumed: Boolean(s.consumedAt),
    expired,
  })
})

export default r
