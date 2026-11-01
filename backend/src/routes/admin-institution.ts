import { Router, raw as expressRaw } from 'express'
import { AuditAction } from '@prisma/client'
import { z } from 'zod'
import { recordAuditEvent } from '../services/audit-log.js'
import { photoETag } from '../services/student-photo.js'
import {
  INSTITUTION_LOGO_MIMES,
  INSTITUTION_LOGO_PARSER_LIMIT,
  loadInstitutionLogo,
  loadInstitutionSettings,
  logoRejectionResponse,
  saveInstitutionBranding,
  validateInstitutionLogo,
} from '../services/institution-branding.js'

/**
 * Nombre y logo de la institución (Configuración → Institución). Encabezan el boletín.
 * Se monta bajo `/admin/institution` con `settings.manage`, igual que el resto de la configuración.
 */
const r = Router()

function audit(req: any, keysChanged: string[]) {
  recordAuditEvent({
    action: AuditAction.SYSTEM_SETTINGS_UPDATED,
    actorUserId: req.user?.id ?? null,
    req,
    entityType: 'InstitutionBranding',
    entityId: 'default',
    metadata: { keysChanged },
  })
}

r.get('/', async (_req, res) => {
  try {
    return res.json(await loadInstitutionSettings())
  } catch (error) {
    console.error('[admin/institution GET]', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

const nameSchema = z.object({ name: z.string().trim().max(120).nullable() })

r.put('/', async (req, res) => {
  const parsed = nameSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos', errors: parsed.error.errors })
  try {
    await saveInstitutionBranding({ name: parsed.data.name || null })
    audit(req, ['institutionName'])
    return res.json(await loadInstitutionSettings())
  } catch (error) {
    console.error('[admin/institution PUT]', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.get('/logo', async (req, res) => {
  try {
    const logo = await loadInstitutionLogo()
    if (!logo) return res.status(404).json({ message: 'La institución no tiene logo' })

    const etag = photoETag(logo.updatedAt, logo.byteSize)
    res.setHeader('ETag', etag)
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Disposition', 'inline')
    if (req.headers['if-none-match'] === etag) return res.status(304).end()

    res.setHeader('Content-Type', logo.mimeType)
    return res.send(logo.bytes)
  } catch (error) {
    console.error('[admin/institution/logo GET]', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

/** Binario, no base64: el `Content-Type` declarado se contrasta con la firma del archivo. */
const logoParser = expressRaw({ type: [...INSTITUTION_LOGO_MIMES], limit: INSTITUTION_LOGO_PARSER_LIMIT })

r.put('/logo', logoParser, async (req, res) => {
  // Si el Content-Type no matchea el parser, `req.body` no es un Buffer: es un tipo no admitido.
  if (!Buffer.isBuffer(req.body)) return res.status(415).json({ message: logoRejectionResponse('UNSUPPORTED_TYPE').message })
  const check = validateInstitutionLogo(req.body, String(req.headers['content-type'] ?? ''))
  if (check.code) {
    const { status, message } = logoRejectionResponse(check.code)
    return res.status(status).json({ message })
  }
  try {
    await saveInstitutionBranding({ logoBytes: req.body, logoMimeType: check.mimeType, logoByteSize: req.body.length })
    audit(req, ['institutionLogo'])
    return res.json(await loadInstitutionSettings())
  } catch (error) {
    console.error('[admin/institution/logo PUT]', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.delete('/logo', async (req, res) => {
  try {
    await saveInstitutionBranding({ logoBytes: null, logoMimeType: null, logoByteSize: null })
    audit(req, ['institutionLogo'])
    return res.json(await loadInstitutionSettings())
  } catch (error) {
    console.error('[admin/institution/logo DELETE]', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

/** Sin esto, el 413 del parser sale en HTML por el handler de Express y el cliente no lo entiende. */
r.use('/logo', (err: any, _req: any, res: any, next: any) => {
  if (err?.type === 'entity.too.large' || err?.status === 413) {
    return res.status(413).json({ message: logoRejectionResponse('TOO_LARGE').message })
  }
  return next(err)
})

export default r
