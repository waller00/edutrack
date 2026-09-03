import { describe, expect, it } from 'vitest'
import {
  applyBulk,
  applyCopySuggestion,
  buildDraft,
  countByStatus,
  fullName,
  isSheetComplete,
  mergeServerRoster,
  setNote,
  setStatus,
  toSavePayload,
  type SheetStudent,
} from './rollcall-sheet'

function student(id: string, overrides: Partial<SheetStudent> = {}): SheetStudent {
  return {
    studentId: id,
    firstName: `Nombre${id}`,
    lastName: `Apellido${id}`,
    documentId: null,
    entryId: null,
    status: null,
    note: null,
    markedAt: null,
    ...overrides,
  }
}

const students = [student('a'), student('b'), student('c')]

describe('buildDraft', () => {
  it('parte de lo que devolvió el servidor', () => {
    const draft = buildDraft([student('a', { status: 'PRESENT', note: 'ok' })])
    expect(draft.a).toEqual({ status: 'PRESENT', note: 'ok' })
  })

  it('deja sin estado a quien no tiene marca', () => {
    expect(buildDraft(students).a).toEqual({ status: null, note: null })
  })
})

describe('setStatus / setNote', () => {
  it('cambia el estado conservando la nota', () => {
    const draft = setNote(buildDraft(students), 'a', ' llegó 8:15 ')
    expect(setStatus(draft, 'a', 'LATE')).toMatchObject({ a: { status: 'LATE', note: 'llegó 8:15' } })
  })

  it('una nota vacía se guarda como null, no como cadena vacía', () => {
    expect(setNote(buildDraft(students), 'a', '   ').a.note).toBeNull()
  })

  it('conserva el estado al editar la nota', () => {
    const draft = setStatus(buildDraft(students), 'a', 'PRESENT')
    expect(setNote(draft, 'a', 'algo').a.status).toBe('PRESENT')
  })
})

describe('applyBulk', () => {
  it('marca a todos con el mismo estado', () => {
    const draft = applyBulk(buildDraft(students), students, 'PRESENT')
    expect(Object.values(draft).every((c) => c.status === 'PRESENT')).toBe(true)
  })

  it('no pisa una falta ya justificada al marcar todos ausentes', () => {
    const withJustified = [student('a', { status: 'ABSENT_JUSTIFIED' }), student('b')]
    const draft = applyBulk(buildDraft(withJustified), withJustified, 'ABSENT')
    expect(draft.a.status).toBe('ABSENT_JUSTIFIED')
    expect(draft.b.status).toBe('ABSENT')
  })

  it('sí permite marcar presente a quien tenía falta justificada', () => {
    const withJustified = [student('a', { status: 'ABSENT_JUSTIFIED' })]
    expect(applyBulk(buildDraft(withJustified), withJustified, 'PRESENT').a.status).toBe('PRESENT')
  })

  it('conserva las notas cargadas', () => {
    const draft = setNote(buildDraft(students), 'a', 'nota')
    expect(applyBulk(draft, students, 'ABSENT').a.note).toBe('nota')
  })
})

describe('applyCopySuggestion', () => {
  it('aplica solo a los alumnos que estaban en la hora anterior', () => {
    const result = applyCopySuggestion(buildDraft(students), students, [
      { studentId: 'a', status: 'PRESENT' },
      { studentId: 'b', status: 'ABSENT' },
    ])
    expect(result.applied).toBe(2)
    expect(result.draft.a.status).toBe('PRESENT')
    expect(result.draft.b.status).toBe('ABSENT')
  })

  it('deja sin marcar a los alumnos nuevos y los reporta', () => {
    const result = applyCopySuggestion(buildDraft(students), students, [{ studentId: 'a', status: 'PRESENT' }])
    expect(result.unmatchedIds).toEqual(['b', 'c'])
    expect(result.draft.b.status).toBeNull()
  })

  it('ignora sugerencias de alumnos que ya no están en el grupo', () => {
    const result = applyCopySuggestion(buildDraft([student('a')]), [student('a')], [
      { studentId: 'a', status: 'LATE' },
      { studentId: 'z', status: 'PRESENT' },
    ])
    expect(Object.keys(result.draft)).toEqual(['a'])
    expect(result.applied).toBe(1)
  })

  it('conserva las notas ya escritas por el docente', () => {
    const draft = setNote(buildDraft(students), 'a', 'nota previa')
    const result = applyCopySuggestion(draft, students, [{ studentId: 'a', status: 'PRESENT' }])
    expect(result.draft.a.note).toBe('nota previa')
  })
})

describe('countByStatus', () => {
  it('cuenta cada estado y los pendientes', () => {
    const rows = [
      student('a', { status: 'PRESENT' }),
      student('b', { status: 'LATE' }),
      student('c', { status: 'ABSENT' }),
      student('d', { status: 'ABSENT_JUSTIFIED' }),
      student('e'),
    ]
    expect(countByStatus(buildDraft(rows), rows)).toEqual({
      present: 1,
      late: 1,
      absent: 1,
      justified: 1,
      pending: 1,
    })
  })
})

describe('isSheetComplete', () => {
  it('exige que todos tengan estado', () => {
    expect(isSheetComplete(applyBulk(buildDraft(students), students, 'PRESENT'), students)).toBe(true)
    expect(isSheetComplete(buildDraft(students), students)).toBe(false)
  })

  it('una lista sin alumnos no está completa', () => {
    expect(isSheetComplete({}, [])).toBe(false)
  })
})

describe('toSavePayload', () => {
  it('omite a los alumnos sin marcar', () => {
    const draft = setStatus(buildDraft(students), 'a', 'PRESENT')
    expect(toSavePayload(draft, students)).toEqual([{ studentId: 'a', status: 'PRESENT', note: null }])
  })

  it('degrada ABSENT_JUSTIFIED a ABSENT porque el endpoint no lo acepta', () => {
    const rows = [student('a', { status: 'ABSENT_JUSTIFIED' })]
    expect(toSavePayload(buildDraft(rows), rows)).toEqual([{ studentId: 'a', status: 'ABSENT', note: null }])
  })

  it('incluye la nota cuando existe', () => {
    const rows = [student('a', { status: 'LATE', note: 'llegó 8:15' })]
    expect(toSavePayload(buildDraft(rows), rows)[0].note).toBe('llegó 8:15')
  })
})

describe('mergeServerRoster', () => {
  it('conserva lo que el docente ya marcó localmente', () => {
    const local = setStatus(buildDraft(students), 'a', 'ABSENT')
    const merged = mergeServerRoster([student('a', { status: 'PRESENT' })], local)
    expect(merged.a.status).toBe('ABSENT')
  })

  it('incorpora alumnos nuevos sin estado', () => {
    const merged = mergeServerRoster([student('a'), student('nuevo')], buildDraft([student('a')]))
    expect(merged.nuevo).toEqual({ status: null, note: null })
  })

  it('descarta alumnos que ya no están en el roster', () => {
    const merged = mergeServerRoster([student('a')], buildDraft(students))
    expect(Object.keys(merged)).toEqual(['a'])
  })
})

describe('fullName', () => {
  it('se lee como en la libreta: apellido, nombre', () => {
    expect(fullName({ firstName: 'Ana', lastName: 'Alvez' })).toBe('Alvez, Ana')
  })
})
