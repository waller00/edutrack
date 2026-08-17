import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  saveRegisterDraft,
  loadRegisterDraft,
  clearRegisterDraft,
  saveOnboardingDraft,
  loadOnboardingDraft,
  clearOnboardingDraft,
  type RegisterDraftSnapshot,
} from './register-draft'

function snapshot(): RegisterDraftSnapshot {
  return {
    v: 1,
    email: 'a@b.com',
    username: 'a.b',
    nationalId: '12345678',
    firstName: 'A',
    lastName: 'B',
    phoneLocal: '099123456',
    birthdate: '1990-01-01',
    role: 'TEACHER',
    verificationStep: 0,
    verificationResults: null,
    dniValidation: null,
    dniFileName: '',
    dniImageDataUrl: null,
  }
}

beforeEach(() => {
  window.sessionStorage.clear()
})

describe('register draft', () => {
  it('guarda y recupera el borrador', () => {
    const s = snapshot()
    saveRegisterDraft(s)
    expect(loadRegisterDraft()).toEqual(s)
  })

  it('clear elimina el borrador', () => {
    saveRegisterDraft(snapshot())
    clearRegisterDraft()
    expect(loadRegisterDraft()).toBeNull()
  })

  it('devuelve null si no hay borrador', () => {
    expect(loadRegisterDraft()).toBeNull()
  })

  it('descarta versiones distintas de v:1', () => {
    window.sessionStorage.setItem('edutrack_register_draft', JSON.stringify({ v: 2 }))
    expect(loadRegisterDraft()).toBeNull()
  })

  it('devuelve null ante JSON inválido', () => {
    window.sessionStorage.setItem('edutrack_register_draft', '{no-json')
    expect(loadRegisterDraft()).toBeNull()
  })
})

describe('onboarding draft', () => {
  it('guarda, recupera y limpia', () => {
    const s = snapshot()
    saveOnboardingDraft(s)
    expect(loadOnboardingDraft()).toEqual(s)
    clearOnboardingDraft()
    expect(loadOnboardingDraft()).toBeNull()
  })

  it('descarta v distinto', () => {
    window.sessionStorage.setItem('edutrack_onboarding_draft', JSON.stringify({ v: 9 }))
    expect(loadOnboardingDraft()).toBeNull()
  })

  it('loadOnboardingDraft devuelve null ante JSON inválido', () => {
    window.sessionStorage.setItem('edutrack_onboarding_draft', '{no-json')
    expect(loadOnboardingDraft()).toBeNull()
  })
})

describe('register draft — fallos de storage (rama catch)', () => {
  it('no propaga errores cuando setItem falla (cuota llena)', () => {
    const spy = vi.spyOn(window.sessionStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded')
    })
    expect(() => saveRegisterDraft(snapshot())).not.toThrow()
    expect(() => saveOnboardingDraft(snapshot())).not.toThrow()
    spy.mockRestore()
  })
})

describe('register draft — borradores incompletos', () => {
  it('completa los campos faltantes en vez de romper el formulario', () => {
    // Un borrador truncado o de una versión anterior igual trae `v: 1`. Si sus campos
    // llegan como `undefined`, el formulario los vuelca en estados que asume string y
    // la página de registro queda en blanco.
    window.sessionStorage.setItem('edutrack_register_draft', JSON.stringify({ v: 1 }))

    const d = loadRegisterDraft()

    expect(d).not.toBeNull()
    expect(d?.email).toBe('')
    expect(d?.firstName).toBe('')
    expect(d?.nationalId).toBe('')
    expect(d?.role).toBe('')
    expect(d?.verificationStep).toBe(0)
    expect(d?.verificationResults).toBeNull()
  })

  it('descarta un rol inválido', () => {
    window.sessionStorage.setItem(
      'edutrack_register_draft',
      JSON.stringify({ v: 1, role: 'SUPERADMIN', email: 'a@b.com' }),
    )

    const d = loadRegisterDraft()

    expect(d?.role).toBe('')
    expect(d?.email).toBe('a@b.com')
  })

  it('conserva los valores válidos que sí vinieron', () => {
    window.sessionStorage.setItem(
      'edutrack_register_draft',
      JSON.stringify({ v: 1, email: 'juan@example.com', role: 'TEACHER', verificationStep: 2 }),
    )

    const d = loadRegisterDraft()

    expect(d?.email).toBe('juan@example.com')
    expect(d?.role).toBe('TEACHER')
    expect(d?.verificationStep).toBe(2)
  })

  it('también normaliza el borrador de onboarding', () => {
    window.sessionStorage.setItem('edutrack_onboarding_draft', JSON.stringify({ v: 1 }))
    expect(loadOnboardingDraft()?.lastName).toBe('')
  })
})
