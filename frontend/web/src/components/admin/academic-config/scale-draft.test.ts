import { describe, expect, it } from 'vitest'
import {
  draftFromScale,
  emptyLevel,
  findOverlap,
  scalePayload,
  validateScale,
  type ScaleDraft,
} from './scale-draft'
import type { GradingScale } from '@/lib/academic-config/types'

function level(over: Partial<ScaleDraft['levels'][number]> = {}) {
  return { ...emptyLevel(), code: 'BAJO', label: 'Bajo', min: '1', max: '5', ...over }
}

function draft(over: Partial<ScaleDraft> = {}): ScaleDraft {
  return {
    code: 'NUM_1_10', name: 'Numérica 1-10', kind: 'NUMERIC',
    min: '1', max: '10', decimals: 0, description: '', isActive: true, levels: [],
    ...over,
  }
}

const SCALE: GradingScale = {
  id: 's-1', code: 'NUM_1_10', name: 'Numérica 1-10', kind: 'NUMERIC',
  minValueHundredths: 100, maxValueHundredths: 1000, decimals: 0,
  description: 'Del 1 al 10', isActive: true, sortOrder: 0, gaps: [],
  usage: { assessments: 4 },
  levels: [
    {
      id: 'l-1', code: 'INSUF', label: 'Insuficiente', descriptor: 'No alcanza.',
      minValueHundredths: 100, maxValueHundredths: 500,
      colorToken: 'red', iconToken: 'x', isPassing: false, isAlert: true, sortOrder: 0,
    },
  ],
}

describe('draftFromScale', () => {
  it('sin escala arranca vacío y numérico', () => {
    const d = draftFromScale(null)
    expect(d.code).toBe('')
    expect(d.kind).toBe('NUMERIC')
    expect(d.levels).toEqual([])
    expect(d.isActive).toBe(true)
  })

  it('convierte los centésimos a lo que se escribe', () => {
    // La API habla en centésimos (800 = 8); el formulario muestra lo que el usuario escribiría.
    const d = draftFromScale(SCALE)
    expect(d.min).toBe('1')
    expect(d.max).toBe('10')
    expect(d.levels[0].min).toBe('1')
    expect(d.levels[0].max).toBe('5')
  })

  it('el descriptor nulo entra como cadena vacía', () => {
    const d = draftFromScale({ ...SCALE, description: null, levels: [{ ...SCALE.levels[0], descriptor: null }] })
    expect(d.description).toBe('')
    expect(d.levels[0].descriptor).toBe('')
  })
})

describe('validateScale', () => {
  it('acepta una escala bien formada', () => {
    expect(validateScale(draft({ levels: [level()] }), false)).toBeNull()
  })

  it('exige un código con el formato del backend, sólo al crear', () => {
    expect(validateScale(draft({ code: 'num 1 10' }), false)).toMatch(/código/i)
    // Al editar el código no viaja, así que no se valida.
    expect(validateScale(draft({ code: 'num 1 10' }), true)).toBeNull()
  })

  it('exige nombre', () => {
    expect(validateScale(draft({ name: '  ' }), false)).toMatch(/nombre/i)
  })

  it('rechaza el rango de la escala invertido', () => {
    expect(validateScale(draft({ min: '10', max: '1' }), false)).toMatch(/mínimo.*mayor/i)
  })

  it('señala el tramo exacto que está mal', () => {
    const d = draft({ levels: [level(), level({ code: 'ALTO', min: '9', max: '6' })] })
    expect(validateScale(d, false)).toMatch(/Tramo 2/)
  })

  it('rechaza un tramo sin desde o hasta', () => {
    expect(validateScale(draft({ levels: [level({ min: '' })] }), false)).toMatch(/Tramo 1.*desde y hasta/i)
  })

  it('rechaza un tramo fuera del rango de la escala', () => {
    expect(validateScale(draft({ levels: [level({ min: '0', max: '5' })] }), false)).toMatch(/por debajo del mínimo/i)
    expect(validateScale(draft({ levels: [level({ min: '5', max: '12' })] }), false)).toMatch(/por encima del máximo/i)
  })

  it('rechaza tramos que se pisan', () => {
    const d = draft({ levels: [level({ min: '1', max: '6' }), level({ code: 'ALTO', min: '5', max: '10' })] })
    expect(validateScale(d, false)).toMatch(/tramos 1 y 2 se pisan/i)
  })

  it('una escala ordinal sin tramos no tiene sentido: el tramo ES la nota', () => {
    expect(validateScale(draft({ kind: 'ORDINAL', levels: [] }), false)).toMatch(/al menos un tramo/i)
    expect(validateScale(draft({ kind: 'NUMERIC', levels: [] }), false)).toBeNull()
  })
})

describe('findOverlap', () => {
  it('devuelve las posiciones del primer par que se pisa', () => {
    expect(findOverlap([level({ min: '1', max: '6' }), level({ min: '5', max: '10' })])).toEqual([1, 2])
  })

  it('tramos contiguos que no se tocan no son solape', () => {
    expect(findOverlap([level({ min: '1', max: '5' }), level({ min: '6', max: '10' })])).toBeNull()
  })

  it('ignora los tramos incompletos en vez de romperse', () => {
    expect(findOverlap([level({ min: '' }), level({ min: '1', max: '10' })])).toBeNull()
  })
})

describe('scalePayload', () => {
  it('manda centésimos y numera los tramos por su posición', () => {
    const body = scalePayload(draft({ levels: [level(), level({ code: 'ALTO', min: '6', max: '10' })] }), false)
    expect(body.minValueHundredths).toBe(100)
    expect(body.maxValueHundredths).toBe(1000)
    expect(body.levels[0]).toMatchObject({ code: 'BAJO', minValueHundredths: 100, maxValueHundredths: 500, sortOrder: 0 })
    expect(body.levels[1]).toMatchObject({ code: 'ALTO', sortOrder: 1 })
  })

  it('al crear manda code y no isActive; al editar al revés', () => {
    // El backend rechaza `code` en un PATCH.
    expect(scalePayload(draft(), false)).toHaveProperty('code', 'NUM_1_10')
    expect(scalePayload(draft(), false)).not.toHaveProperty('isActive')
    expect(scalePayload(draft(), true)).not.toHaveProperty('code')
    expect(scalePayload(draft(), true)).toHaveProperty('isActive', true)
  })

  it('el descriptor vacío viaja como null, no como cadena', () => {
    const body = scalePayload(draft({ description: '  ', levels: [level({ descriptor: '' })] }), false)
    expect(body.description).toBeNull()
    expect(body.levels[0].descriptor).toBeNull()
  })

  it('acepta coma decimal como se escribe en Uruguay', () => {
    const body = scalePayload(draft({ levels: [level({ min: '1', max: '5,9' })] }), false)
    expect(body.levels[0].maxValueHundredths).toBe(590)
  })
})
