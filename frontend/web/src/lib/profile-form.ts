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

export function normLocalPhoneUY(local: string): string {
  const d = onlyDigits(local)
  if (!d) return ''
  return d.startsWith('0') ? d.slice(1) : d
}

export function isValidLocalPhone(local: string): boolean {
  return /^\d{8}$/.test(normLocalPhoneUY(local))
}

export function canEditNationalId(role?: string): boolean {
  return role === 'ADMIN'
}

export function isStrongPassword(password: string): boolean {
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(password)
}

export function getProfileErrorMessage(error: unknown): string {
  const message = String((error as { message?: string })?.message || '')
  if (message.includes('409')) return 'Usuario o cédula ya registrados'
  if (message.includes('403')) return 'No tienes permisos para cambiar cédula/rol'
  return 'Error al guardar'
}

export function getPasswordErrorMessage(error: unknown): string {
  const message = String((error as { message?: string })?.message || '')
  if (message.includes('401')) return 'Contraseña actual incorrecta'
  return 'No se pudo actualizar la contraseña'
}

export function buildProfilePayload(params: {
  username: string
  firstName: string
  lastName: string
  phoneLocal: string
  birthdate: string
  nationalId: string
  isAdmin: boolean
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    username: params.username,
    firstName: params.firstName,
    lastName: params.lastName,
    phone: params.phoneLocal ? `+598${normLocalPhoneUY(params.phoneLocal)}` : undefined,
    birthdate: params.birthdate ? new Date(params.birthdate).toISOString() : undefined,
  }
  if (params.isAdmin) {
    payload.nationalId = params.nationalId
  }
  return payload
}

export function validateProfileForm(params: {
  username: string
  nationalId: string
  firstName: string
  lastName: string
  phoneLocal: string
  canEditCi: boolean
}): string | null {
  if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(params.username)) return 'Usuario inválido'
  if (params.canEditCi && !validCI(params.nationalId)) return 'Cédula inválida'
  if (!params.firstName.trim() || !params.lastName.trim()) return 'Nombre y apellido obligatorios'
  if (params.phoneLocal && !isValidLocalPhone(params.phoneLocal)) return 'Teléfono inválido'
  return null
}
