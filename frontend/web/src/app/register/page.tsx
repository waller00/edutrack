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
  getRegisterVerificationFieldLabel,
  getRegisterVerificationMessageClass,
  getRegisterVerificationMessageIcon,
  isWarningRegisterVerificationMessage,
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

type DiditFieldVerifyApiResponse = {
  success?: boolean
  message?: string
  verifiedFields?: number
  totalFields?: number
  verification?: RegisterVerificationResults['verification']
}

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
        setIdentityVerificationMethod('didit')
        setError('')
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
        verificationStep: 0,
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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
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
          
          <form onSubmit={onSubmit} className="space-y-6">
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
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">Correo</label>
                <input 
                  value={email} 
                  onChange={e=>setEmail(e.target.value)} 
                  type="email" 
                  required 
                  disabled={ssoEmailLocked}
                  className="input-field"
                  placeholder="tu@correo.com"
                />
              </div>

              {!ssoRegistrationToken && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Contraseña</label>
                    <div className="relative">
                      <input
                        value={password}
                        onChange={e=>setPassword(e.target.value)}
                        type={showPwd?'text':'password'}
                        required
                        className="input-field pr-10"
                        placeholder="Mín 8, Aa y 0-9"
                        maxLength={PASSWORD_MAX_LENGTH}
                      />
                      <PasswordVisibilityToggle visible={showPwd} onToggle={() => setShowPwd((s) => !s)} />
                    </div>
                    <div className="h-2 bg-gray-200 rounded mt-2">
                      <div className={`${getStrengthBarClass(strength)} h-2 rounded transition-all duration-300`} style={{width: `${strength}%`}} />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Confirmar contraseña</label>
                    <div className="relative">
                      <input
                        value={confirm}
                        onChange={e=>setConfirm(e.target.value)}
                        type={showConfirm?'text':'password'}
                        required
                        className="input-field pr-10"
                        placeholder="Repite tu contraseña"
                        maxLength={PASSWORD_MAX_LENGTH}
                      />
                      <PasswordVisibilityToggle
                        visible={showConfirm}
                        onToggle={() => setShowConfirm((s) => !s)}
                        field="confirmación"
                      />
                    </div>
                  </div>
                </>
              )}
              
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Cédula</label>
                <input 
                  value={nationalId} 
                  onChange={e=>handleNationalIdChange(e.target.value)} 
                  placeholder="X.XXX.XXX-X" 
                  className="input-field"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Nombres</label>
                <input 
                  value={firstName} 
                  onChange={e=>setFirstName(e.target.value)} 
                  required 
                  className="input-field"
                  placeholder="Tus nombres"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Apellidos</label>
                <input 
                  value={lastName} 
                  onChange={e=>setLastName(e.target.value)} 
                  required 
                  className="input-field"
                  placeholder="Tus apellidos"
                />
              </div>
              
              <PhoneBirthdateFields
                phoneLocal={phoneLocal}
                birthdate={birthdate}
                onPhoneChange={setPhoneLocal}
                onBirthdateChange={setBirthdate}
                birthdateRequired
              />

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">Perfil</label>
                <select 
                  value={role} 
                  onChange={e=>setRole(e.target.value as RegisterRole)} 
                  className="select-field"
                  required
                >
                  <option value="">Seleccioná un perfil</option>
                  <option value="STAFF">Personal</option>
                  <option value="TEACHER">Docente</option>
                </select>
              </div>
            </div>

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
                <div className="mt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium text-gray-800">Resultados de Verificación:</h4>
                    <div className="flex gap-2 flex-wrap justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          void runDiditFieldVerify()
                        }}
                        className="btn-secondary text-sm px-3 py-1"
                        disabled={
                          identityVerifyBusy ||
                          !(identityVerificationMethod === 'didit' && livenessCheckEnabled && livenessApproved)
                        }
                      >
                        🔄 Volver a Verificar
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setVerificationResults(null)
                          setIdentityVerificationMethod(null)
                          setError('')
                        }}
                        className="btn-secondary text-sm px-3 py-1"
                        disabled={identityVerifyBusy}
                      >
                        ↻ Reiniciar verificación
                      </button>
                    </div>
                  </div>
                  
                  {Object.entries(verificationResults.verification).map(([field, data]) => (
                    <div key={field} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-center space-x-3">
                        <span className="text-xl">
                          {getRegisterVerificationMessageIcon(data.message)}
                        </span>
                        <div>
                          <p className="font-medium text-gray-800 capitalize">
                            {getRegisterVerificationFieldLabel(field)}
                          </p>
                          <p className="text-sm text-gray-600">
                            {field === 'nationalIdDocumentExpiresAt' &&
                            (data.provided === '—' || data.provided === '(OCR)') ? (
                              <span>
                                Origen:{' '}
                                <span className="font-medium">lectura automática</span>
                              </span>
                            ) : (
                              <>
                                Ingresado: <span className="font-medium">{data.provided}</span>
                              </>
                            )}
                          </p>
                          {data.extracted && (
                            <p className="text-sm text-gray-600">
                              Registro muestra:
                              {' '}
                              <span className="font-medium">{data.extracted}</span>
                            </p>
                          )}
                        </div>
                      </div>
                      <div className={`text-sm font-medium ${getRegisterVerificationMessageClass(data.message)}`}>
                        {data.message}
                      </div>
                    </div>
                  ))}
                  
                  <div className="text-center p-3 bg-blue-50 rounded-lg">
                    <p className="text-sm font-medium text-blue-800">
                      Verificación: {verificationResults.verifiedFields}/{verificationResults.totalFields} campos correctos
                    </p>
                    {Object.values(verificationResults.verification).some(isWarningRegisterVerificationMessage) && (
                      <div className="mt-2 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                        <p className="text-sm text-orange-600 font-medium">
                          ⚠️ Completa todos los campos correctamente antes de crear la cuenta
                        </p>
                        <p className="text-xs text-orange-500 mt-1">
                          Corregí los datos y tocá «Volver a Verificar».
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-600 text-sm">{error}</p>
              </div>
            )}
            
            <div className="flex gap-4 pt-6 border-t border-gray-200">
              <button
                disabled={
                  loading ||
                  verificationHasIssues() ||
                  (livenessCheckEnabled && !diditConfiguredOnServer) ||
                  (livenessCheckEnabled && !livenessApproved)
                }
                className="btn-primary flex-1 disabled:opacity-60"
              >
                <PendingButtonContent pending={loading} pendingText="Creando…" idle="Crear cuenta" />
              </button>
              <a href={ssoRegistrationToken ? logoutUrl('/login') : '/login'} className="btn-secondary flex-1 text-center">
                Cancelar
              </a>
            </div>
            
            <div className="mt-6 pt-6 border-t border-gray-200 text-center">
              <p className="text-sm text-gray-500">
                El registro quedó unificado: siempre se valida identidad con DNI y luego un administrador aprueba el alta.
              </p>
            </div>
          </form>
        </div>
      </div>
    </main>
  )
} 
