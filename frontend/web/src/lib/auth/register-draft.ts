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
  /**
   * Contraseña tipeada antes del redirect a Didit. Se persiste solo en sessionStorage
   * (aislado por pestaña y borrado al cerrarla) para no obligar a reingresarla al volver.
   */
  password?: string
  confirm?: string
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

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Normaliza un borrador leído de sessionStorage.
 *
 * El `v: 1` no garantiza la forma: un borrador truncado o de una versión anterior
 * puede traer campos ausentes, y el formulario los vuelca directo en estados que
 * asume `string`. Sin esto, un borrador incompleto rompe toda la página de registro
 * (pantalla en blanco) y el usuario no puede ni empezar de nuevo.
 */
function normalizeDraft(raw: RegisterDraftSnapshot): RegisterDraftSnapshot {
  const role = raw.role === 'STAFF' || raw.role === 'TEACHER' ? raw.role : ''
  return {
    ...raw,
    v: 1,
    email: str(raw.email),
    username: str(raw.username),
    nationalId: str(raw.nationalId),
    firstName: str(raw.firstName),
    lastName: str(raw.lastName),
    phoneLocal: str(raw.phoneLocal),
    birthdate: str(raw.birthdate),
    role,
    password: typeof raw.password === 'string' ? raw.password : undefined,
    confirm: typeof raw.confirm === 'string' ? raw.confirm : undefined,
    verificationStep: typeof raw.verificationStep === 'number' ? raw.verificationStep : 0,
    verificationResults: raw.verificationResults ?? null,
    dniValidation: raw.dniValidation ?? null,
    dniFileName: str(raw.dniFileName),
    dniImageDataUrl: typeof raw.dniImageDataUrl === 'string' ? raw.dniImageDataUrl : null,
  }
}

export function loadRegisterDraft(): RegisterDraftSnapshot | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = globalThis.sessionStorage.getItem(KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as RegisterDraftSnapshot
    if (p?.v !== 1) return null
    return normalizeDraft(p)
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
    return normalizeDraft(p)
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
