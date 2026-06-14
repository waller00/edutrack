import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_INSTITUTION_TIMEZONE,
  getInstitutionTimezone,
  isValidInstitutionTimezone,
  normalizeInstitutionTimezone,
  resetInstitutionTimezoneForTests,
  setInstitutionTimezoneForTests,
} from './institution-timezone.js'

describe('institution-timezone', () => {
  afterEach(() => {
    resetInstitutionTimezoneForTests()
  })

  it('normaliza zonas válidas e inválidas', () => {
    expect(normalizeInstitutionTimezone('America/Santiago')).toBe('America/Santiago')
    expect(normalizeInstitutionTimezone('  America/Lima  ')).toBe('America/Lima')
    expect(normalizeInstitutionTimezone('No/Existe')).toBe(DEFAULT_INSTITUTION_TIMEZONE)
    expect(normalizeInstitutionTimezone('')).toBe(DEFAULT_INSTITUTION_TIMEZONE)
  })

  it('valida zonas IANA reconocidas', () => {
    expect(isValidInstitutionTimezone('America/Montevideo')).toBe(true)
    expect(isValidInstitutionTimezone('UTC')).toBe(true)
    expect(isValidInstitutionTimezone('Invalid/Zone')).toBe(false)
  })

  it('setInstitutionTimezoneForTests actualiza la caché en memoria', () => {
    setInstitutionTimezoneForTests('America/Argentina/Buenos_Aires')
    expect(getInstitutionTimezone()).toBe('America/Argentina/Buenos_Aires')
  })
})
