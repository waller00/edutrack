import { DateTime } from 'luxon'
import { prisma } from '../db/prisma.js'

export const DEFAULT_INSTITUTION_TIMEZONE = 'America/Montevideo'

/** Zonas IANA habituales para instituciones educativas en la región. */
export const INSTITUTION_TIMEZONE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'America/Montevideo', label: 'Uruguay — Montevideo' },
  { value: 'America/Argentina/Buenos_Aires', label: 'Argentina — Buenos Aires' },
  { value: 'America/Santiago', label: 'Chile — Santiago' },
  { value: 'America/Sao_Paulo', label: 'Brasil — São Paulo' },
  { value: 'America/Asuncion', label: 'Paraguay — Asunción' },
  { value: 'America/La_Paz', label: 'Bolivia — La Paz' },
  { value: 'America/Lima', label: 'Perú — Lima' },
  { value: 'America/Bogota', label: 'Colombia — Bogotá' },
  { value: 'America/Mexico_City', label: 'México — Ciudad de México' },
  { value: 'America/New_York', label: 'Estados Unidos — Nueva York (EST/EDT)' },
  { value: 'Europe/Madrid', label: 'España — Madrid' },
  { value: 'UTC', label: 'UTC' },
]

let cachedTimezone = DEFAULT_INSTITUTION_TIMEZONE

export function isValidInstitutionTimezone(tz: string): boolean {
  const trimmed = tz.trim()
  if (!trimmed) return false
  try {
    Intl.DateTimeFormat(undefined, { timeZone: trimmed })
  } catch {
    return false
  }
  const probe = DateTime.now().setZone(trimmed)
  return probe.isValid
}

export function normalizeInstitutionTimezone(tz: string | null | undefined): string {
  const trimmed = (tz ?? '').trim()
  if (trimmed && isValidInstitutionTimezone(trimmed)) return trimmed
  return DEFAULT_INSTITUTION_TIMEZONE
}

/** Zona horaria institucional en memoria (sincronizada desde SystemSettings). */
export function getInstitutionTimezone(): string {
  return cachedTimezone
}

export function applyInstitutionTimezoneFromSettings(row: { institutionTimezone?: string | null }): string {
  cachedTimezone = normalizeInstitutionTimezone(row.institutionTimezone)
  return cachedTimezone
}

export async function refreshInstitutionTimezoneCache(): Promise<string> {
  const row = await prisma.systemSettings.findUnique({ where: { id: 'default' } })
  if (!row) {
    cachedTimezone = DEFAULT_INSTITUTION_TIMEZONE
    return cachedTimezone
  }
  return applyInstitutionTimezoneFromSettings(row)
}

/** Para tests: restablece la caché sin tocar la base. */
export function setInstitutionTimezoneForTests(tz: string): void {
  cachedTimezone = normalizeInstitutionTimezone(tz)
}

export function resetInstitutionTimezoneForTests(): void {
  cachedTimezone = DEFAULT_INSTITUTION_TIMEZONE
}
