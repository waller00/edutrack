import { DateTime } from 'luxon'
import { prisma } from '../db/prisma.js'

export const DEFAULT_INSTITUTION_TIMEZONE = 'America/Montevideo'

/**
 * Zonas IANA ofrecidas en el selector. El offset GMT NO se incluye en el label porque
 * cambia con el horario de verano: el frontend lo calcula y lo muestra en vivo.
 */
export const INSTITUTION_TIMEZONE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'America/Montevideo', label: 'Uruguay — Montevideo' },
  { value: 'America/Argentina/Buenos_Aires', label: 'Argentina — Buenos Aires' },
  { value: 'America/Argentina/Cordoba', label: 'Argentina — Córdoba' },
  { value: 'America/Santiago', label: 'Chile — Santiago' },
  { value: 'America/Sao_Paulo', label: 'Brasil — São Paulo' },
  { value: 'America/Manaus', label: 'Brasil — Manaos' },
  { value: 'America/Asuncion', label: 'Paraguay — Asunción' },
  { value: 'America/La_Paz', label: 'Bolivia — La Paz' },
  { value: 'America/Lima', label: 'Perú — Lima' },
  { value: 'America/Bogota', label: 'Colombia — Bogotá' },
  { value: 'America/Caracas', label: 'Venezuela — Caracas' },
  { value: 'America/Guayaquil', label: 'Ecuador — Guayaquil' },
  { value: 'America/Mexico_City', label: 'México — Ciudad de México' },
  { value: 'America/Costa_Rica', label: 'Costa Rica — San José' },
  { value: 'America/Panama', label: 'Panamá — Panamá' },
  { value: 'America/Santo_Domingo', label: 'Rep. Dominicana — Santo Domingo' },
  { value: 'America/Havana', label: 'Cuba — La Habana' },
  { value: 'America/New_York', label: 'Estados Unidos — Nueva York (Este)' },
  { value: 'America/Chicago', label: 'Estados Unidos — Chicago (Central)' },
  { value: 'America/Denver', label: 'Estados Unidos — Denver (Montaña)' },
  { value: 'America/Los_Angeles', label: 'Estados Unidos — Los Ángeles (Pacífico)' },
  { value: 'Europe/Madrid', label: 'España — Madrid' },
  { value: 'Europe/London', label: 'Reino Unido — Londres' },
  { value: 'Europe/Paris', label: 'Francia — París' },
  { value: 'Europe/Rome', label: 'Italia — Roma' },
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
