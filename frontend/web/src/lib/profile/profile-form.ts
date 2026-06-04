import { isValidLocalPhoneUY, normalizeLocalPhoneUY } from '@/lib/forms/uruguay-forms'
import { isValidRegisterEmail, REGISTER_USERNAME_REGEX } from '@/lib/auth/register-form-validation'

export function onlyDigits(v: string): string {
  return v.replace(/\D/g, '')
}

export function formatCI(input: string): string {
  const d = onlyDigits(input).slice(0, 8)
  if (d.length <= 1) return d
  if (d.length <= 4) return `${d[0]}.${d.slice(1)}`
  if (d.length <= 7) return `${d[0]}.${d.slice(1, 4)}.${d.slice(4)}`
  return `${d[0]}.${d.slice(1, 4)}.${d.slice(4, 7)}-${d.slice(7)}`
}

export function computeCI(base7: string): number {
  const w = [2, 9, 8, 7, 6, 3, 4]
  const p = base7.padStart(7, '0')
  const s = p.split('').map((d, i) => parseInt(d, 10) * w[i]).reduce((a, b) => a + b, 0)
  return (10 - (s % 10)) % 10
}

export function validCI(input: string): boolean {
  const d = onlyDigits(input)
  if (d.length < 7 || d.length > 8) return false
  const b = d.slice(0, -1)
  return computeCI(b) === parseInt(d.slice(-1), 10)
}

/** @deprecated usar normalizeLocalPhoneUY de uruguay-forms */
export function normLocalPhoneUY(local: string): string {
  return normalizeLocalPhoneUY(local)
}

export function isValidLocalPhone(local: string): boolean {
  return isValidLocalPhoneUY(local)
}

export function canEditNationalId(role?: string): boolean {
  return role === 'ADMIN'
}

export { isStrongPassword, STRONG_PASSWORD_MESSAGE } from '@/lib/auth/password-strength'

export function getProfileErrorMessage(error: unknown): string {
  const message = String((error as { message?: string })?.message || '')
  if (message.includes('409')) return 'Usuario, correo o cédula ya registrados'
  if (message.includes('403')) return 'No tienes permisos para cambiar cédula/rol'
  return 'Error al guardar'
}

export function getPasswordErrorMessage(error: unknown): string {
  const message = String((error as { message?: string })?.message || '')
  if (message.includes('401')) return 'Contraseña actual incorrecta'
  if (message.includes('mayúscula') && message.includes('minúscula')) return message
  return 'No se pudo actualizar la contraseña'
}

export function buildProfilePayload(params: {
  email: string
  username: string
  firstName: string
  lastName: string
  phoneLocal: string
  birthdate: string
  nationalId: string
  isAdmin: boolean
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    email: params.email.trim().toLowerCase(),
    username: params.username,
    firstName: params.firstName,
    lastName: params.lastName,
    phone: params.phoneLocal ? `+598${normalizeLocalPhoneUY(params.phoneLocal)}` : undefined,
    birthdate: params.birthdate ? new Date(params.birthdate).toISOString() : undefined,
  }
  if (params.isAdmin) {
    payload.nationalId = params.nationalId
  }
  return payload
}

export function validateProfileForm(params: {
  email: string
  username: string
  nationalId: string
  firstName: string
  lastName: string
  phoneLocal: string
  canEditCi: boolean
}): string | null {
  if (!isValidRegisterEmail(params.email)) return 'Correo inválido'
  if (!REGISTER_USERNAME_REGEX.test(params.username)) return 'Usuario inválido'
  if (params.canEditCi && !validCI(params.nationalId)) return 'Cédula inválida'
  if (!params.firstName.trim() || !params.lastName.trim()) return 'Nombre y apellido obligatorios'
  if (params.phoneLocal && !isValidLocalPhoneUY(params.phoneLocal)) {
    return 'Celular inválido. Ingresá 9 dígitos empezando con 09.'
  }
  return null
}
