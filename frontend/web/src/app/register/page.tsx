'use client'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api } from '@/lib/api/client'
import PhoneBirthdateFields from '@/components/forms/PhoneBirthdateFields'
import {
  onlyDigits,
  formatUruguayanCI,
  normalizeLocalPhoneUY,
  isValidUruguayanCI,
} from '@/lib/forms/uruguay-forms'
import { PasswordVisibilityToggle } from '@/components/common/PasswordVisibilityToggle'
import { PendingButtonContent } from '@/components/common/PendingButtonContent'
import { loginUrl, logoutUrl } from '@/lib/auth/urls'
import { PASSWORD_MAX_LENGTH, getPasswordStrength, getStrengthBarClass } from '@/lib/auth/password-strength'
import {
  validateRegisterIdentityBeforeVerification,
  validateRegisterForm,
  type RegisterRole,
  type RegisterVerificationResults,
} from '@/lib/auth/register-form-validation'
import {
  clearRegisterDraft,
  loadRegisterDraft,
  saveRegisterDraft,
  type RegisterDraftSnapshot,
} from '@/lib/auth/register-draft'
import {
  isRegisterDataStepComplete,
  validateRegisterFields,
  type RegisterFieldName,
  type RegisterFieldValues,
} from '@/lib/auth/register-field-validation'
import FormField, { fieldInputClass } from '@/components/forms/FormField'
import RegisterStepper from '@/components/auth/RegisterStepper'
import RegisterReview from '@/components/auth/RegisterReview'
import type { DiditDocumentFields } from '@/lib/auth/register-review'

type DiditFieldVerifyApiResponse = {
  success?: boolean
  message?: string
  verifiedFields?: number
  totalFields?: number
  verification?: RegisterVerificationResults['verification']
  /** Datos leídos del documento, para el mapeo del paso de revisión. */
  documentFields?: DiditDocumentFields
}

/** Pasos del alta: datos → verificación de identidad → revisión y confirmación. */
const STEP_DATA = 0
const STEP_IDENTITY = 1
const STEP_REVIEW = 2

type IdentityVerificationMethod = 'didit' | null

type SsoRegisterPrefill = {
  email: string
  username?: string
  firstName?: string
  lastName?: string
  name?: string
  emailLocked?: boolean
  provider?: 'google'
}

export default function RegisterPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [nationalId, setNationalId] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phoneLocal, setPhoneLocal] = useState('')
  const [birthdate, setBirthdate] = useState('')
  const [role, setRole] = useState<RegisterRole>('')
  const [error, setError] = useState('')
  const [ok, setOk] = useState(false)
  const [registeredWithSso, setRegisteredWithSso] = useState(false)
  const [loading, setLoading] = useState(false)
  const [verificationResults, setVerificationResults] = useState<RegisterVerificationResults | null>(null)
  const [sessionGate, setSessionGate] = useState(true)
  const [livenessCheckEnabled, setLivenessCheckEnabled] = useState(false)
  const [diditConfiguredOnServer, setDiditConfiguredOnServer] = useState(true)
  const [livenessToken, setLivenessToken] = useState<string | null>(null)
  const [livenessApproved, setLivenessApproved] = useState(false)
  const [livenessStarting, setLivenessStarting] = useState(false)
  const [livenessPollError, setLivenessPollError] = useState('')
  const [identityVerificationMethod, setIdentityVerificationMethod] =
    useState<IdentityVerificationMethod>(null)
  const [processingDiditFields, setProcessingDiditFields] = useState(false)
  const [ssoRegistrationToken, setSsoRegistrationToken] = useState<string | null>(null)
  const [ssoEmailLocked, setSsoEmailLocked] = useState(false)
  const [ssoPrefillLoading, setSsoPrefillLoading] = useState(false)
  const [step, setStep] = useState(STEP_DATA)
  /** Un campo solo muestra su error después de que el usuario lo tocó (o al intentar avanzar). */
  const [touched, setTouched] = useState<Partial<Record<RegisterFieldName, boolean>>>({})
  const [documentFields, setDocumentFields] = useState<DiditDocumentFields | undefined>(undefined)

  const registerDraftRestoredRef = useRef(false)
  const diditVerifySeqRef = useRef(0)
  const livenessTokenRef = useRef<string | null>(null)
  const identityFieldsRef = useRef({
    email,
    firstName,
    lastName,
    nationalId,
    birthdate,
  })
  identityFieldsRef.current = {
    email,
    firstName,
    lastName,
    nationalId,
    birthdate,
  }
  useEffect(() => {
    livenessTokenRef.current = livenessToken
  }, [livenessToken])
  /**
   * Didit abre el callback en HTTPS (ngrok). Si seguís el registro en localhost, sin este salto
   * quedás en otro origen (form vacío, sin DNI). Requiere NEXT_PUBLIC_DIDIT_BROWSER_RETURN_URL.
   * Funciona aunque DIDIT_CALLBACK_URL apunte a …/register (no solo a …/register/didit-return).
   */
  useLayoutEffect(() => {
    if (typeof window === 'undefined') return
    const base = (process.env.NEXT_PUBLIC_DIDIT_BROWSER_RETURN_URL || '').trim().replace(/\/$/, '')
    if (!base) return
    let targetOrigin: string
    try {
      targetOrigin = new URL(base).origin
    } catch {
      return
    }
    if (globalThis.location.origin === targetOrigin) return

    const p = new URLSearchParams(globalThis.location.search)
    const sid = p.get('verificationSessionId') || p.get('session_id') || p.get('vendor_data')
    const approved = (p.get('status') || '').toLowerCase() === 'approved'
    if (!sid && !approved) return

    globalThis.location.replace(`${base}/register${globalThis.location.search}`)
  }, [])

  useEffect(() => {
    if (sessionGate || registerDraftRestoredRef.current) return
    const d = loadRegisterDraft()
    if (!d) return
    registerDraftRestoredRef.current = true
    setEmail(d.email)
    setNationalId(d.nationalId)
    setFirstName(d.firstName)
    setLastName(d.lastName)
    setPhoneLocal(d.phoneLocal)
    setBirthdate(d.birthdate)
    setRole(d.role)
    if (typeof d.password === 'string') setPassword(d.password)
    if (typeof d.confirm === 'string') setConfirm(d.confirm)
    if (d.verificationResults) setVerificationResults(d.verificationResults)
    if (d.identityVerificationMethod === 'didit') setIdentityVerificationMethod('didit')
    // Al volver de Didit el usuario retoma donde estaba, no en el paso 1.
    if (typeof d.verificationStep === 'number' && d.verificationStep >= STEP_DATA && d.verificationStep <= STEP_REVIEW) {
      setStep(d.verificationStep)
    }
  }, [sessionGate])

  useEffect(() => {
    let alive = true
    api('/auth/me')
      .then(() => {
        if (!alive) return
        // Usuario ya logueado (p. ej. Google + onboarding): el callback Didit suele apuntar a /register…
        if (typeof window !== 'undefined') {
          const se = globalThis.location.search
          const qp = new URLSearchParams(se)
          const fromDidit =
            qp.get('liveness') === '1' ||
            Boolean(qp.get('verificationSessionId')?.trim()) ||
            Boolean(qp.get('session_id')?.trim()) ||
            Boolean(qp.get('vendor_data')?.trim())
          if (fromDidit) {
            globalThis.location.replace(`/onboarding${se}`)
            return
          }
        }
        globalThis.location.replace('/')
      })
      .catch(() => {
        if (alive) setSessionGate(false)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (sessionGate || typeof window === 'undefined') return
    const params = new URLSearchParams(globalThis.location.search || '')
    const token = params.get('sso')
    if (!token) return
    let alive = true
    setSsoRegistrationToken(token)
    setSsoPrefillLoading(true)
    api<SsoRegisterPrefill>(`/auth/register/sso?token=${encodeURIComponent(token)}`)
      .then((profile) => {
        if (!alive) return
        setEmail(profile.email || '')
        setFirstName(profile.firstName || '')
        setLastName(profile.lastName || '')
        setSsoEmailLocked(profile.emailLocked !== false)
      })
      .catch((err: unknown) => {
        if (!alive) return
        const e = err as { data?: { message?: string }; message?: string }
        setError(e.data?.message || e.message || 'El registro con Google venció. Iniciá nuevamente.')
        setSsoRegistrationToken(null)
        setSsoEmailLocked(false)
      })
      .finally(() => {
        if (alive) setSsoPrefillLoading(false)
      })
    return () => {
      alive = false
    }
  }, [sessionGate])

  useEffect(() => {
    let alive = true
    api<{ livenessCheckEnabled?: boolean; diditConfigured?: boolean }>('/auth/registration-options')
      .then((o) => {
        if (!alive) return
        setLivenessCheckEnabled(!!o?.livenessCheckEnabled)
        setDiditConfiguredOnServer(o?.diditConfigured !== false)
      })
      .catch(() => {
        if (alive) {
          setLivenessCheckEnabled(false)
          setDiditConfiguredOnServer(false)
        }
      })
    return () => {
      alive = false
    }
  }, [])

  const pollLiveness = useCallback(async (token: string) => {
    try {
      const r = await api<{ status?: string; approved?: boolean; consumed?: boolean; expired?: boolean }>(
        `/auth/liveness/status?token=${encodeURIComponent(token)}`,
      )
      if (r.approved) {
        setLivenessApproved(true)
        setLivenessPollError('')
        return true
      }
      if (r.expired || (r as { status?: string }).status === 'DECLINED' || (r as { status?: string }).status === 'ABANDONED') {
        setLivenessPollError('La prueba de vida no se completó. Iniciá de nuevo.')
        setLivenessToken(null)
        setLivenessApproved(false)
        try {
          globalThis.sessionStorage.removeItem('edutrack_liveness_token')
        } catch { /* no sessionStorage (SSR) */ }
        return true
      }
    } catch {
      /* sigue haciendo poll */
    }
    return false
  }, [])

  const runDiditFieldVerify = useCallback(async () => {
    const token = livenessTokenRef.current
    if (!token) return
    const seq = ++diditVerifySeqRef.current
    setProcessingDiditFields(true)
    setError('')
    try {
      const f = identityFieldsRef.current
      const response = await api<DiditFieldVerifyApiResponse>('/auth/didit/register-field-verify', {
        method: 'POST',
        body: JSON.stringify({
          livenessToken: token,
          email: f.email.trim() ? f.email.trim() : undefined,
          firstName: f.firstName,
          lastName: f.lastName,
          nationalId: f.nationalId,
          birthdate: f.birthdate,
        }),
      })
      if (seq !== diditVerifySeqRef.current) return

      const okFields =
        response.success &&
        response.verification &&
        typeof response.verifiedFields === 'number' &&
        typeof response.totalFields === 'number'
      if (okFields && response.verification) {
        setVerificationResults({
          verification: response.verification,
          verifiedFields: response.verifiedFields ?? 0,
          totalFields: response.totalFields ?? 0,
        })
        setDocumentFields(response.documentFields)
        setIdentityVerificationMethod('didit')
        setError('')
        // Con la comparación lista, el usuario pasa a revisar el mapeo antes de crear la cuenta.
        setStep(STEP_REVIEW)
      } else {
        const msg =
          typeof response.message === 'string'
            ? response.message
            : 'No se pudieron contrastar los datos con la verificación biométrica.'
        setError(msg)
      }
    } catch (err: unknown) {
      if (seq !== diditVerifySeqRef.current) return
      const e = err as { message?: string; data?: { message?: string } }
      const msg =
        (typeof e.data?.message === 'string' && e.data.message) ||
        e.message ||
        'No se pudieron contrastar los datos con Didit.'
      setError(msg)
    } finally {
      if (seq === diditVerifySeqRef.current) setProcessingDiditFields(false)
    }
  }, [])

  /**
   * Tras el redirect de Didit, el primer intento puede dispararse antes de hidratar el borrador (`sessionGate`),
   * enviando nombres vacíos → 400 "Nombre requerido". No debe repetirse solo con `identityVerificationMethod === 'didit'`,
   * porque ese flag solo se setea si el primer verify fue exitoso. Esperamos datos de identidad y debounce igual que al editar campos.
   */
  useEffect(() => {
    if (!livenessCheckEnabled || !livenessApproved || !livenessToken) return
    const idErr = validateRegisterIdentityBeforeVerification({
      firstName,
      lastName,
      nationalId,
      birthdate,
    })
    if (idErr) return
    const tid = globalThis.setTimeout(() => {
      void runDiditFieldVerify()
    }, 550)
    return () => clearTimeout(tid)
  }, [
    firstName,
    lastName,
    nationalId,
    birthdate,
    email,
    livenessCheckEnabled,
    livenessApproved,
    livenessToken,
    runDiditFieldVerify,
  ])

  useEffect(() => {
    if (!livenessToken || livenessApproved) return
    const t = globalThis.setInterval(() => {
      void pollLiveness(livenessToken)
    }, 2500)
    return () => globalThis.clearInterval(t)
  }, [livenessToken, livenessApproved, pollLiveness])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const run = () => {
      const p = new URLSearchParams(globalThis.location.search)
      const fromDiditUrl =
        Boolean(p.get('verificationSessionId')) ||
        Boolean(p.get('session_id')) ||
        Boolean(p.get('vendor_data'))
      const hasDiditQuery = p.get('liveness') === '1' || fromDiditUrl
      const fromParams = (
        (p.get('verificationSessionId') || p.get('session_id') || p.get('vendor_data') || '') as string
      ).trim()
      /** Tras Didit, la redirect trae `verificationSessionId` actual; debe ganar ante un token viejo en sessionStorage. */
      let tok: string | null = fromParams.length > 0 ? fromParams : null
      if (!tok) {
        try {
          tok = globalThis.sessionStorage.getItem('edutrack_liveness_token')
        } catch {
          /* */
        }
      }
      if (!tok) return
      if (!hasDiditQuery && !loadRegisterDraft()) return

      setLivenessToken(tok)
      try {
        globalThis.sessionStorage.setItem('edutrack_liveness_token', tok)
      } catch {
        /* */
      }
      if ((p.get('status') || '').toLowerCase() === 'approved') {
        setLivenessApproved(true)
        setLivenessPollError('')
      }
      void pollLiveness(tok)
    }
    run()
    globalThis.addEventListener('focus', run)
    return () => globalThis.removeEventListener('focus', run)
  }, [pollLiveness])

  // Función para manejar el cambio de cédula con formato automático
  function handleNationalIdChange(value: string) {
    const formatted = formatUruguayanCI(value)
    setNationalId(formatted)
  }

  const fieldValues: RegisterFieldValues = {
    email,
    password,
    confirm,
    nationalId,
    firstName,
    lastName,
    phoneLocal,
    birthdate,
    role,
  }
  const passwordRequired = !ssoRegistrationToken
  const fieldErrors = validateRegisterFields(fieldValues, { passwordRequired })
  const dataStepComplete = isRegisterDataStepComplete(fieldValues, { passwordRequired })

  /** Error a mostrar: solo si el campo fue tocado, para no gritarle al usuario al entrar. */
  function fieldError(field: RegisterFieldName): string | undefined {
    return touched[field] ? fieldErrors[field] : undefined
  }

  function fieldValid(field: RegisterFieldName, value: string): boolean {
    return Boolean(touched[field] && value.trim() && !fieldErrors[field])
  }

  function markTouched(field: RegisterFieldName) {
    setTouched((t) => (t[field] ? t : { ...t, [field]: true }))
  }

  /**
   * Abandona el alta y deja el navegador limpio.
   *
   * No alcanza con navegar a `/login`: si queda el borrador o el token de liveness en
   * sessionStorage, al volver a `/register` el wizard retoma un paso intermedio con
   * datos viejos. Y `edutrack.login.autostarted` hay que borrarlo porque si no, la
   * pantalla de login muestra "no pudimos confirmar la sesión" en vez del ingreso.
   */
  function cancelRegistration() {
    clearRegisterDraft()
    try {
      globalThis.sessionStorage.removeItem('edutrack_liveness_token')
      globalThis.sessionStorage.removeItem('edutrack.login.autostarted')
    } catch {
      /* navegador sin sessionStorage */
    }
    const target = '/login?cancelled=1'
    globalThis.location.href = ssoRegistrationToken ? logoutUrl(target) : target
  }

  function goToIdentityStep() {
    if (!dataStepComplete) {
      // Al intentar avanzar se revelan todos los errores pendientes de una vez.
      setTouched({
        email: true,
        password: true,
        confirm: true,
        nationalId: true,
        firstName: true,
        lastName: true,
        phoneLocal: true,
        birthdate: true,
        role: true,
      })
      return
    }
    setError('')
    setStep(STEP_IDENTITY)
  }

  function verificationHasIssues() {
    if (!verificationResults?.verification) return true
    return Object.values(verificationResults.verification).some((field: any) =>
      String(field?.message || '').includes('✗') || String(field?.message || '').includes('⚠️')
    )
  }

  function validate(): string | null {
    const baseValidation = validateRegisterForm({
      email,
      password,
      confirm,
      nationalId,
      firstName,
      lastName,
      role,
      phoneLocal,
      birthdate,
      verificationResults,
      identityVerificationMethod: identityVerificationMethod ?? undefined,
      livenessCheckEnabled,
      livenessApproved,
      passwordRequired: !ssoRegistrationToken,
    })
    if (baseValidation) return baseValidation
    if (verificationHasIssues()) return 'Debes verificar tu DNI antes de crear la cuenta'
    return null
  }

  const startDiditLiveness = useCallback(async () => {
    if (!email.trim()) {
      setLivenessPollError('Completá tu correo arriba antes de iniciar la prueba de vida.')
      return
    }
    const idErr = validateRegisterIdentityBeforeVerification({
      firstName,
      lastName,
      nationalId,
      birthdate,
    })
    if (idErr) {
      setLivenessPollError(idErr)
      return
    }
    if (!isValidUruguayanCI(nationalId)) {
      setLivenessPollError('La cédula no es válida. Corregila antes de verificar.')
      return
    }
    setLivenessStarting(true)
    setLivenessPollError('')
    try {
      const res = await api<{ livenessToken: string; verificationUrl: string }>('/auth/didit/liveness-session', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim() }),
      })
      setLivenessToken(res.livenessToken)
      setLivenessApproved(false)
      try {
        globalThis.sessionStorage.setItem('edutrack_liveness_token', res.livenessToken)
      } catch { /* */ }

      const draft: RegisterDraftSnapshot = {
        v: 1,
        email: email.trim(),
        username: '',
        nationalId,
        firstName,
        lastName,
        phoneLocal,
        birthdate,
        role,
        password,
        confirm,
        verificationStep: STEP_IDENTITY,
        verificationResults,
        dniValidation: null,
        dniFileName: '',
        dniImageDataUrl: null,
        identityVerificationMethod,
      }
      saveRegisterDraft(draft)
      globalThis.location.assign(res.verificationUrl)
    } catch (e: unknown) {
      const err = e as { data?: { message?: string; details?: string }; message?: string }
      const base =
        (typeof err.data?.message === 'string' && err.data.message) || err.message || 'No se pudo iniciar la verificación.'
      const detail = typeof err.data?.details === 'string' && err.data.details ? ` (${err.data.details})` : ''
      setLivenessPollError(String(base) + detail)
    } finally {
      setLivenessStarting(false)
    }
  }, [
    email,
    password,
    confirm,
    nationalId,
    firstName,
    lastName,
    birthdate,
    phoneLocal,
    role,
    verificationResults,
    identityVerificationMethod,
  ])

  const strength = getPasswordStrength(password)
  const identityVerifyBusy = processingDiditFields

  /** Crea la cuenta. Se dispara desde «Terminar registro» en el paso de revisión. */
  async function submitRegistration() {
    setError('')
    const v = validate()
    if (v) { setError(v); return }
    setLoading(true)
    try {
      const payload: Record<string, unknown> = {
        email,
        password,
        nationalId: onlyDigits(nationalId).length ? formatUruguayanCI(nationalId).replace(/\./g, '').replace('-', '') : undefined,
        firstName,
        lastName,
        phone: phoneLocal ? `+598${normalizeLocalPhoneUY(phoneLocal)}` : undefined,
        birthdate: new Date(birthdate).toISOString(),
        role,
      }
      if (!ssoRegistrationToken) {
        payload.password = password
      } else {
        payload.ssoRegistrationToken = ssoRegistrationToken
      }
      if (livenessCheckEnabled && livenessToken) {
        payload.livenessToken = livenessToken
      }
      await api('/auth/register', { method: 'POST', body: JSON.stringify(payload) })
      setRegisteredWithSso(Boolean(ssoRegistrationToken))
      setOk(true)
      clearRegisterDraft()
    } catch (e: unknown) {
      const err = e as { status?: number; message?: string; data?: { message?: string } }
      const apiMsg = (typeof err.data?.message === 'string' && err.data.message) || err.message || ''
      const isLivenessRejection =
        err.status === 400 &&
        typeof apiMsg === 'string' &&
        /prueba de vida|didit|no aprobada|no válida/i.test(apiMsg)
      if (isLivenessRejection) {
        setLivenessApproved(false)
        setLivenessPollError(apiMsg)
        setLivenessToken(null)
        try {
          globalThis.sessionStorage.removeItem('edutrack_liveness_token')
        } catch { /* */ }
        setError('')
        try {
          const u = new URL(globalThis.location.href)
          ;['status', 'verificationSessionId', 'session_id', 'vendor_data', 'liveness'].forEach((k) =>
            u.searchParams.delete(k),
          )
          const q = u.searchParams.toString()
          globalThis.history.replaceState(null, '', `${u.pathname}${q ? `?${q}` : ''}`)
        } catch { /* */ }
      } else {
        const isBareStatus = /^API \d{3}$/i.test(apiMsg.trim())
        if (!isBareStatus && apiMsg) {
          setError(apiMsg)
        } else if (err.status === 409) {
          setError('Ese correo, usuario o cédula ya está registrado.')
        } else {
          setError('No se pudo registrar. Intenta nuevamente.')
        }
      }
    } finally {
      setLoading(false)
    }
  }

  if (sessionGate) {
    return (
      <main className="min-h-screen gradient-light flex items-center justify-center p-4">
        <p className="text-gray-600">Cargando…</p>
      </main>
    )
  }

  if (ok) {
    return (
      <main className="min-h-screen gradient-light flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="card shadow-modern-lg">
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <img src="/logo.svg" alt="EduTrack" className="w-10 h-10" />
              </div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Registro Exitoso</h1>
              <p className="text-gray-600">
                {registeredWithSso
                  ? 'Tu registro con Google quedó enviado. Espera la aprobación de un administrador para habilitar el acceso completo.'
                  : 'Revisa tu correo y espera la aprobación de un administrador para habilitar el acceso completo.'}
              </p>
            </div>
            <a
              href="/"
              className="btn-primary w-full text-center justify-center"
              onClick={() => {
                // Limpia la marca de auto-login para que /login no muestre el cartel
                // "No pudimos confirmar la sesión" tras un registro recién hecho.
                try {
                  globalThis.sessionStorage.removeItem('edutrack.login.autostarted')
                } catch {
                  // sin acción si el navegador bloquea sessionStorage
                }
              }}
            >
              Ir al inicio
            </a>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen gradient-light flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <div className="card shadow-modern-lg">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <img src="/logo.svg" alt="EduTrack" className="w-10 h-10" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Crear Cuenta</h1>
            <p className="text-gray-600">Completa tus datos para registrarte</p>
          </div>

          <RegisterStepper current={step} />

          {step === STEP_DATA && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              goToIdentityStep()
            }}
            className="space-y-6"
            noValidate
          >
            <p className="text-sm text-gray-600">
              Los campos marcados con <span className="font-semibold text-red-500">*</span> son obligatorios.
            </p>

            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
              <p className="text-sm text-emerald-800 mb-3">También puedes entrar con Google. Después se te pedirá esta misma validación con DNI y completar solo los datos faltantes.</p>
              <button
                type="button"
                onClick={() => { globalThis.location.href = loginUrl('/register', 'google') }}
                className="btn-secondary w-full justify-center"
              >
                Continuar con Google
              </button>
            </div>

            {ssoRegistrationToken && (
              <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
                {ssoPrefillLoading
                  ? 'Trayendo datos de Google…'
                  : 'Completá o corregí tus datos. El correo queda fijado por la cuenta de Google.'}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                id="register-email"
                label="Correo"
                required
                error={fieldError('email')}
                valid={fieldValid('email', email)}
                className="md:col-span-2"
              >
                <input
                  id="register-email"
                  value={email}
                  onChange={e=>setEmail(e.target.value)}
                  onBlur={() => markTouched('email')}
                  type="email"
                  disabled={ssoEmailLocked}
                  aria-required
                  aria-invalid={Boolean(fieldError('email'))}
                  aria-describedby={fieldError('email') ? 'register-email-error' : undefined}
                  className={fieldInputClass('input-field', fieldError('email'), fieldValid('email', email))}
                  placeholder="tu@correo.com"
                />
              </FormField>

              {!ssoRegistrationToken && (
                <>
                  <FormField
                    id="register-password"
                    label="Contraseña"
                    required
                    error={fieldError('password')}
                    valid={fieldValid('password', password)}
                  >
                    <div className="relative">
                      <input
                        id="register-password"
                        value={password}
                        onChange={e=>setPassword(e.target.value)}
                        onBlur={() => markTouched('password')}
                        type={showPwd?'text':'password'}
                        aria-required
                        aria-invalid={Boolean(fieldError('password'))}
                        aria-describedby={fieldError('password') ? 'register-password-error' : undefined}
                        className={fieldInputClass('input-field pr-10', fieldError('password'), fieldValid('password', password))}
                        placeholder="Mín 8, Aa y 0-9"
                        maxLength={PASSWORD_MAX_LENGTH}
                      />
                      <PasswordVisibilityToggle visible={showPwd} onToggle={() => setShowPwd((s) => !s)} />
                    </div>
                    <div className="h-2 bg-gray-200 rounded mt-2">
                      <div className={`${getStrengthBarClass(strength)} h-2 rounded transition-all duration-300`} style={{width: `${strength}%`}} />
                    </div>
                  </FormField>

                  <FormField
                    id="register-confirm"
                    label="Confirmar contraseña"
                    required
                    error={fieldError('confirm')}
                    valid={fieldValid('confirm', confirm)}
                  >
                    <div className="relative">
                      <input
                        id="register-confirm"
                        value={confirm}
                        onChange={e=>setConfirm(e.target.value)}
                        onBlur={() => markTouched('confirm')}
                        type={showConfirm?'text':'password'}
                        aria-required
                        aria-invalid={Boolean(fieldError('confirm'))}
                        aria-describedby={fieldError('confirm') ? 'register-confirm-error' : undefined}
                        className={fieldInputClass('input-field pr-10', fieldError('confirm'), fieldValid('confirm', confirm))}
                        placeholder="Repite tu contraseña"
                        maxLength={PASSWORD_MAX_LENGTH}
                      />
                      <PasswordVisibilityToggle
                        visible={showConfirm}
                        onToggle={() => setShowConfirm((s) => !s)}
                        field="confirmación"
                      />
                    </div>
                  </FormField>
                </>
              )}

              <FormField
                id="register-national-id"
                label="Cédula"
                required
                error={fieldError('nationalId')}
                valid={fieldValid('nationalId', nationalId)}
                hint="Con dígito verificador, como figura en tu documento."
              >
                <input
                  id="register-national-id"
                  value={nationalId}
                  onChange={e=>handleNationalIdChange(e.target.value)}
                  onBlur={() => markTouched('nationalId')}
                  placeholder="X.XXX.XXX-X"
                  inputMode="numeric"
                  aria-required
                  aria-invalid={Boolean(fieldError('nationalId'))}
                  aria-describedby={fieldError('nationalId') ? 'register-national-id-error' : 'register-national-id-hint'}
                  className={fieldInputClass('input-field', fieldError('nationalId'), fieldValid('nationalId', nationalId))}
                />
              </FormField>

              <FormField
                id="register-first-name"
                label="Nombres"
                required
                error={fieldError('firstName')}
                valid={fieldValid('firstName', firstName)}
              >
                <input
                  id="register-first-name"
                  value={firstName}
                  onChange={e=>setFirstName(e.target.value)}
                  onBlur={() => markTouched('firstName')}
                  aria-required
                  aria-invalid={Boolean(fieldError('firstName'))}
                  aria-describedby={fieldError('firstName') ? 'register-first-name-error' : undefined}
                  className={fieldInputClass('input-field', fieldError('firstName'), fieldValid('firstName', firstName))}
                  placeholder="Tus nombres"
                />
              </FormField>

              <FormField
                id="register-last-name"
                label="Apellidos"
                required
                error={fieldError('lastName')}
                valid={fieldValid('lastName', lastName)}
              >
                <input
                  id="register-last-name"
                  value={lastName}
                  onChange={e=>setLastName(e.target.value)}
                  onBlur={() => markTouched('lastName')}
                  aria-required
                  aria-invalid={Boolean(fieldError('lastName'))}
                  aria-describedby={fieldError('lastName') ? 'register-last-name-error' : undefined}
                  className={fieldInputClass('input-field', fieldError('lastName'), fieldValid('lastName', lastName))}
                  placeholder="Tus apellidos"
                />
              </FormField>

              <PhoneBirthdateFields
                phoneLocal={phoneLocal}
                birthdate={birthdate}
                onPhoneChange={setPhoneLocal}
                onBirthdateChange={setBirthdate}
                birthdateRequired
                phoneError={fieldError('phoneLocal')}
                birthdateError={fieldError('birthdate')}
                onPhoneBlur={() => markTouched('phoneLocal')}
                onBirthdateBlur={() => markTouched('birthdate')}
              />

              <FormField
                id="register-role"
                label="Perfil"
                required
                error={fieldError('role')}
                valid={fieldValid('role', role)}
                className="md:col-span-2"
              >
                <select
                  id="register-role"
                  value={role}
                  onChange={e=>{ setRole(e.target.value as RegisterRole); markTouched('role') }}
                  onBlur={() => markTouched('role')}
                  aria-required
                  aria-invalid={Boolean(fieldError('role'))}
                  aria-describedby={fieldError('role') ? 'register-role-error' : undefined}
                  className={fieldInputClass('select-field', fieldError('role'), fieldValid('role', role))}
                >
                  <option value="">Seleccioná un perfil</option>
                  <option value="STAFF">Personal</option>
                  <option value="TEACHER">Docente</option>
                </select>
              </FormField>
            </div>

            {error && (
              <div role="alert" className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-600 text-sm">{error}</p>
              </div>
            )}

            <div className="flex gap-4 pt-6 border-t border-gray-200">
              <button type="submit" className="btn-primary flex-1 disabled:opacity-60" disabled={!dataStepComplete}>
                Continuar
              </button>
              <button type="button" onClick={cancelRegistration} className="btn-secondary flex-1">
                Cancelar
              </button>
            </div>

            {!dataStepComplete && Object.keys(touched).length > 0 && (
              <p className="text-center text-sm text-gray-500">
                Completá los campos marcados en rojo para continuar.
              </p>
            )}

            <div className="mt-6 pt-6 border-t border-gray-200 text-center">
              <p className="text-sm text-gray-500">
                Siempre se valida la identidad con el DNI y luego un administrador aprueba el alta.
              </p>
            </div>
          </form>
          )}

          {step === STEP_IDENTITY && (
          <div className="space-y-6">

            {/* Verificación identidad */}
            <div className="mt-8 pt-6 border-t border-gray-200">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">
                📷 Verificación de identidad
              </h3>

              {!livenessCheckEnabled ? (
                <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  El alta con verificación online no está disponible en este entorno por ahora. Si creés que es un error,
                  comunicate con soporte de la institución.
                </div>
              ) : !diditConfiguredOnServer ? (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
                  El alta requiere verificación de identidad (<strong>Didit</strong>), pero el servidor aún no tiene la
                  clave ni el workflow configurados (
                  <span className="font-mono text-xs">DIDIT_API_KEY</span> /{' '}
                  <span className="font-mono text-xs">DIDIT_WORKFLOW_ID</span>). Contactá a quien opera el servidor.
                </div>
              ) : (
                <>
                  <p className="text-sm text-gray-600 mb-4">
                    Tocá <strong>Verificar identidad</strong> y seguí los pasos en pantalla para mostrar tu cédula y
                    completar la comprobación. Los datos tienen que coincidir con lo que completaste más arriba.
                  </p>
                  {!livenessApproved ? (
                    <div className="space-y-2 mb-4">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            void startDiditLiveness()
                          }}
                          disabled={
                            livenessStarting ||
                            identityVerifyBusy ||
                            !email.trim() ||
                            validateRegisterIdentityBeforeVerification({
                              firstName,
                              lastName,
                              nationalId,
                              birthdate,
                            }) != null ||
                            !isValidUruguayanCI(nationalId)
                          }
                          className="btn-primary"
                        >
                          <PendingButtonContent
                            pending={livenessStarting}
                            pendingText="Iniciando…"
                            idle="Verificar identidad"
                          />
                        </button>
                      </div>
                      {livenessToken && (
                        <p className="text-xs text-amber-800">
                          Esta página espera tu confirmación; si ya terminaste, cerrá cualquier pantalla pendiente del
                          verificador o seguí hasta el resultado.
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="mb-4 space-y-2">
                      <p className="text-sm font-medium text-green-700">
                        Identidad validada correctamente.
                        {processingDiditFields && (
                          <span className="block text-xs font-normal text-gray-600 mt-1">
                            Comprobando que coincidan tus datos declarados…
                          </span>
                        )}
                      </p>
                    </div>
                  )}
                  {livenessPollError && <p className="text-sm text-red-600 mt-2">{livenessPollError}</p>}
                </>
              )}
              
              {identityVerifyBusy && (
                <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                    <div>
                      <p className="text-blue-800 font-medium">Comprobando tus datos contra el resultado verificado…</p>
                    </div>
                  </div>
                </div>
              )}
              
              {verificationResults && (
                <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-sm font-medium text-emerald-800">
                    Comparación lista: {verificationResults.verifiedFields}/{verificationResults.totalFields} campos
                    coinciden con tu documento.
                  </p>
                  <button
                    type="button"
                    onClick={() => setStep(STEP_REVIEW)}
                    className="btn-primary mt-3"
                  >
                    Ver la revisión
                  </button>
                </div>
              )}
            </div>

            {error && (
              <div role="alert" className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-600 text-sm">{error}</p>
              </div>
            )}

            <div className="flex gap-4 pt-6 border-t border-gray-200">
              <button
                type="button"
                onClick={() => { setError(''); setStep(STEP_DATA) }}
                className="btn-secondary flex-1"
                disabled={identityVerifyBusy || livenessStarting}
              >
                Volver a mis datos
              </button>
              {/* Sin esto el paso queda sin salida cuando la verificación no está disponible. */}
              <button
                type="button"
                onClick={cancelRegistration}
                className="btn-secondary flex-1"
                disabled={identityVerifyBusy || livenessStarting}
              >
                Cancelar registro
              </button>
            </div>
          </div>
          )}

          {step === STEP_REVIEW && (
            <RegisterReview
              verificationResults={verificationResults}
              documentFields={documentFields}
              account={{
                email,
                phone: phoneLocal ? `+598 ${phoneLocal}` : '',
                roleLabel: role === 'TEACHER' ? 'Docente' : role === 'STAFF' ? 'Personal' : '—',
              }}
              submitting={loading}
              onBack={() => { setError(''); setStep(STEP_DATA) }}
              onCancel={cancelRegistration}
              onConfirm={() => { void submitRegistration() }}
            />
          )}

          {step === STEP_REVIEW && error && (
            <div role="alert" className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}
        </div>
      </div>
    </main>
  )
} 
