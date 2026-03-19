export type OnboardingUsernameStatus = 'idle' | 'checking' | 'ok' | 'taken' | 'invalid'

export function getOnboardingUsernameStatusDisplay(status: OnboardingUsernameStatus): {
  text: string
  className: string
} | null {
  switch (status) {
    case 'checking':
      return { text: 'Verificando...', className: 'text-gray-500' }
    case 'ok':
      return { text: 'Disponible', className: 'text-green-600' }
    case 'taken':
      return { text: 'No disponible', className: 'text-red-600' }
    case 'invalid':
      return { text: 'Inválido', className: 'text-red-600' }
    default:
      return null
  }
}

export function getOnboardingVerificationFieldLabel(field: string): string {
  switch (field) {
    case 'firstName':
      return 'Nombre'
    case 'lastName':
      return 'Apellido'
    case 'nationalId':
      return 'Cédula'
    default:
      return 'Fecha de nacimiento'
  }
}

export function getOnboardingVerificationMessageClass(message: string): string {
  return String(message).includes('✓') ? 'text-green-600' : 'text-red-600'
}

export function resolveOnboardingUsernameStatus(valid: boolean, available: boolean): OnboardingUsernameStatus {
  if (!valid) return 'invalid'
  return available ? 'ok' : 'taken'
}
