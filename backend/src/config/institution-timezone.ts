import { DateTime } from 'luxon'
import { prisma } from '../db/prisma.js'

export const DEFAULT_INSTITUTION_TIMEZONE = 'America/Montevideo'

/**
 * Zonas que se pueden elegir. Sólo Uruguay: el frontend formatea y arma fechas con
 * `America/Montevideo` y `-03:00` fijos, así que otra zona dejaba al backend y a la pantalla en días
 * distintos (la lista "de hoy", los filtros por fecha, las fases del pase de lista). Agregar una zona
 * acá exige antes que el frontend tome la zona de la configuración.
 */
export const INSTITUTION_TIMEZONE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'America/Montevideo', label: 'Uruguay — Montevideo' },
]

/** ¿Se puede guardar? Válida para Luxon no alcanza: tiene que estar entre las opciones. */
export function isSupportedInstitutionTimezone(tz: string): boolean {
  return INSTITUTION_TIMEZONE_OPTIONS.some((option) => option.value === tz.trim())
}

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
