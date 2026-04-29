import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../prisma.js'
import { firstZodIssueMessage } from '../password-policy.js'
import { isDiditConfigured } from '../system-settings.js'
import { syncLivenessSessionFromDiditApi, fetchDiditDecisionJson } from '../didit-sync-session.js'
import { buildRegisterVerificationComparison } from '../didit-register-verification-from-decision.js'

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
  /** Didit suele exigir callback HTTPS. En local: ngrok + DIDIT_CALLBACK_URL=https://xxx.ngrok-free.app/register/didit-return?liveness=1 y en el front NEXT_PUBLIC_DIDIT_BROWSER_RETURN_URL=http://localhost:3000 para volver del túnel al registro en localhost. */
  const callback =
    (process.env.DIDIT_CALLBACK_URL || '').trim() || `${front}/register?liveness=1`
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
    let text: string
    try {
      text = await dr.text()
    } catch (readErr) {
      console.error('[Didit] respuesta text()', readErr)
      const readMsg = readErr instanceof Error ? readErr.message : String(readErr)
      await prisma.livenessSession
        .update({ where: { id: row.id }, data: { status: 'ERROR', diditStatusRaw: 'read_body_error' } })
        .catch(() => {})
      return res.status(502).json({
        message: 'No se pudo leer la respuesta del servidor de Didit.',
        details: readMsg,
      })
    }
    try {
      didit = text ? JSON.parse(text) : {}
    } catch {
      didit = { _raw: text?.slice(0, 500) }
    }
    if (!dr.ok) {
      const hint =
        typeof didit?.message === 'string'
          ? didit.message
          : typeof didit?.error === 'string'
            ? didit.error
            : text?.slice(0, 200)
      console.error('[Didit] create session', dr.status, text)
      await prisma.livenessSession
        .update({ where: { id: row.id }, data: { status: 'ERROR', diditStatusRaw: `http_${dr.status}` } })
        .catch(() => {})
      const baseMsg =
        dr.status === 403
          ? 'Didit respondió 403 (sin permiso). Revisá DIDIT_API_KEY, DIDIT_WORKFLOW_ID y la región del workspace en el panel de Didit.'
          : 'Didit rechazó la sesión. Revisá API key, workflow y que el callback sea HTTPS (ver DIDIT_CALLBACK_URL en .env).'
      return res.status(502).json({
        message: baseMsg,
        details: hint || undefined,
      })
    }
  } catch (e) {
    console.error('[Didit] fetch', e)
    const errDetail = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    await prisma.livenessSession
      .update({ where: { id: row.id }, data: { status: 'ERROR', diditStatusRaw: 'fetch_error' } })
      .catch(() => {})
    return res.status(502).json({
      message:
        'No se pudo conectar con el API de Didit. Si estás en Windows, probá reiniciar el backend tras el cambio de red/DNS; revisá firewall y que `verification.didit.me` sea accesible desde el servidor.',
      details: errDetail,
    })
  }
  const diditSessionId =
    typeof didit.session_id === 'string'
      ? didit.session_id
      : typeof didit.sessionId === 'string'
        ? didit.sessionId
        : null
  /** API Didit v3 devuelve `url`; algunas integraciones usan verification_url. */
  const verificationUrl =
    typeof didit.verification_url === 'string'
      ? didit.verification_url
      : typeof didit.verificationUrl === 'string'
        ? didit.verificationUrl
        : typeof didit.url === 'string'
          ? didit.url
          : null
  if (!diditSessionId || !verificationUrl) {
    const hint =
      typeof didit?.message === 'string'
        ? didit.message
        : typeof didit?.error === 'string'
          ? didit.error
          : JSON.stringify(didit).slice(0, 400)
    console.error('[Didit] respuesta sin session_id/verification_url', hint)
    await prisma.livenessSession
      .update({ where: { id: row.id }, data: { status: 'ERROR', diditStatusRaw: 'bad_response' } })
      .catch(() => {})
    return res.status(502).json({
      message:
        'Didit no devolvió enlace de verificación. Suele pasar si el callback no es HTTPS: definí DIDIT_CALLBACK_URL con una URL https (p. ej. ngrok) apuntando a /register?liveness=1.',
      details: hint,
    })
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

const registerFieldVerifyBody = z.object({
  /** Id interno (UUID Prisma), `didit_session_id` o valores que devuelve Didit en la redirect; no usar solo UUID RFC estricto. */
  livenessToken: z.string().trim().min(8).max(128),
  email: z.preprocess((v: unknown) => {
    if (v === '' || v === null || v === undefined) return undefined
    if (typeof v === 'string') {
      const t = v.trim()
      return t === '' ? undefined : t
    }
    return undefined
  }, z.string().email().optional()),
  firstName: z.string().trim().min(1, 'Nombre requerido'),
  lastName: z.string().trim().min(1, 'Apellidos requeridos'),
  nationalId: z.string().trim().min(1),
  birthdate: z.string().trim().min(4),
})

/**
 * Tras sesión APPROVED, cruza el JSON `/decision` de Didit con los datos declarados del formulario (misma idea que OCR paso a paso).
 */
r.post('/didit/register-field-verify', async (req, res) => {
  if (!isDiditConfigured()) {
    return res.status(503).json({ message: 'Didit no está configurado en el servidor.' })
  }
  const parsed = registerFieldVerifyBody.safeParse(req.body || {})
  if (!parsed.success) {
    return res.status(400).json({
      message: firstZodIssueMessage(parsed.error),
      issues: parsed.error.flatten(),
    })
  }

  let ls = await prisma.livenessSession.findFirst({
    where: {
      OR: [{ id: parsed.data.livenessToken }, { diditSessionId: parsed.data.livenessToken }],
    },
  })
  if (!ls) {
    return res.status(404).json({ message: 'Sesión no encontrada' })
  }
  const bodyEmail = parsed.data.email?.trim().toLowerCase()
  if (ls.email && bodyEmail && ls.email.toLowerCase() !== bodyEmail) {
    return res.status(400).json({ message: 'El email no coincide con la sesión de Didit.' })
  }

  if (ls.diditSessionId) {
    await syncLivenessSessionFromDiditApi(ls.id)
    const refetched = await prisma.livenessSession.findUnique({ where: { id: ls.id } })
    if (refetched) ls = refetched
  }

  const expired = ls.expiresAt < new Date() && ls.status !== 'APPROVED'
  if (expired) {
    return res.status(400).json({ message: 'La sesión de verificación venció. Iniciá una nueva.' })
  }

  if (ls.status !== 'APPROVED') {
    return res.status(400).json({
      message: 'La verificación biométrica aún no está aprobada.',
      status: ls.status,
    })
  }
  if (ls.consumedAt) {
    return res.status(400).json({ message: 'Esa sesión de Didit ya fue usada. Iniciá el registro de nuevo.' })
  }

  const diditId = ls.diditSessionId?.trim()
  if (!diditId) {
    return res.status(400).json({ message: 'Sesión incompleta: falta el id Didit.' })
  }

  const decision = await fetchDiditDecisionJson(diditId)
  if (!decision) {
    return res.status(502).json({ message: 'No se pudo leer la decisión de Didit. Reintentá en un momento.' })
  }

  const out = buildRegisterVerificationComparison(decision, {
    firstName: parsed.data.firstName,
    lastName: parsed.data.lastName,
    nationalId: parsed.data.nationalId,
    birthdate: parsed.data.birthdate,
  })

  return res.json({
    success: true,
    source: 'didit' as const,
    verifiedFields: out.verifiedFields,
    totalFields: out.totalFields,
    verification: out.verification,
  })
})

r.get('/liveness/status', async (req, res) => {
  const raw = String((req.query as { token?: string }).token || '').trim()
  const token = z.string().uuid().safeParse(raw)
  if (!token.success) {
    return res.status(400).json({ message: 'Token inválido' })
  }
  const id = token.data
  let s = await prisma.livenessSession.findFirst({
    where: { OR: [{ id }, { diditSessionId: id }] },
  })
  if (!s) {
    return res.status(404).json({ message: 'Sesión no encontrada' })
  }
  if (s.status !== 'APPROVED' && s.diditSessionId) {
    await syncLivenessSessionFromDiditApi(s.id)
    const refreshed = await prisma.livenessSession.findUnique({ where: { id: s.id } })
    if (!refreshed) {
      return res.status(404).json({ message: 'Sesión no encontrada' })
    }
    s = refreshed
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
