import { describe, expect, it } from 'vitest'
import {
  buildDraft,
  countGraded,
  dirtyCells,
  hasUnsavedChanges,
  invalidCells,
  mergeServerDraft,
  setComment,
  setInput,
  toggleAbsent,
  toSavePayload,
} from './sheet'
import type { RosterStudent } from './types'

const STUDENTS: RosterStudent[] = [
  { studentId: 's1', studentEnrollmentId: 'e1', firstName: 'Ana', lastName: 'Benítez', documentId: null },
  { studentId: 's2', studentEnrollmentId: 'e2', firstName: 'Beto', lastName: 'Cardozo', documentId: null },
]

const draft = () => buildDraft(STUDENTS, [{ studentId: 's1', valueHundredths: 700, isAbsent: false, comment: null }], 0)

describe('buildDraft', () => {
  it('precarga lo guardado y deja vacío lo pendiente', () => {
    const d = draft()
    expect(d.cells.s1.input).toBe('7')
    expect(d.cells.s2.input).toBe('')
    expect(d.order).toEqual(['s1', 's2'])
  })

  it('respeta los decimales de la escala', () => {
    const d = buildDraft(STUDENTS, [{ studentId: 's1', valueHundredths: 750, isAbsent: false, comment: null }], 1)
    expect(d.cells.s1.input).toBe('7,5')
  })
})

describe('edición', () => {
  it('escribir una nota levanta la ausencia: son excluyentes', () => {
    let d = toggleAbsent(draft(), 's2')
    expect(d.cells.s2.isAbsent).toBe(true)
    d = setInput(d, 's2', '8')
    expect(d.cells.s2.isAbsent).toBe(false)
  })

  it('marcar ausente borra la nota escrita', () => {
    let d = setInput(draft(), 's2', '8')
    d = toggleAbsent(d, 's2')
    expect(d.cells.s2).toMatchObject({ isAbsent: true, input: '' })
  })

  it('vaciar la celda no reactiva la ausencia sola', () => {
    const d = setInput(draft(), 's1', '')
    expect(d.cells.s1.isAbsent).toBe(false)
  })

  it('ignora un estudiante que no está en la planilla', () => {
    const d = draft()
    expect(setInput(d, 'fantasma', '9')).toBe(d)
  })

  it('guarda el comentario sin tocar la nota', () => {
    const d = setComment(draft(), 's1', 'entregó tarde')
    expect(d.cells.s1).toMatchObject({ comment: 'entregó tarde', input: '7' })
  })
})

describe('cambios sin guardar', () => {
  it('un borrador recién cargado no está sucio', () => {
    expect(hasUnsavedChanges(draft())).toBe(false)
  })

  it('detecta la celda editada y sólo esa', () => {
    const d = setInput(draft(), 's2', '9')
    expect(dirtyCells(d).map((c) => c.studentId)).toEqual(['s2'])
    expect(hasUnsavedChanges(d)).toBe(true)
  })

  it('volver al valor original deja de contar como cambio', () => {
    let d = setInput(draft(), 's1', '9')
    d = setInput(d, 's1', '7')
    expect(hasUnsavedChanges(d)).toBe(false)
  })
})

describe('invalidCells', () => {
  it('marca lo que no es un número', () => {
    const d = setInput(draft(), 's2', 'ocho')
    expect(invalidCells(d).map((c) => c.studentId)).toEqual(['s2'])
  })

  it('una celda vacía no es inválida: es "sin calificar"', () => {
    expect(invalidCells(draft())).toEqual([])
  })

  it('acepta coma y punto', () => {
    let d = setInput(draft(), 's1', '7,5')
    d = setInput(d, 's2', '8.5')
    expect(invalidCells(d)).toEqual([])
  })
})

describe('toSavePayload', () => {
  it('manda sólo lo que cambió', () => {
    const d = setInput(draft(), 's2', '9')
    expect(toSavePayload(d)).toEqual([
      { studentId: 's2', valueHundredths: 900, isAbsent: false, comment: null },
    ])
  })

  it('un ausente va sin valor', () => {
    const d = toggleAbsent(draft(), 's2')
    expect(toSavePayload(d)).toEqual([{ studentId: 's2', valueHundredths: null, isAbsent: true, comment: null }])
  })

  it('borrar una nota se manda como null, no se omite', () => {
    const d = setInput(draft(), 's1', '')
    expect(toSavePayload(d)).toEqual([{ studentId: 's1', valueHundredths: null, isAbsent: false, comment: null }])
  })

  it('sin cambios no manda nada', () => {
    expect(toSavePayload(draft())).toEqual([])
  })
})

describe('mergeServerDraft', () => {
  it('sin borrador previo usa el del servidor', () => {
    const server = draft()
    expect(mergeServerDraft(server, null)).toBe(server)
  })

  it('NO pisa lo que el docente venía escribiendo', () => {
    const current = setInput(draft(), 's2', '9')
    const server = buildDraft(STUDENTS, [{ studentId: 's1', valueHundredths: 800, isAbsent: false, comment: null }], 0)

    const merged = mergeServerDraft(server, current)

    expect(merged.cells.s2.input).toBe('9')       // lo suyo se conserva
    expect(merged.cells.s1.input).toBe('8')       // lo que no tocó se actualiza
  })

  it('incorpora un estudiante nuevo del servidor', () => {
    const current = draft()
    const server = buildDraft(
      [...STUDENTS, { studentId: 's3', studentEnrollmentId: 'e3', firstName: 'Caro', lastName: 'Díaz', documentId: null }],
      [],
      0,
    )
    const merged = mergeServerDraft(server, current)
    expect(merged.order).toContain('s3')
  })

  it('la celda editada queda referida al valor guardado nuevo', () => {
    // Si otro guardó 8 mientras el docente escribía 9, su 9 sigue contando como cambio.
    const current = setInput(draft(), 's1', '9')
    const server = buildDraft(STUDENTS, [{ studentId: 's1', valueHundredths: 800, isAbsent: false, comment: null }], 0)
    const merged = mergeServerDraft(server, current)
    expect(merged.cells.s1).toMatchObject({ input: '9', savedInput: '8' })
    expect(hasUnsavedChanges(merged)).toBe(true)
  })
})

describe('countGraded', () => {
  it('separa calificados, ausentes y pendientes', () => {
    let d = draft()
    d = toggleAbsent(d, 's2')
    expect(countGraded(d)).toEqual({ graded: 1, absent: 1, pending: 0 })
  })
})
