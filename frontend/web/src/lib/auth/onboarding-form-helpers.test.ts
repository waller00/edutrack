import {
  getOnboardingUsernameStatusDisplay,
  getOnboardingVerificationFieldLabel,
  getOnboardingVerificationMessageClass,
  isOwnUsername,
  resolveOnboardingUsernameStatus,
} from '@/lib/auth/onboarding-form-helpers'

describe('getOnboardingUsernameStatusDisplay', () => {
  it('estados', () => {
    expect(getOnboardingUsernameStatusDisplay('idle')).toBeNull()
    expect(getOnboardingUsernameStatusDisplay('checking')?.text).toContain('Verificando')
    expect(getOnboardingUsernameStatusDisplay('ok')?.className).toContain('green')
    expect(getOnboardingUsernameStatusDisplay('taken')?.text).toContain('No disponible')
    expect(getOnboardingUsernameStatusDisplay('invalid')?.text).toBe('Inválido')
    expect(getOnboardingUsernameStatusDisplay('own')).toEqual({ text: 'Es tu usuario', className: 'text-green-600' })
  })
})

describe('isOwnUsername', () => {
  it('el de la cuenta, sin distinguir mayúsculas ni espacios', () => {
    expect(isOwnUsername('Ana.Garcia ', 'ana.garcia')).toBe(true)
    expect(isOwnUsername('ana.garcia2', 'ana.garcia')).toBe(false)
    expect(isOwnUsername('ana.garcia', null)).toBe(false)
    expect(isOwnUsername('ana.garcia', undefined)).toBe(false)
  })
})

describe('getOnboardingVerificationFieldLabel', () => {
  it('campos', () => {
    expect(getOnboardingVerificationFieldLabel('firstName')).toBe('Nombre')
    expect(getOnboardingVerificationFieldLabel('lastName')).toBe('Apellido')
    expect(getOnboardingVerificationFieldLabel('nationalId')).toBe('Cédula')
    expect(getOnboardingVerificationFieldLabel('birthdate')).toContain('nacimiento')
  })
})

describe('getOnboardingVerificationMessageClass', () => {
  it('✓ vs resto', () => {
    expect(getOnboardingVerificationMessageClass('✓ ok')).toContain('green')
    expect(getOnboardingVerificationMessageClass('error')).toContain('red')
  })
})

describe('resolveOnboardingUsernameStatus', () => {
  it('ramas', () => {
    expect(resolveOnboardingUsernameStatus(false, true)).toBe('invalid')
    expect(resolveOnboardingUsernameStatus(true, true)).toBe('ok')
    expect(resolveOnboardingUsernameStatus(true, false)).toBe('taken')
  })
})
