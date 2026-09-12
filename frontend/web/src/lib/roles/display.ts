export function getRoleLabel(role?: string | null): string {
  switch (String(role || '').toUpperCase()) {
    case 'ADMIN':
      return 'Administración'
    case 'TEACHER':
      return 'Docente'
    case 'STAFF':
      return 'Personal'
    case 'STUDENT':
      return 'Estudiante'
    case 'ADSCRIPTO':
      return 'Adscripto'
    case 'DIRECCION':
      return 'Dirección'
    case 'INSPECCION':
      return 'Inspección'
    default:
      return role || 'Usuario'
  }
}

export type SelectableRole = 'TEACHER' | 'STAFF' | 'ADMIN' | 'STUDENT' | 'ADSCRIPTO' | 'DIRECCION' | 'INSPECCION'

export function getRoleOptionLabel(role: SelectableRole | ''): string {
  if (!role) return 'Seleccioná un perfil'
  return getRoleLabel(role)
}
