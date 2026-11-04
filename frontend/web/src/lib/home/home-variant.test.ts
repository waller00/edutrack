import { describe, expect, it } from 'vitest'
import { homeVariant } from './home-variant'
import { visibleNavGroups } from '@/lib/navigation/modules'

const me = (...permissions: [string, 'own' | 'all'][]) => ({ role: 'TEACHER', permissions: permissions.map(([id, scope]) => ({ id, scope })) })

describe('el Inicio de cada uno', () => {
  const teacher = me(['student-attendance.take', 'own'], ['gradebook.read', 'own'], ['events.read', 'own'])
  const staff = me(['attendance.read', 'own'], ['licenses.read', 'own'])

  it('el docente tiene «Mi día»; Personal, sus accesos; quien ve el centro, el de todos', () => {
    expect(homeVariant(teacher)).toBe('teacher')
    expect(homeVariant(staff)).toBe('own')
    expect(homeVariant(me(['analytics.read', 'all'], ['gradebook.read', 'all']))).toBe('team')
  })

  it('el docente tiene Inicio en el menú; Personal sigue sólo con Mi trabajo', () => {
    expect(visibleNavGroups(teacher).map((g) => g.id)).toEqual(['inicio', 'mine'])
    expect(visibleNavGroups(staff).map((g) => g.id)).toEqual(['mine'])
  })
})
