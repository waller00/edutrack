import { prisma } from '../db/prisma.js'
import { sniffImageMime, STUDENT_PHOTO_MAX_BYTES } from './student-photo.js'

/**
 * Nombre y logo de la institución, los que encabezan el boletín.
 *
 * Se cargan desde Configuración y no del código: el mismo EduTrack sirve a cualquier liceo. El logo
 * sólo puede ser PNG o JPEG porque es lo que pdfkit sabe dibujar, y como no hay librería de imágenes
 * para re-codificarlo, la defensa es la misma que la de la foto del alumno: firma binaria y tope.
 */

const BRANDING_ID = 'default'

export const INSTITUTION_LOGO_MAX_BYTES = STUDENT_PHOTO_MAX_BYTES
export const INSTITUTION_LOGO_PARSER_LIMIT = '1500kb'
export const INSTITUTION_LOGO_MIMES = ['image/png', 'image/jpeg'] as const

export type InstitutionLogoMime = (typeof INSTITUTION_LOGO_MIMES)[number]

export type LogoRejection = 'EMPTY' | 'TOO_LARGE' | 'UNSUPPORTED_TYPE' | 'MIME_MISMATCH'

const isLogoMime = (value: string): value is InstitutionLogoMime =>
  (INSTITUTION_LOGO_MIMES as readonly string[]).includes(value)

/** `code === null` es que pasó (resultado plano: el backend corre sin `strictNullChecks`). */
export function validateInstitutionLogo(
  buf: Buffer,
  declaredMime: string,
): { code: LogoRejection | null; mimeType: InstitutionLogoMime | null } {
  if (!buf || buf.length === 0) return { code: 'EMPTY', mimeType: null }
  if (buf.length > INSTITUTION_LOGO_MAX_BYTES) return { code: 'TOO_LARGE', mimeType: null }
  const declared = declaredMime.split(';')[0]?.trim().toLowerCase() ?? ''
  const actual = sniffImageMime(buf)
  if (!isLogoMime(declared) || actual === null || !isLogoMime(actual)) return { code: 'UNSUPPORTED_TYPE', mimeType: null }
  if (actual !== declared) return { code: 'MIME_MISMATCH', mimeType: null }
  return { code: null, mimeType: actual }
}

export function logoRejectionResponse(code: LogoRejection): { status: number; message: string } {
  if (code === 'TOO_LARGE') return { status: 413, message: 'El logo supera 1 MB. Probá con una imagen más chica.' }
  if (code === 'EMPTY') return { status: 400, message: 'El logo llegó vacío' }
  if (code === 'MIME_MISMATCH') return { status: 400, message: 'El archivo no es la imagen que dice ser' }
  return { status: 415, message: 'Formato no admitido: el logo tiene que ser PNG o JPEG' }
}

export type InstitutionBranding = { name: string | null; logo: Buffer | null }

/** Para dibujar el boletín: nombre y bytes del logo. Sin configurar, todo `null`. */
export async function loadInstitutionBranding(): Promise<InstitutionBranding> {
  const row = await prisma.institutionBranding.findUnique({
    where: { id: BRANDING_ID },
    select: { name: true, logoBytes: true },
  })
  return { name: row?.name?.trim() || null, logo: row?.logoBytes ? Buffer.from(row.logoBytes) : null }
}

export type InstitutionSettings = {
  name: string | null
  logo: { mimeType: string; byteSize: number; updatedAt: string } | null
}

/** Lo que muestra Configuración: el nombre y si hay logo, sin los bytes. */
export async function loadInstitutionSettings(): Promise<InstitutionSettings> {
  const row = await prisma.institutionBranding.findUnique({
    where: { id: BRANDING_ID },
    select: { name: true, logoMimeType: true, logoByteSize: true, updatedAt: true },
  })
  const hasLogo = row?.logoMimeType != null && row.logoByteSize != null
  return {
    name: row?.name ?? null,
    logo: hasLogo ? { mimeType: row.logoMimeType, byteSize: row.logoByteSize, updatedAt: row.updatedAt.toISOString() } : null,
  }
}

type BrandingPatch = {
  name?: string | null
  logoBytes?: Buffer | null
  logoMimeType?: string | null
  logoByteSize?: number | null
}

export async function saveInstitutionBranding(patch: BrandingPatch): Promise<void> {
  await prisma.institutionBranding.upsert({
    where: { id: BRANDING_ID },
    create: { id: BRANDING_ID, ...patch },
    update: patch,
  })
}

export async function loadInstitutionLogo(): Promise<{ bytes: Buffer; mimeType: string; byteSize: number; updatedAt: Date } | null> {
  const row = await prisma.institutionBranding.findUnique({
    where: { id: BRANDING_ID },
    select: { logoBytes: true, logoMimeType: true, logoByteSize: true, updatedAt: true },
  })
  if (!row?.logoBytes || !row.logoMimeType) return null
  return { bytes: Buffer.from(row.logoBytes), mimeType: row.logoMimeType, byteSize: row.logoByteSize ?? row.logoBytes.length, updatedAt: row.updatedAt }
}
