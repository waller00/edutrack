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
    default:
      return role || 'Usuario'
  }
}

export function getRoleOptionLabel(role: 'TEACHER' | 'STAFF' | 'ADMIN' | 'STUDENT' | ''): string {
  if (!role) return 'Seleccioná un perfil'
  return getRoleLabel(role)
}
