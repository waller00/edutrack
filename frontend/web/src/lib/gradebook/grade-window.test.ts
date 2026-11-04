import { describe, expect, it } from 'vitest'
import { assessmentLockText, earliestGradableDate, openTramos } from './grade-window'

describe('qué se puede cargar en Calificaciones', () => {
  const tramos = [{ id: 'mar' }, { id: 'may' }, { id: 'jul' }]

  it('sólo los tramos abiertos; sin estados conocidos, todos', () => {
    const states = [
      { periodId: 'mar', status: 'CLOSED', canEdit: false },
      { periodId: 'may', status: 'OPEN', canEdit: true },
    ]
    expect(openTramos(tramos, states).map((t) => t.id)).toEqual(['may', 'jul'])
    expect(openTramos(tramos, undefined)).toHaveLength(3)
  })

  it('la fecha más vieja es hoy menos el plazo, con un día de margen', () => {
    expect(earliestGradableDate('2026-05-20', 30)).toBe('2026-04-21')
    expect(earliestGradableDate('2026-03-01', 1)).toBe('2026-03-01')
    expect(earliestGradableDate('2026-05-20', 30, true)).toBeUndefined()
    expect(earliestGradableDate('2026-05-20', null)).toBeUndefined()
  })

  it('dice por qué ya no se edita', () => {
    expect(assessmentLockText({ canEdit: true })).toBeNull()
    expect(assessmentLockText({})).toBeNull()
    expect(assessmentLockText({ canEdit: false, blockedReason: 'PERIOD_CLOSED' })).toBe('Período cerrado')
    expect(assessmentLockText({ canEdit: false, blockedReason: 'ARCHIVED' })).toBe('Ciclo cerrado')
    expect(assessmentLockText({ canEdit: false, blockedReason: 'WINDOW_EXPIRED', editableUntil: '2026-10-12T12:00:00.000Z' })).toBe('Plazo vencido el 12/10')
    expect(assessmentLockText({ canEdit: false, blockedReason: 'WINDOW_EXPIRED' })).toBe('Plazo vencido')
    expect(assessmentLockText({ canEdit: false, blockedReason: 'NOT_ASSIGNED' })).toBe('Sólo lectura')
  })
})
