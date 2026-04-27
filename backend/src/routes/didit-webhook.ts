import type { Request, Response } from 'express'
import { prisma } from '../prisma.js'
import { verifyDiditWebhookSignature } from '../didit-signature.js'
import { diditStringToLivenessStatus } from '../didit-status.js'
import type { LivenessSessionStatus } from '@prisma/client'

function isTerminal(s: LivenessSessionStatus) {
  return s === 'APPROVED' || s === 'DECLINED' || s === 'ABANDONED' || s === 'EXPIRED' || s === 'ERROR'
}

/**
 * Webhook Didit. El cuerpo debe ser el buffer JSON sin parsear (ver app.ts).
 */
export default function diditWebhookHandler(req: Request, res: Response) {
  void (async () => {
    const secret = (process.env.DIDIT_WEBHOOK_SECRET || '').trim()
    if (!secret) {
      res.status(503).json({ error: 'Webhook no configurado' })
      return
    }
    const buf = req.body as Buffer
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
      res.status(400).json({ error: 'Cuerpo vacío' })
      return
    }
    const signature = String(req.headers['x-signature-v2'] || req.headers['x-signature'] || '')
    const timestamp = String(req.headers['x-timestamp'] || req.headers['x-timestamp-v2'] || '')
    const v = verifyDiditWebhookSignature(buf, signature, timestamp, secret)
    if (v.ok === false) {
      console.warn('[Didit webhook] firma:', v.reason)
      res.status(401).json({ error: v.reason })
      return
    }
    let body: {
      session_id?: string
      status?: string
      vendor_data?: string
      decision?: { status?: string }
    }
    try {
      body = JSON.parse(buf.toString('utf8'))
    } catch {
      res.status(400).json({ error: 'JSON inválido' })
      return
    }
    const sessionId = typeof body.session_id === 'string' ? body.session_id : ''
    const vendor = typeof body.vendor_data === 'string' ? body.vendor_data : ''
    const raw = body.status || body.decision?.status
    const incoming = diditStringToLivenessStatus(raw)
    if (!sessionId && !vendor) {
      res.json({ received: true })
      return
    }
    const or: ({ id: string } | { diditSessionId: string })[] = []
    if (vendor) or.push({ id: vendor })
    if (sessionId) or.push({ diditSessionId: sessionId })
    const found = await prisma.livenessSession.findFirst({ where: { OR: or } })
    if (!found) {
      console.warn('[Didit webhook] sesión desconocida', { sessionId, vendor: vendor ? `${vendor.slice(0, 8)}…` : '' })
      res.json({ received: true })
      return
    }
    let merged: LivenessSessionStatus = incoming
    if (found.status === 'APPROVED') {
      merged = 'APPROVED'
    } else if (incoming === 'PENDING' && isTerminal(found.status)) {
      merged = found.status
    }
    await prisma.livenessSession.update({
      where: { id: found.id },
      data: {
        status: merged,
        diditStatusRaw: raw || found.diditStatusRaw,
      },
    })
    res.json({ received: true })
  })().catch((e) => {
    console.error('[Didit webhook]', e)
    res.status(500).json({ error: 'Error interno' })
  })
}
