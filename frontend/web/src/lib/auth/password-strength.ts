/**
 * Misma regla que `backend/src/password-policy.ts` (mantener alineadas).
 */
const STRONG_PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/
export const PASSWORD_MAX_LENGTH = 64

export const STRONG_PASSWORD_MESSAGE =
  'La contraseña debe tener al menos 8 caracteres, una mayúscula, una minúscula y un número'
export const PASSWORD_TOO_LONG_MESSAGE = 'La contraseña no puede superar los 64 caracteres'

export function isStrongPassword(pw: string): boolean {
  return pw.length <= PASSWORD_MAX_LENGTH && STRONG_PASSWORD_RE.test(pw)
}

export function validateNewPassword(pw: string): string | null {
  if (pw.length > PASSWORD_MAX_LENGTH) return PASSWORD_TOO_LONG_MESSAGE
  if (!isStrongPassword(pw)) return STRONG_PASSWORD_MESSAGE
  return null
}

export function getPasswordStrength(password: string) {
  if (password.length === 0) return 0
  return isStrongPassword(password) ? 100 : Math.min(75, password.length * 8)
}

export function getStrengthBarClass(strength: number) {
  if (strength > 80) return 'bg-emerald-500'
  if (strength > 50) return 'bg-yellow-500'
  return 'bg-red-500'
}
