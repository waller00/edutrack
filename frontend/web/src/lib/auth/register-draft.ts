import type { RegisterRole, RegisterVerificationResults } from '@/lib/auth/register-form-validation'

const KEY = 'edutrack_register_draft'

export type RegisterDniValidationSnapshot = {
  confidence: number
  reasons: string[]
}

export type RegisterDraftSnapshot = {
  v: 1
  email: string
  username: string
  nationalId: string
  firstName: string
  lastName: string
  phoneLocal: string
  birthdate: string
  role: RegisterRole
  verificationStep: number
  verificationResults: RegisterVerificationResults | null
  dniValidation: RegisterDniValidationSnapshot | null
  dniFileName: string
  /** Imagen comprimida en data URL para vista previa y re-verificación */
  dniImageDataUrl: string | null
  /** Verificación cruzada: Didit/OCR/manual */
  identityVerificationMethod?: 'didit' | 'dni-photo' | null
}

export function saveRegisterDraft(snapshot: RegisterDraftSnapshot): void {
  try {
    globalThis.sessionStorage.setItem(KEY, JSON.stringify(snapshot))
  } catch (e) {
    console.warn('[register-draft] no se pudo guardar (imagen muy grande o storage lleno)', e)
  }
}

export function loadRegisterDraft(): RegisterDraftSnapshot | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = globalThis.sessionStorage.getItem(KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as RegisterDraftSnapshot
    if (p?.v !== 1) return null
    return p
  } catch {
    return null
  }
}

export function clearRegisterDraft(): void {
  try {
    globalThis.sessionStorage.removeItem(KEY)
  } catch {
    /* */
  }
}

const ONBOARDING_KEY = 'edutrack_onboarding_draft'

export function saveOnboardingDraft(snapshot: RegisterDraftSnapshot): void {
  try {
    globalThis.sessionStorage.setItem(ONBOARDING_KEY, JSON.stringify(snapshot))
  } catch (e) {
    console.warn('[onboarding-draft] no se pudo guardar', e)
  }
}

export function loadOnboardingDraft(): RegisterDraftSnapshot | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = globalThis.sessionStorage.getItem(ONBOARDING_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as RegisterDraftSnapshot
    if (p?.v !== 1) return null
    return p
  } catch {
    return null
  }
}

export function clearOnboardingDraft(): void {
  try {
    globalThis.sessionStorage.removeItem(ONBOARDING_KEY)
  } catch {
    /* */
  }
}
