import { isValidUruguayanCI, isValidLocalPhoneUY } from '@/lib/forms/uruguay-forms'
import { isStrongPassword, STRONG_PASSWORD_MESSAGE } from '@/lib/auth/password-strength'

/** Letras, números, punto, guion. El guion al final evita regex inválida en `pattern` HTML (p. ej. flag `v`). */
export const REGISTER_USERNAME_PATTERN = '^[a-zA-Z0-9._-]{3,30}$'
export const REGISTER_USERNAME_REGEX = /^[a-zA-Z0-9._-]{3,30}$/

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
  return (
    field.message.includes('⚠️ Faltan apellidos') ||
    field.message.includes('⚠️ No se pudo extraer') ||
    field.message.includes('⚠️ No encontramos esa fecha') ||
    field.message.includes('⚠️ Vencimiento:') ||
    field.message.includes('⚠️ No pudimos determinar la fecha de vencimiento') ||
    field.message.includes('⚠️ No se pudo leer el vencimiento')
  )
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
}): string | null {
  if (!params.file) return 'missing-file'
  if (!params.file.type.startsWith('image/')) return '❌ Por favor, selecciona una imagen válida'
  if (params.file.size > 5 * 1024 * 1024) return '❌ La imagen es demasiado grande. Máximo 5MB'
  const m = validateRegisterIdentityBeforeVerification(params)
  if (m) return m
  return null
}

/** Para Didit/OCR (sin archivo): mismo requisito de campos declarados antes de verificar. */
export function validateRegisterIdentityBeforeVerification(params: {
  firstName: string
  lastName: string
  nationalId: string
  birthdate: string
}): string | null {
  if (!params.firstName || !params.lastName || !params.nationalId || !params.birthdate) {
    return 'Completá nombres, apellidos, cédula y fecha de nacimiento antes de verificar.'
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

/** Vencimiento validado solo en Didit (no se persiste en la cuenta). */
export function getRegisterDocumentExpiryVerificationError(
  verificationResults: RegisterVerificationResults | null,
): string | null {
  const entry = verificationResults?.verification?.nationalIdDocumentExpiresAt
  if (!entry) {
    return 'El vencimiento del DNI debe confirmarse con la verificación de identidad (Didit).'
  }
  const msg = String(entry.message || '')
  if (msg.includes('✗')) {
    return 'El documento aparece vencido; no podés crear la cuenta hasta renovar la cédula.'
  }
  if (msg.includes('⚠️ No pudimos determinar')) {
    return 'No pudimos confirmar el vencimiento del DNI con Didit. Volvé a verificar.'
  }
  if (msg.includes('✓')) return null
  const extracted = entry.extracted?.trim().slice(0, 10)
  if (extracted) {
    const d = new Date(extracted + 'T12:00:00')
    if (!Number.isNaN(d.getTime())) {
      const today = new Date()
      const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
      if (d.getTime() < startToday.getTime()) {
        return 'El documento aparece vencido; no podés crear la cuenta hasta renovar la cédula.'
      }
      return null
    }
  }
  return 'Confirmá el vencimiento del DNI con Didit antes de continuar.'
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
  verificationResults: RegisterVerificationResults | null
  /** Siempre Didit cuando el servidor expone esta opción. */
  identityVerificationMethod?: 'didit' | 'dni-photo' | null
  /** `true` si el servidor tiene Didit configurado (entonces solo verificación electrónica). */
  livenessCheckEnabled?: boolean
  livenessApproved?: boolean
  passwordRequired?: boolean
}): string | null {
  if (!isValidRegisterEmail(params.email)) return 'Correo inválido'
  if (params.passwordRequired !== false) {
    if (!isStrongPassword(params.password)) {
      return STRONG_PASSWORD_MESSAGE
    }
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
  if (!params.livenessCheckEnabled) {
    return 'Por ahora el registro completo no está disponible sin verificación en línea. Escribinos si necesitás ayuda.'
  }
  if (!params.verificationResults) return 'Debés confirmar tu identidad antes de crear la cuenta.'
  const expiryCap = getRegisterDocumentExpiryVerificationError(params.verificationResults)
  if (expiryCap) return expiryCap
  if (params.identityVerificationMethod !== 'didit') {
    return 'Debés confirmar tu identidad con el proceso indicado antes de crear la cuenta.'
  }
  if (!params.livenessApproved) {
    return 'Debés completar la verificación antes de crear la cuenta.'
  }
  return null
}
