import { isValidUruguayanCI, isValidLocalPhoneUY } from '@/lib/forms/uruguay-forms'
import { validateNewPassword } from '@/lib/auth/password-strength'
import {
  getRegisterBirthdateValidationError,
  isValidRegisterEmail,
  type RegisterRole,
} from '@/lib/auth/register-form-validation'

/**
 * Validación campo por campo del paso de datos, pensada para correr en cada tecla.
 *
 * `validateRegisterForm` sigue siendo la validación de corte (devuelve un único error para
 * bloquear el envío); esto es su contraparte por campo, para mostrar el error al lado del
 * input en vez de un cartel al final del formulario.
 */

export type RegisterFieldName =
  | 'email'
  | 'password'
  | 'confirm'
  | 'nationalId'
  | 'firstName'
  | 'lastName'
  | 'phoneLocal'
  | 'birthdate'
  | 'role'

export type RegisterFieldValues = {
  email: string
  password: string
  confirm: string
  nationalId: string
  firstName: string
  lastName: string
  phoneLocal: string
  birthdate: string
  role: RegisterRole
}

export type RegisterFieldErrors = Partial<Record<RegisterFieldName, string>>

/** Campos que el usuario debe completar sí o sí (el celular es opcional). */
export const REGISTER_REQUIRED_FIELDS: RegisterFieldName[] = [
  'email',
  'password',
  'confirm',
  'nationalId',
  'firstName',
  'lastName',
  'birthdate',
  'role',
]

export const REGISTER_FIELD_LABELS: Record<RegisterFieldName, string> = {
  email: 'Correo',
  password: 'Contraseña',
  confirm: 'Confirmar contraseña',
  nationalId: 'Cédula',
  firstName: 'Nombres',
  lastName: 'Apellidos',
  phoneLocal: 'Celular',
  birthdate: 'Fecha de nacimiento',
  role: 'Perfil',
}

function validateName(value: string, label: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed) return `${label} es obligatorio`
  if (trimmed.length < 2) return `${label} debe tener al menos 2 caracteres`
  if (!/^[\p{L}\p{M}\s'.-]+$/u.test(trimmed)) return `${label} solo admite letras`
  return undefined
}

function validateEmailField(value: string): string | undefined {
  if (!value.trim()) return 'El correo es obligatorio'
  if (!isValidRegisterEmail(value)) return 'Correo inválido (ej. nombre@dominio.com)'
  return undefined
}

function validatePasswordField(value: string, passwordRequired: boolean): string | undefined {
  if (!passwordRequired) return undefined
  if (!value) return 'La contraseña es obligatoria'
  return validateNewPassword(value) ?? undefined
}

function validateConfirmField(
  confirm: string,
  password: string,
  passwordRequired: boolean,
): string | undefined {
  if (!passwordRequired) return undefined
  if (!confirm) return 'Repetí la contraseña'
  if (confirm !== password) return 'Las contraseñas no coinciden'
  return undefined
}

function validateNationalIdField(value: string): string | undefined {
  if (!value.trim()) return 'La cédula es obligatoria'
  if (!isValidUruguayanCI(value)) return 'Cédula uruguaya inválida (revisá el dígito verificador)'
  return undefined
}

function validatePhoneField(value: string): string | undefined {
  if (!value.trim()) return undefined // opcional
  if (isValidUruguayanCI(value)) return 'Ese es tu número de cédula, no tu celular'
  if (!isValidLocalPhoneUY(value)) return 'Celular inválido: 9 dígitos empezando con 09 (ej. 094481122)'
  return undefined
}

/** Valida un único campo. Devuelve `undefined` cuando está bien. */
export function validateRegisterField(
  field: RegisterFieldName,
  values: RegisterFieldValues,
  options?: { passwordRequired?: boolean },
): string | undefined {
  const passwordRequired = options?.passwordRequired !== false

  switch (field) {
    case 'email':
      return validateEmailField(values.email)
    case 'password':
      return validatePasswordField(values.password, passwordRequired)
    case 'confirm':
      return validateConfirmField(values.confirm, values.password, passwordRequired)
    case 'nationalId':
      return validateNationalIdField(values.nationalId)
    case 'firstName':
      return validateName(values.firstName, 'Nombres')
    case 'lastName':
      return validateName(values.lastName, 'Apellidos')
    case 'phoneLocal':
      return validatePhoneField(values.phoneLocal)
    case 'birthdate':
      return getRegisterBirthdateValidationError(values.birthdate) ?? undefined
    case 'role':
      return values.role ? undefined : 'Elegí un perfil'
    default:
      return undefined
  }
}

/** Todos los errores del paso de datos, por campo. */
export function validateRegisterFields(
  values: RegisterFieldValues,
  options?: { passwordRequired?: boolean },
): RegisterFieldErrors {
  const fields: RegisterFieldName[] = [
    'email',
    'password',
    'confirm',
    'nationalId',
    'firstName',
    'lastName',
    'phoneLocal',
    'birthdate',
    'role',
  ]
  const errors: RegisterFieldErrors = {}
  for (const field of fields) {
    const error = validateRegisterField(field, values, options)
    if (error) errors[field] = error
  }
  return errors
}

/** `true` si el paso de datos está completo y puede avanzar a la verificación. */
export function isRegisterDataStepComplete(
  values: RegisterFieldValues,
  options?: { passwordRequired?: boolean },
): boolean {
  return Object.keys(validateRegisterFields(values, options)).length === 0
}
