import { describe, expect, it } from 'vitest'
import {
  appendJustificationNote,
  ENTRY_NOTE_MAX,
  findStudentsOutsideRoster,
  overridesJustification,
  resolveIncomingEntryStatus,
} from './roll-call-rules.js'

describe('resolveIncomingEntryStatus', () => {
  it('conserva la justificación si el docente reenvía ABSENT', () => {
    expect(resolveIncomingEntryStatus('ABSENT_JUSTIFIED', 'ABSENT')).toBe('ABSENT_JUSTIFIED')
  })

  it('permite corregir a PRESENT una falta justificada', () => {
    expect(resolveIncomingEntryStatus('ABSENT_JUSTIFIED', 'PRESENT')).toBe('PRESENT')
  })

  it('permite corregir a LATE una falta justificada', () => {
    expect(resolveIncomingEntryStatus('ABSENT_JUSTIFIED', 'LATE')).toBe('LATE')
  })

  it('sin estado previo escribe lo que manda el docente', () => {
    expect(resolveIncomingEntryStatus(null, 'ABSENT')).toBe('ABSENT')
    expect(resolveIncomingEntryStatus('PRESENT', 'ABSENT')).toBe('ABSENT')
  })
})

describe('overridesJustification', () => {
  it('marca la reversión de una justificación', () => {
    expect(overridesJustification('ABSENT_JUSTIFIED', 'PRESENT')).toBe(true)
    expect(overridesJustification('ABSENT_JUSTIFIED', 'ABSENT')).toBe(false)
    expect(overridesJustification('ABSENT', 'PRESENT')).toBe(false)
    expect(overridesJustification(null, 'PRESENT')).toBe(false)
  })
})

describe('findStudentsOutsideRoster', () => {
  it('no reporta nada cuando todos pertenecen al grupo', () => {
    expect(findStudentsOutsideRoster(['a', 'b'], ['a', 'b', 'c'])).toEqual([])
  })

  it('reporta los que ya no pertenecen', () => {
    expect(findStudentsOutsideRoster(['a', 'x'], ['a', 'b'])).toEqual(['x'])
  })

  it('no duplica un mismo ofensor repetido en el payload', () => {
    expect(findStudentsOutsideRoster(['x', 'x'], ['a'])).toEqual(['x'])
  })
})

describe('appendJustificationNote', () => {
  it('crea la nota cuando no había ninguna', () => {
    expect(appendJustificationNote(null, 'Certificado médico')).toBe('Justificación: Certificado médico')
  })

  it('agrega sin pisar la nota del docente', () => {
    expect(appendJustificationNote('Llegó 8:15', 'Certificado')).toBe('Llegó 8:15 · Justificación: Certificado')
  })

  it('trunca al límite de la columna VarChar(280)', () => {
    const result = appendJustificationNote('x'.repeat(270), 'y'.repeat(100))
    expect(result.length).toBe(ENTRY_NOTE_MAX)
    expect(result.endsWith('…')).toBe(true)
  })
})
