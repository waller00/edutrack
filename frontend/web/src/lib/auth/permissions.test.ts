import { describe, expect, it } from 'vitest'
import { hasAnyPermission, hasPermission, permissionScope } from './permissions'

const me = {
  permissionIds: ['gradebook.read', 'events.read'],
  permissions: [
    { id: 'gradebook.read', scope: 'all' as const },
    { id: 'gradebook.review', scope: 'all' as const },
    { id: 'gradebook.close' },
  ],
}

describe('permisos del usuario', () => {
  it('lee el alcance de `permissions` antes que de `permissionIds`', () => {
    expect(permissionScope(me, 'gradebook.read')).toBe('all')
    expect(permissionScope(me, 'events.read')).toBe('own')
    expect(permissionScope(me, 'gradebook.close')).toBe('own')
    expect(permissionScope(me, 'gradebook.endorse')).toBeNull()
    expect(permissionScope(null, 'gradebook.read')).toBeNull()
  })

  it('con alcance pedido, `all` cubre a `own` pero no al revés', () => {
    expect(hasPermission(me, 'gradebook.review', 'own')).toBe(true)
    expect(hasPermission(me, 'gradebook.close', 'all')).toBe(false)
    expect(hasPermission(me, 'gradebook.close')).toBe(true)
  })

  it('alcanza con uno de la lista', () => {
    expect(hasAnyPermission(me, ['gradebook.endorse', 'gradebook.review'])).toBe(true)
    expect(hasAnyPermission(me, 'gradebook.endorse')).toBe(false)
    expect(hasAnyPermission(undefined, ['gradebook.read'])).toBe(false)
  })
})
