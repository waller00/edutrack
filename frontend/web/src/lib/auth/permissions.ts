import type { AuthMe } from '@/contexts/AuthContext'

export type PermissionScope = 'own' | 'all'

export type WithPermissions = Pick<AuthMe, 'permissionIds' | 'permissions'> | null | undefined

/**
 * Alcance con el que el usuario tiene un permiso, o `null` si no lo tiene.
 *
 * `permissions` trae el alcance; `permissionIds` es la forma vieja, sin alcance, y se lee como
 * `own`. Si un permiso aparece en las dos, manda `permissions`.
 */
export function permissionScope(me: WithPermissions, id: string): PermissionScope | null {
  if (!me) return null
  const granted = me.permissions?.find((p) => p.id === id)
  if (granted) return granted.scope === 'all' ? 'all' : 'own'
  return me.permissionIds?.includes(id) ? 'own' : null
}

/** ¿Tiene el permiso? Con `scope` exige ese alcance; `all` cubre a `own`. */
export function hasPermission(me: WithPermissions, id: string, scope?: PermissionScope): boolean {
  const granted = permissionScope(me, id)
  return Boolean(granted && (!scope || granted === scope || granted === 'all'))
}

/** ¿Tiene alguno de los permisos? */
export function hasAnyPermission(me: WithPermissions, ids: string | readonly string[], scope?: PermissionScope): boolean {
  const list = typeof ids === 'string' ? [ids] : ids
  return list.some((id) => hasPermission(me, id, scope))
}
