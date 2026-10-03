import { describe, expect, it } from 'vitest'
import {
  canResendMoodleWelcome,
  getMoodleStatusView,
  tuitionMonthButtonClass,
  tuitionMonthChipClass,
} from './students-display'

describe('getMoodleStatusView', () => {
  const linked = { linked: true, canProvision: true }

  it('da etiqueta y acción por estado de una cuenta existente', () => {
    expect(getMoodleStatusView('VERIFIED', linked)).toMatchObject({ label: 'Verificado', action: 'none' })
    expect(getMoodleStatusView('PENDING', linked)).toMatchObject({ label: 'Pendiente', action: 'resend' })
    expect(getMoodleStatusView('UNAVAILABLE', linked)).toMatchObject({ label: 'No disponible', action: 'none' })
  })

  it('sin cuenta ofrece crearla, no reenviar', () => {
    const view = getMoodleStatusView('NOT_FOUND', { linked: false, canProvision: true })
    expect(view.label).toBe('Sin cuenta')
    expect(view.action).toBe('provision')
    expect(view.actionLabel).toBe('Crear cuenta en Moodle')
  })

  it('sin email ni usuario explica por qué no se puede crear', () => {
    const view = getMoodleStatusView('NOT_FOUND', { linked: false, canProvision: false })
    expect(view.action).toBe('none')
    expect(view.hint).toMatch(/email y el usuario/)
  })

  it('distingue el desincronizado del que nunca tuvo cuenta', () => {
    // Los dos llegan como NOT_FOUND desde Moodle; `linked` es lo único que los separa.
    const broken = getMoodleStatusView('NOT_FOUND', linked)
    expect(broken.label).toBe('Error de sincronización')
    expect(broken.actionLabel).toBe('Recrear cuenta')
    expect(getMoodleStatusView('NOT_FOUND', { linked: false, canProvision: true }).label).toBe('Sin cuenta')
  })

  it('un estado ausente no rompe la vista', () => {
    expect(getMoodleStatusView(undefined).label).toBe('No disponible')
  })

  it('cada estado explica qué significa, no sólo una etiqueta', () => {
    for (const state of ['VERIFIED', 'PENDING', 'NOT_FOUND', 'UNAVAILABLE'] as const) {
      expect(getMoodleStatusView(state, linked).hint.length).toBeGreaterThan(20)
    }
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
