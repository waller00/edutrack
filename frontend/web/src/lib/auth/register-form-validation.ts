import { isValidUruguayanCI, isValidLocalPhoneUY } from '@/lib/forms/uruguay-forms'
import { validateNewPassword } from '@/lib/auth/password-strength'

/** Letras, números, punto, guion. El guion al final evita regex inválida en `pattern` HTML (p. ej. flag `v`). */
export const REGISTER_USERNAME_PATTERN = '^[a-zA-Z0-9._-]{3,30}$'
export const REGISTER_USERNAME_REGEX = /^[a-zA-Z0-9._-]{3,30}$/

export type RegisterRole = 'STAFF' | 'TEACHER' | ''
export type RegisterUsernameStatus = 'idle' | 'checking' | 'ok' | 'taken' | 'invalid'

export function isValidRegisterEmail(email: string): boolean {
  const trimmed = email.trim()
  if (!trimmed || /\s/.test(trimmed)) return false

  const atIndex = trimmed.indexOf('@')
  if (atIndex <= 0 || atIndex !== trimmed.lastIndexOf('@') || atIndex === trimmed.length - 1) return false

  const localPart = trimmed.slice(0, atIndex)
  const domain = trimmed.slice(atIndex + 1)
  if (!localPart || !domain || domain.startsWith('.') || domain.endsWith('.')) return false

  const labels = domain.split('.')
  if (labels.length < 2 || labels.some((label) => label.length === 0)) return false

  return true
}

export function resolveRegisterUsernameStatus(valid: boolean, available: boolean): RegisterUsernameStatus {
  if (!valid) return 'invalid'
  return available ? 'ok' : 'taken'
}

export function getRegisterBirthdateValidationError(birthdate: string): string | null {
  if (!birthdate) return 'Fecha de nacimiento obligatoria'
  const bd = new Date(birthdate)
  const today = new Date()
  if (bd > today) return 'La fecha de nacimiento no puede ser futura'
  const minAgeYears = 5
  const age =
    today.getFullYear() -
    bd.getFullYear() -
    (today < new Date(today.getFullYear(), bd.getMonth(), bd.getDate()) ? 1 : 0)
  if (age < minAgeYears) return `La edad mínima es ${minAgeYears} años`
  return null
}

export function getRegisterIdentityValidationError(params: {
  nationalId: string
  firstName: string
  lastName: string
  role: RegisterRole
}): string | null {
  if (!isValidUruguayanCI(params.nationalId)) return 'Cédula uruguaya inválida'
  if (params.firstName.trim().length === 0 || params.lastName.trim().length === 0) {
    return 'Nombres y apellidos son obligatorios'
  }
  if (!params.role) return 'Debes seleccionar un perfil'
  return null
}

export function validateRegisterForm(params: {
  email: string
  password: string
  confirm: string
  nationalId: string
  firstName: string
  lastName: string
  role: RegisterRole
  phoneLocal: string
  birthdate: string
  passwordRequired?: boolean
}): string | null {
  if (!isValidRegisterEmail(params.email)) return 'Correo inválido'
  if (params.passwordRequired !== false) {
    const passwordError = validateNewPassword(params.password)
    if (passwordError) return passwordError
    if (params.password !== params.confirm) return 'Las contraseñas no coinciden'
  }
  const identityError = getRegisterIdentityValidationError(params)
  if (identityError) return identityError
  if (params.phoneLocal) {
    if (isValidUruguayanCI(params.phoneLocal)) {
      return 'No podés usar la cédula como celular. Ingresá 9 dígitos empezando con 09 (ej. 094481122), sin el +598.'
    }
    if (!isValidLocalPhoneUY(params.phoneLocal)) {
      return 'Celular inválido. Ingresá 9 dígitos empezando con 09 (ej. 094481122), sin el +598.'
    }
  }
  const birthdateError = getRegisterBirthdateValidationError(params.birthdate)
  if (birthdateError) return birthdateError
  // Sin verificación en línea: la identidad la revisa administración al aprobar la cuenta.
  return null
}
