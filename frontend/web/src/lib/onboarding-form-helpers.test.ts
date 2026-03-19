import {
  getOnboardingUsernameStatusDisplay,
  getOnboardingVerificationFieldLabel,
  getOnboardingVerificationMessageClass,
  resolveOnboardingUsernameStatus,
} from '@/lib/onboarding-form-helpers'

describe('getOnboardingUsernameStatusDisplay', () => {
  it('estados', () => {
    expect(getOnboardingUsernameStatusDisplay('idle')).toBeNull()
    expect(getOnboardingUsernameStatusDisplay('checking')?.text).toContain('Verificando')
    expect(getOnboardingUsernameStatusDisplay('ok')?.className).toContain('green')
    expect(getOnboardingUsernameStatusDisplay('taken')?.text).toContain('No disponible')
    expect(getOnboardingUsernameStatusDisplay('invalid')?.text).toBe('Inválido')
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
