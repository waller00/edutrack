import { describe, expect, it } from 'vitest'
import {
  canResendMoodleWelcome,
  getMoodleStatusView,
  tuitionMonthButtonClass,
  tuitionMonthChipClass,
} from './students-display'

describe('getMoodleStatusView', () => {
  it('da etiqueta y color por estado', () => {
    expect(getMoodleStatusView('VERIFIED')).toMatchObject({ label: 'Verificado' })
    expect(getMoodleStatusView('PENDING')).toMatchObject({ label: 'Pendiente' })
    expect(getMoodleStatusView('NOT_FOUND')).toMatchObject({ label: 'Sin sincronizar' })
    expect(getMoodleStatusView('UNAVAILABLE')).toMatchObject({ label: 'No disponible' })
  })

  it('un estado ausente no rompe la vista', () => {
    expect(getMoodleStatusView(undefined).label).toBe('No disponible')
  })
})

describe('canResendMoodleWelcome', () => {
  it('solo se reenvía si la cuenta aún no está verificada', () => {
    expect(canResendMoodleWelcome('PENDING')).toBe(true)
    expect(canResendMoodleWelcome('NOT_FOUND')).toBe(true)
    expect(canResendMoodleWelcome('VERIFIED')).toBe(false)
    expect(canResendMoodleWelcome('UNAVAILABLE')).toBe(false)
    expect(canResendMoodleWelcome(undefined)).toBe(false)
  })
})

describe('tuitionMonthButtonClass', () => {
  it('extiende el chip estático en vez de duplicar la paleta', () => {
    for (const status of ['paid', 'pending', 'none'] as const) {
      expect(tuitionMonthButtonClass(status)).toContain(tuitionMonthChipClass(status))
      expect(tuitionMonthButtonClass(status)).toContain('hover:')
    }
  })
})
