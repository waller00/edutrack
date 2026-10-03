import { describe, expect, it } from 'vitest'
import { computeEditableUntil, resolveGradeEditPermissions } from './edit-window.js'

const DATE = new Date('2026-05-10T12:00:00.000Z')

function call(over: Partial<Parameters<typeof resolveGradeEditPermissions>[0]> = {}) {
  return resolveGradeEditPermissions({
    gradeScope: 'own',
    canManage: false,
    isResponsible: true,
    assessmentDate: DATE,
    windowDays: 30,
    gradeBookStatus: 'ACTIVE',
    now: new Date('2026-05-20T12:00:00.000Z'),
    ...over,
  })
}

describe('computeEditableUntil', () => {
  it('cuenta los días desde la fecha de la evaluación', () => {
    expect(computeEditableUntil(DATE, 30).toISOString()).toBe('2026-06-09T12:00:00.000Z')
  })
})

describe('titular', () => {
  it('edita dentro del plazo', () => {
    expect(call()).toMatchObject({ canEdit: true, blockedReason: null, outsideWindow: false })
  })

  it('en el borde exacto todavía edita', () => {
    expect(call({ now: new Date('2026-06-09T12:00:00.000Z') }).canEdit).toBe(true)
  })

  it('un segundo después ya no', () => {
    const res = call({ now: new Date('2026-06-09T12:00:01.000Z') })
    expect(res).toMatchObject({ canEdit: false, blockedReason: 'WINDOW_EXPIRED', outsideWindow: true })
  })

  it('acortar la ventana aplica retroactivamente', () => {
    // La misma evaluación, con la ventana bajada de 30 a 5 días, deja de ser editable.
    expect(call({ windowDays: 30 }).canEdit).toBe(true)
    expect(call({ windowDays: 5 }).canEdit).toBe(false)
  })
})

describe('docente ajeno', () => {
  it('no edita aunque esté dentro del plazo', () => {
    expect(call({ isResponsible: false })).toMatchObject({ canEdit: false, blockedReason: 'NOT_ASSIGNED' })
  })
})

describe('administración', () => {
  it('con gradebook.manage edita fuera de plazo, marcado para auditar', () => {
    const res = call({
      canManage: true,
      isResponsible: false,
      gradeScope: 'all',
      now: new Date('2026-12-01T12:00:00.000Z'),
    })
    expect(res).toMatchObject({ canEdit: true, blockedReason: null, outsideWindow: true })
  })

  it('alcance all SIN manage no habilita fuera de plazo', () => {
    // Es la diferencia entre ver todas las libretas y poder corregir una vencida.
    const res = call({
      canManage: false,
      isResponsible: false,
      gradeScope: 'all',
      now: new Date('2026-12-01T12:00:00.000Z'),
    })
    expect(res).toMatchObject({ canEdit: false, blockedReason: 'WINDOW_EXPIRED' })
  })
})

describe('sin permiso de calificar', () => {
  it('adscripción y dirección no escriben, aunque vean la libreta', () => {
    expect(call({ gradeScope: null, isResponsible: false })).toMatchObject({
      canEdit: false,
      blockedReason: 'NOT_ASSIGNED',
    })
  })
})

describe('ciclo archivado', () => {
  it('nadie escribe, ni siquiera con manage', () => {
    const res = call({ gradeBookStatus: 'ARCHIVED', canManage: true, gradeScope: 'all' })
    expect(res).toMatchObject({ canEdit: false, blockedReason: 'ARCHIVED' })
  })
})
