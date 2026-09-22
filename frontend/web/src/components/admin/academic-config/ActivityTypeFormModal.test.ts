import { describe, expect, it } from 'vitest'
import {
  activityTypePayload,
  draftFromActivityType,
  validateActivityType,
  type ActivityTypeDraft,
} from './ActivityTypeFormModal'
import type { ActivityType } from '@/lib/academic-config/types'

const TYPE: ActivityType = {
  id: 't-1', code: 'ESCRITO', name: 'Escrito', description: 'Prueba escrita', category: 'ESCRITO',
  scope: 'GLOBAL', isActive: true, sortOrder: 1, usage: { assessments: 5 },
}

function draft(over: Partial<ActivityTypeDraft> = {}): ActivityTypeDraft {
  return { ...draftFromActivityType(TYPE), ...over }
}

describe('draftFromActivityType', () => {
  it('sin tipo arranca vacío y activo', () => {
    const d = draftFromActivityType(null)
    expect(d).toEqual({ code: '', name: '', description: '', sortOrder: 0, category: 'OTRAS', isActive: true })
  })

  it('la descripción nula entra como cadena vacía', () => {
    expect(draftFromActivityType({ ...TYPE, description: null }).description).toBe('')
  })
})

describe('validateActivityType', () => {
  it('acepta uno bien formado', () => {
    expect(validateActivityType(draft(), false)).toBeNull()
  })

  it('exige código con formato sólo al crear', () => {
    expect(validateActivityType(draft({ code: 'escrito corto' }), false)).toMatch(/código/i)
    expect(validateActivityType(draft({ code: 'escrito corto' }), true)).toBeNull()
  })

  it('exige nombre', () => {
    expect(validateActivityType(draft({ name: ' ' }), false)).toMatch(/nombre/i)
  })
})

describe('columna de la planilla', () => {
  it('un tipo nuevo cae en Otras; uno existente conserva la suya y la manda al guardar', () => {
    expect(draftFromActivityType(null).category).toBe('OTRAS')
    expect(activityTypePayload(draft(), true)).toMatchObject({ category: 'ESCRITO' })
    expect(activityTypePayload(draft({ category: 'PRUEBA' }), false)).toMatchObject({ category: 'PRUEBA' })
  })
})

describe('activityTypePayload', () => {
  it('al crear manda code y no isActive; al editar al revés', () => {
    expect(activityTypePayload(draft(), false)).toHaveProperty('code', 'ESCRITO')
    expect(activityTypePayload(draft(), false)).not.toHaveProperty('isActive')
    expect(activityTypePayload(draft(), true)).not.toHaveProperty('code')
    expect(activityTypePayload(draft(), true)).toHaveProperty('isActive', true)
  })

  it('la descripción vacía viaja como null', () => {
    expect(activityTypePayload(draft({ description: '  ' }), false).description).toBeNull()
  })
})
