/** `own`: el usuario que ya tiene la cuenta. Para el servidor está ocupado, pero por ella misma. */
export type OnboardingUsernameStatus = 'idle' | 'checking' | 'ok' | 'own' | 'taken' | 'invalid'

export function getOnboardingUsernameStatusDisplay(status: OnboardingUsernameStatus): {
  text: string
  className: string
} | null {
  switch (status) {
    case 'checking':
      return { text: 'Verificando...', className: 'text-gray-500' }
    case 'ok':
      return { text: 'Disponible', className: 'text-green-600' }
    case 'own':
      return { text: 'Es tu usuario', className: 'text-green-600' }
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
    case 'birthdate':
      return 'Fecha de nacimiento'
    case 'nationalIdDocumentExpiresAt':
      return 'Vencimiento del DNI'
    default:
      return field
  }
}

export function getOnboardingVerificationMessageClass(message: string): string {
  return String(message).includes('✓') ? 'text-green-600' : 'text-red-600'
}

export function resolveOnboardingUsernameStatus(valid: boolean, available: boolean): OnboardingUsernameStatus {
  if (!valid) return 'invalid'
  return available ? 'ok' : 'taken'
}

/** ¿Es el usuario que la cuenta ya tiene? Los usuarios no distinguen mayúsculas. */
export function isOwnUsername(candidate: string, current: string | null | undefined): boolean {
  return Boolean(current) && candidate.trim().toLowerCase() === String(current).trim().toLowerCase()
}
