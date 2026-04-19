import {
  onlyDigits,
  formatLocalMobileInputFromE164,
  formatUruguayanCI,
  isValidUruguayanCI,
  normalizeLocalPhoneUY,
  isValidLocalPhoneUY,
} from '@/lib/uruguay-forms'

describe('uruguay-forms', () => {
  it('removes non-digit characters', () => {
    expect(onlyDigits('4.123.456-7')).toBe('41234567')
  })

  it('formats uruguayan CI progressively', () => {
    expect(formatUruguayanCI('4')).toBe('4')
    expect(formatUruguayanCI('4123')).toBe('4.123')
    expect(formatUruguayanCI('4123456')).toBe('4.123.456')
    expect(formatUruguayanCI('41234567')).toBe('4.123.456-7')
  })

  it('validates a CI with correct check digit', () => {
    expect(isValidUruguayanCI('4.123.456-3')).toBe(true)
  })

  it('rejects invalid CI lengths and wrong check digit', () => {
    expect(isValidUruguayanCI('123')).toBe(false)
    expect(isValidUruguayanCI('4.123.456-7')).toBe(false)
  })

  it('normalizes local phone by stripping country-leading zero formatting', () => {
    expect(normalizeLocalPhoneUY('094 481 122')).toBe('94481122')
    expect(normalizeLocalPhoneUY('94481122')).toBe('94481122')
  })

  it('solo acepta celular 09… (9 dígitos)', () => {
    expect(isValidLocalPhoneUY('094481122')).toBe(true)
    expect(isValidLocalPhoneUY('94481122')).toBe(false)
    expect(isValidLocalPhoneUY('02471122')).toBe(false)
    expect(isValidLocalPhoneUY('12345')).toBe(false)
  })

  it('formatLocalMobileInputFromE164 arma 09… desde +598', () => {
    expect(formatLocalMobileInputFromE164('+59899123456')).toBe('099123456')
    expect(formatLocalMobileInputFromE164('')).toBe('')
  })

  it('rechaza 8 dígitos que son una cédula válida (no es teléfono)', () => {
    expect(isValidUruguayanCI('4.123.456-3')).toBe(true)
    expect(isValidLocalPhoneUY('41234563')).toBe(false)
    expect(isValidLocalPhoneUY('4.123.456-3')).toBe(false)
  })
})
