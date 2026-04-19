import { isValidUruguayanCI, isValidLocalPhoneUY } from '@/lib/uruguay-forms'
import { isStrongPassword, STRONG_PASSWORD_MESSAGE } from '@/lib/password-strength'

export type RegisterRole = 'STAFF' | 'TEACHER' | ''
export type RegisterUsernameStatus = 'idle' | 'checking' | 'ok' | 'taken' | 'invalid'

export type RegisterVerificationEntry = {
  provided: string
  extracted?: string
  message: string
}

export type RegisterVerificationResults = {
  verifiedFields: number
  totalFields: number
  verification: Record<string, RegisterVerificationEntry>
}

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

export function getRegisterVerificationMessageIcon(message: string): string {
  if (message.includes('✓')) return '✅'
  if (message.includes('✗')) return '❌'
  if (message.includes('⚠️')) return '⚠️'
  return '❓'
}

export function getRegisterVerificationMessageClass(message: string): string {
  if (message.includes('✓')) return 'text-green-600'
  if (message.includes('✗')) return 'text-red-600'
  if (message.includes('⚠️')) return 'text-orange-600'
  return 'text-yellow-600'
}

export function getRegisterVerificationFieldLabel(field: string): string {
  switch (field) {
    case 'firstName':
      return 'Nombre'
    case 'lastName':
      return 'Apellidos'
    case 'nationalId':
      return 'Cédula'
    case 'birthdate':
      return 'Fecha de Nacimiento'
    case 'nationalIdDocumentExpiresAt':
      return 'Vencimiento del DNI'
    default:
      return 'Fecha de Nacimiento'
  }
}

export function isWarningRegisterVerificationMessage(field: RegisterVerificationEntry): boolean {
  return field.message.includes('⚠️ Faltan apellidos') || field.message.includes('⚠️ No se pudo extraer')
}

export function resolveRegisterUsernameStatus(valid: boolean, available: boolean): RegisterUsernameStatus {
  if (!valid) return 'invalid'
  return available ? 'ok' : 'taken'
}

export function getRegisterDniProcessingErrorMessage(error: unknown): string {
  const message = String((error as { message?: string })?.message || '')
  if (message.includes('400')) return '❌ Formato de imagen no válido. Por favor, sube una imagen clara del DNI.'
  if (message.includes('500')) return '❌ Error del servidor. Por favor, intenta nuevamente.'
  return '❌ Error al procesar el DNI. Por favor, completa los campos manualmente.'
}

export function validateRegisterDniUploadInput(params: {
  file?: File
  firstName: string
  lastName: string
  nationalId: string
  birthdate: string
  nationalIdDocumentExpiresAt: string
}): string | null {
  if (!params.file) return 'missing-file'
  if (!params.file.type.startsWith('image/')) return '❌ Por favor, selecciona una imagen válida'
  if (params.file.size > 5 * 1024 * 1024) return '❌ La imagen es demasiado grande. Máximo 5MB'
  if (!params.firstName || !params.lastName || !params.nationalId || !params.birthdate || !params.nationalIdDocumentExpiresAt) {
    return '❌ Por favor, completa todos los campos manualmente antes de verificar con el DNI'
  }
  return null
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

export function getRegisterNationalIdDocumentExpiresAtValidationError(nationalIdDocumentExpiresAt: string): string | null {
  if (!nationalIdDocumentExpiresAt) return 'Indicá el vencimiento del DNI'
  const d = new Date(nationalIdDocumentExpiresAt)
  if (Number.isNaN(d.getTime())) return 'Fecha de vencimiento inválida'
  const y = d.getFullYear()
  if (y < 1950 || y > 2100) return 'Fecha de vencimiento fuera de rango'
  return null
}

export function getRegisterIdentityValidationError(params: {
  username: string
  usernameStatus: RegisterUsernameStatus
  nationalId: string
  firstName: string
  lastName: string
  role: RegisterRole
}): string | null {
  if (!/^[-a-zA-Z0-9_.]{3,30}$/.test(params.username)) {
    return 'Usuario inválido (3-30, letras, números, punto, guion)'
  }
  if (params.usernameStatus === 'taken') return 'Nombre de usuario no disponible'
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
  username: string
  usernameStatus: RegisterUsernameStatus
  nationalId: string
  firstName: string
  lastName: string
  role: RegisterRole
  phoneLocal: string
  birthdate: string
  nationalIdDocumentExpiresAt: string
  dniFile: File | null
  verificationResults: RegisterVerificationResults | null
}): string | null {
  if (!isValidRegisterEmail(params.email)) return 'Email inválido'
  if (!isStrongPassword(params.password)) {
    return STRONG_PASSWORD_MESSAGE
  }
  if (params.password !== params.confirm) return 'Las contraseñas no coinciden'
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
  const expiresError = getRegisterNationalIdDocumentExpiresAtValidationError(params.nationalIdDocumentExpiresAt)
  if (expiresError) return expiresError
  if (!params.dniFile || !params.verificationResults) return 'Debes verificar tu DNI antes de crear la cuenta'
  return null
}
