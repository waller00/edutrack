import { describe, expect, it } from 'vitest'
import { editWindowNotice, isEditableNow } from './rollcall-window'

describe('isEditableNow', () => {
  const until = '2026-05-07T14:00:00.000Z'

  it('no se puede editar si el servidor ya dijo que no', () => {
    expect(isEditableNow(until, false)).toBe(false)
  })

  it('dentro del plazo se puede', () => {
    expect(isEditableNow(until, true, new Date('2026-05-06T10:00:00.000Z'))).toBe(true)
  })

  it('pasado el plazo no', () => {
    expect(isEditableNow(until, true, new Date('2026-05-08T10:00:00.000Z'))).toBe(false)
  })

  it('sin fecha límite se asume editable', () => {
    expect(isEditableNow(null, true)).toBe(true)
  })
})

describe('editWindowNotice', () => {
  it('explica el cierre administrativo', () => {
    const notice = editWindowNotice({ canEdit: false, blockedReason: 'LOCKED', editableUntil: null })
    expect(notice).toContain('cerró')
  })

  it('explica el vencimiento del plazo', () => {
    const notice = editWindowNotice({ canEdit: false, blockedReason: 'WINDOW_EXPIRED', editableUntil: null })
    expect(notice).toContain('plazo')
  })

  it('explica que no es su clase', () => {
    const notice = editWindowNotice({ canEdit: false, blockedReason: 'NOT_ASSIGNED', editableUntil: null })
    expect(notice).toContain('docente')
  })

  it('tiene un mensaje genérico para un motivo desconocido', () => {
    expect(editWindowNotice({ canEdit: false, blockedReason: null, editableUntil: null })).toContain('no se puede editar')
  })

  it('cuando se puede editar informa hasta cuándo', () => {
    const notice = editWindowNotice({ canEdit: true, blockedReason: null, editableUntil: '2026-05-07T14:00:00.000Z' })
    expect(notice).toContain('Podés editar')
  })

  it('no muestra aviso si no hay fecha límite', () => {
    expect(editWindowNotice({ canEdit: true, blockedReason: null, editableUntil: null })).toBeNull()
  })
})
