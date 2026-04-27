import crypto from 'crypto'

/**
 * Valida la firma HMAC del webhook de Didit (docs: x-signature-v2, x-timestamp, cuerpo raw JSON).
 */
export function verifyDiditWebhookSignature(
  body: Buffer,
  signatureHeader: string | undefined,
  timestampHeader: string | undefined,
  secret: string,
): { ok: true } | { ok: false; reason: string } {
  if (!secret) return { ok: false, reason: 'Falta DIDIT_WEBHOOK_SECRET' }
  if (!signatureHeader) return { ok: false, reason: 'Falta firma' }
  if (!timestampHeader) return { ok: false, reason: 'Falta timestamp' }
  const ts = Number.parseInt(String(timestampHeader), 10)
  if (!Number.isFinite(ts)) return { ok: false, reason: 'Timestamp inválido' }
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - ts) > 300) return { ok: false, reason: 'Solicitud demasiado antigua' }
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex')
  const sig = String(signatureHeader)
    .trim()
    .toLowerCase()
    .replace(/^sha256=/, '')
  if (expected.length !== sig.length) return { ok: false, reason: 'Firma incorrecta' }
  try {
    if (!crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(sig, 'utf8'))) {
      return { ok: false, reason: 'Firma incorrecta' }
    }
  } catch {
    return { ok: false, reason: 'Firma incorrecta' }
  }
  return { ok: true }
}
