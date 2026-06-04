'use client'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api } from '@/lib/api/client'
import {
  formatLocalMobileInputFromE164,
  formatUruguayanCI,
  isValidUruguayanCI,
  isValidLocalPhoneUY,
  normalizeLocalPhoneUY,
} from '@/lib/forms/uruguay-forms'
import { PendingButtonContent } from '@/components/common/PendingButtonContent'
import {
  getOnboardingUsernameStatusDisplay,
  resolveOnboardingUsernameStatus,
  type OnboardingUsernameStatus,
} from '@/lib/auth/onboarding-form-helpers'
import {
  getRegisterBirthdateValidationError,
  getRegisterDocumentExpiryVerificationError,
  getRegisterVerificationFieldLabel,
  getRegisterVerificationMessageClass,
  getRegisterVerificationMessageIcon,
  isWarningRegisterVerificationMessage,
  validateRegisterIdentityBeforeVerification,
  REGISTER_USERNAME_REGEX,
  type RegisterVerificationResults,
} from '@/lib/auth/register-form-validation'
import {
  clearOnboardingDraft,
  loadOnboardingDraft,
  saveOnboardingDraft,
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

type Me = {
  email: string
  username?: string
  firstName?: string
  lastName?: string
  nationalId?: string
  birthdate?: string
  phone?: string
  role: 'ADMIN' | 'STAFF' | 'TEACHER'
}

export default function OnboardingPage() {
  const [me, setMe] = useState<Me | null>(null)
  const [username, setUsername] = useState('')
  const [usernameStatus, setUsernameStatus] = useState<OnboardingUsernameStatus>('idle')
  const [nationalId, setNationalId] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phoneLocal, setPhoneLocal] = useState('')
  const [birthdate, setBirthdate] = useState('')
  const [role, setRole] = useState<'STAFF' | 'TEACHER'>('STAFF')
  const [verificationResults, setVerificationResults] = useState<RegisterVerificationResults | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const [livenessCheckEnabled, setLivenessCheckEnabled] = useState(false)
  const [diditConfiguredOnServer, setDiditConfiguredOnServer] = useState(true)
  const [livenessToken, setLivenessToken] = useState<string | null>(null)
  const [livenessApproved, setLivenessApproved] = useState(false)
  const [livenessStarting, setLivenessStarting] = useState(false)
  const [livenessPollError, setLivenessPollError] = useState('')
  const [identityVerificationMethod, setIdentityVerificationMethod] =
    useState<IdentityVerificationMethod>(null)
  const [processingDiditFields, setProcessingDiditFields] = useState(false)

  const onboardingDraftRestoredRef = useRef(false)
  const diditVerifySeqRef = useRef(0)
  const livenessTokenRef = useRef<string | null>(null)
  const identityFieldsRef = useRef({
    email: '',
    firstName,
    lastName,
    nationalId,
    birthdate,
  })
  identityFieldsRef.current = {
    email: me?.email ?? '',
    firstName,
    lastName,
    nationalId,
    birthdate,
  }

  useEffect(() => {
    livenessTokenRef.current = livenessToken
  }, [livenessToken])

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
    if (window.location.origin === targetOrigin) return

    const p = new URLSearchParams(window.location.search)
    const sid = p.get('verificationSessionId') || p.get('session_id') || p.get('vendor_data')
    const approved = (p.get('status') || '').toLowerCase() === 'approved'
    if (!sid && !approved) return

    window.location.replace(`${base}/onboarding${window.location.search}`)
  }, [])

  useEffect(() => {
    api<Me & { needsProfileCompletion: boolean }>('/auth/me')
      .then((data) => {
        setMe(data)
        setUsername(data.username || '')
        setFirstName(data.firstName || '')
        setLastName(data.lastName || '')
        setNationalId(data.nationalId ? formatUruguayanCI(data.nationalId) : '')
        setBirthdate(data.birthdate ? new Date(data.birthdate).toISOString().split('T')[0] : '')
        setRole(data.role === 'TEACHER' ? 'TEACHER' : 'STAFF')
        setPhoneLocal(formatLocalMobileInputFromE164(data.phone))
      })
      .catch(() => {
        window.location.href = '/login'
      })
  }, [])

  useEffect(() => {
    if (!me || onboardingDraftRestoredRef.current) return
    const d = loadOnboardingDraft()
    onboardingDraftRestoredRef.current = true
    if (!d || d.email.trim().toLowerCase() !== me.email.trim().toLowerCase()) return
    setUsername(d.username)
    setNationalId(d.nationalId)
    setFirstName(d.firstName)
    setLastName(d.lastName)
    setPhoneLocal(d.phoneLocal)
    setBirthdate(d.birthdate)
    setRole(d.role === 'TEACHER' ? 'TEACHER' : 'STAFF')
    if (d.verificationResults) setVerificationResults(d.verificationResults)
    if (d.identityVerificationMethod === 'didit') setIdentityVerificationMethod('didit')
  }, [me])

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
          window.sessionStorage.removeItem('edutrack_liveness_token')
        } catch {
          /* */
        }
        return true
      }
    } catch {
      /* poll */
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

  useEffect(() => {
    if (!livenessCheckEnabled || !livenessApproved || !livenessToken) return
    const idErr = validateRegisterIdentityBeforeVerification({
      firstName,
      lastName,
      nationalId,
      birthdate,
    })
    if (idErr) return
    const tid = window.setTimeout(() => {
      void runDiditFieldVerify()
    }, 550)
    return () => clearTimeout(tid)
  }, [
    firstName,
    lastName,
    nationalId,
    birthdate,
    me?.email,
    livenessCheckEnabled,
    livenessApproved,
    livenessToken,
    runDiditFieldVerify,
  ])

  useEffect(() => {
    if (!livenessToken || livenessApproved) return
    const t = window.setInterval(() => {
      void pollLiveness(livenessToken)
    }, 2500)
    return () => window.clearInterval(t)
  }, [livenessToken, livenessApproved, pollLiveness])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const run = () => {
      const p = new URLSearchParams(window.location.search)
      const fromDiditUrl =
        Boolean(p.get('verificationSessionId')) ||
        Boolean(p.get('session_id')) ||
        Boolean(p.get('vendor_data'))
      const hasDiditQuery = p.get('liveness') === '1' || fromDiditUrl

      const fromParams = (
        (p.get('verificationSessionId') || p.get('session_id') || p.get('vendor_data') || '') as string
      ).trim()
      let tok: string | null = fromParams.length > 0 ? fromParams : null
      if (!tok) {
        try {
          tok = window.sessionStorage.getItem('edutrack_liveness_token')
        } catch {
          /* */
        }
      }

      /**
       * Antes cortábamos si no había `liveness=1`/session en la URL y nunca llegábamos al token en
       * sessionStorage. Tras un redirect a `/`/`/register` se pierden los params; reactivamos el token sólo si
       * hay borrador de onboarding (`saveOnboardingDraft` antes de abrir Didit), para no usar tokens viejos.
       */
      if (!tok) return
      if (!hasDiditQuery && !loadOnboardingDraft()) return

      setLivenessToken(tok)
      try {
        window.sessionStorage.setItem('edutrack_liveness_token', tok)
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
    window.addEventListener('focus', run)
    return () => window.removeEventListener('focus', run)
  }, [pollLiveness])

  useEffect(() => {
    if (!firstName.trim() || !lastName.trim() || username) return
    void generateUsername(firstName.trim(), lastName.trim())
  }, [firstName, lastName, username])

  useEffect(() => {
    if (!username) {
      setUsernameStatus('idle')
      return
    }
    const valid = REGISTER_USERNAME_REGEX.test(username)
    if (!valid) {
      setUsernameStatus('invalid')
      return
    }
    setUsernameStatus('checking')
    const t = setTimeout(async () => {
      try {
        const res = await api<{ available: boolean; valid: boolean }>(`/auth/check-username?u=${encodeURIComponent(username)}`)
        const nextStatus = resolveOnboardingUsernameStatus(res.valid, res.available)
        setUsernameStatus(nextStatus)
      } catch {
        setUsernameStatus('invalid')
      }
    }, 400)
    return () => clearTimeout(t)
  }, [username])

  async function generateUsername(first: string, last: string) {
    const normalize = (str: string) =>
      str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, '.')
        .replace(/[^a-z.]/g, '')

    const firstPart = normalize(first)
    const lastParts = normalize(last).split('.').filter(Boolean)
    let base = `${firstPart}.${lastParts[0] || 'usuario'}`
    if (lastParts[1]) base = `${base}.${lastParts[1].charAt(0)}`

    for (let counter = 0; counter <= 999; counter++) {
      const candidate = counter === 0 ? base : `${base}${counter}`
      try {
        const res = await api<{ available: boolean; valid: boolean }>(`/auth/check-username?u=${encodeURIComponent(candidate)}`)
        if (res.available) {
          setUsername(candidate)
          return
        }
      } catch {
        /* */
      }
    }

    setUsername(`${base}${Date.now().toString().slice(-4)}`)
  }

  function handleNationalIdChange(value: string) {
    setNationalId(formatUruguayanCI(value))
  }

  function verificationHasIssues() {
    if (!verificationResults?.verification) return true
    return Object.values(verificationResults.verification).some((field: { message?: string }) =>
      String(field?.message || '').includes('✗') || String(field?.message || '').includes('⚠️'),
    )
  }

  const startDiditLiveness = useCallback(async () => {
    if (!me?.email?.trim()) {
      setLivenessPollError('No hay correo asociado a la sesión.')
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
        body: JSON.stringify({ email: me.email.trim() }),
      })
      setLivenessToken(res.livenessToken)
      setLivenessApproved(false)
      try {
        window.sessionStorage.setItem('edutrack_liveness_token', res.livenessToken)
      } catch {
        /* */
      }

      const draft: RegisterDraftSnapshot = {
        v: 1,
        email: me.email.trim(),
        username,
        nationalId,
        firstName,
        lastName,
        phoneLocal,
        birthdate,
        role,
        verificationStep: 0,
        verificationResults,
        dniValidation: null,
        dniFileName: '',
        dniImageDataUrl: null,
        identityVerificationMethod,
      }
      saveOnboardingDraft(draft)
      window.location.assign(res.verificationUrl)
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
    me?.email,
    username,
    nationalId,
    firstName,
    lastName,
    birthdate,
    phoneLocal,
    role,
    verificationResults,
    identityVerificationMethod,
  ])

  function validate(): string | null {
    if (!REGISTER_USERNAME_REGEX.test(username)) return 'Usuario inválido.'
    if (usernameStatus === 'taken') return 'Ese nombre de usuario ya existe.'
    if (!isValidUruguayanCI(nationalId)) return 'La cédula no es válida.'
    if (!firstName.trim() || !lastName.trim()) return 'Nombre y apellido son obligatorios.'
    const bdErr = getRegisterBirthdateValidationError(birthdate)
    if (bdErr) return bdErr
    if (phoneLocal && !isValidLocalPhoneUY(phoneLocal)) {
      return 'Celular inválido. Ingresá 9 dígitos empezando con 09.'
    }
    if (!livenessCheckEnabled) {
      return 'Por ahora el alta no está disponible sin verificación en línea. Escribinos si necesitás ayuda.'
    }
    if (!verificationResults) return 'Debés confirmar tu identidad antes de continuar.'
    const expErr = getRegisterDocumentExpiryVerificationError(verificationResults)
    if (expErr) return expErr
    if (identityVerificationMethod !== 'didit') {
      return 'Debés confirmar tu identidad con el proceso indicado antes de continuar.'
    }
    if (!livenessApproved) return 'Debés completar la verificación antes de continuar.'
    if (verificationHasIssues()) return 'Corregí los datos que no coinciden o volvé a verificar antes de continuar.'
    return null
  }

  const identityVerifyBusy = processingDiditFields

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    setLoading(true)
    try {
      await api('/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({
          username,
          nationalId,
          firstName,
          lastName,
          phone: phoneLocal ? `+598${normalizeLocalPhoneUY(phoneLocal)}` : undefined,
          birthdate: new Date(birthdate).toISOString(),
          role,
        }),
      })
      clearOnboardingDraft()
      window.location.href = '/'
    } catch (err: unknown) {
      const e = err as { message?: string; status?: number }
      if (String(e?.message || '').includes('409')) setError('Usuario o cédula ya registrados.')
      else setError('No se pudo guardar el perfil.')
    } finally {
      setLoading(false)
    }
  }

  if (!me) return null

  const usernameStatusInfo = getOnboardingUsernameStatusDisplay(usernameStatus)

  return (
    <main className="min-h-screen gradient-light flex items-center justify-center p-4">
      <div className="w-full max-w-3xl">
        <div className="card shadow-modern-lg">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <img src="/logo.svg" alt="EduTrack" className="w-10 h-10" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Completa tu registro</h1>
            <p className="text-gray-600">
              Terminá el alta validando tu identidad con Didit y corrigiendo los datos que haga falta.
            </p>
          </div>

          <div className="mb-6 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Correo asociado: <span className="font-semibold">{me.email}</span>
          </div>

          <form onSubmit={onSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Usuario
                  {usernameStatusInfo && (
                    <span className={`ml-2 text-xs ${usernameStatusInfo.className}`}>{usernameStatusInfo.text}</span>
                  )}
                </label>
                <input value={username} onChange={(e) => setUsername(e.target.value)} className="input-field" placeholder="nombre.apellido" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Nombre</label>
                <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className="input-field" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Apellido</label>
                <input value={lastName} onChange={(e) => setLastName(e.target.value)} className="input-field" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Cédula</label>
                <input
                  value={nationalId}
                  onChange={(e) => handleNationalIdChange(e.target.value)}
                  className="input-field"
                  placeholder="X.XXX.XXX-X"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Fecha de nacimiento</label>
                <input
                  value={birthdate}
                  onChange={(e) => setBirthdate(e.target.value)}
                  type="date"
                  max={new Date().toISOString().split('T')[0]}
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Celular (Uruguay)</label>
                <div className="flex gap-2 items-center">
                  <span className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-700 select-none text-sm font-medium">
                    +598
                  </span>
                  <input
                    value={phoneLocal}
                    onChange={(e) => setPhoneLocal(e.target.value)}
                    className="input-field flex-1"
                    placeholder="094481122"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    aria-describedby="onboarding-phone-hint"
                  />
                </div>
                <p id="onboarding-phone-hint" className="mt-1 text-xs text-gray-500">
                  Solo celular: 9 dígitos comenzando con 09 (no incluyas +598).
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Perfil</label>
                <select value={role} onChange={(e) => setRole(e.target.value as 'STAFF' | 'TEACHER')} className="select-field">
                  <option value="STAFF">Personal</option>
                  <option value="TEACHER">Docente</option>
                </select>
              </div>

            </div>

            <div className="mt-8 pt-6 border-t border-gray-200">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">📷 Verificación de identidad</h3>

              {!livenessCheckEnabled ? (
                <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  El alta con verificación online no está disponible en este entorno por ahora. Si creés que es un error,
                  comunicate con soporte de la institución.
                </div>
              ) : !diditConfiguredOnServer ? (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
                  El alta requiere verificación de identidad (<strong>Didit</strong>), pero el servidor no tiene configurados{' '}
                  <span className="font-mono text-xs">DIDIT_API_KEY</span> y{' '}
                  <span className="font-mono text-xs">DIDIT_WORKFLOW_ID</span>. Contactá a quien opera el servidor.
                </div>
              ) : (
                <>
                  <p className="text-sm text-gray-600 mb-4">
                    Tocá <strong>Verificar identidad</strong> y seguí los pasos en pantalla para mostrar tu cédula y completar la
                    comprobación. Los datos tienen que coincidir con lo que completaste más arriba.
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
                            !me.email.trim() ||
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
                          <PendingButtonContent pending={livenessStarting} pendingText="Iniciando…" idle="Verificar identidad" />
                        </button>
                      </div>
                      {livenessToken && (
                        <p className="text-xs text-amber-800">
                          Esta página espera tu confirmación; si ya terminaste, cerrá cualquier pantalla pendiente del verificador o
                          seguí hasta el resultado.
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
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600" />
                    <div>
                      <p className="text-blue-800 font-medium">Comprobando tus datos contra el resultado verificado…</p>
                    </div>
                  </div>
                </div>
              )}

              {verificationResults && (
                <div className="mt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium text-gray-800">Resultados de verificación</h4>
                    <div className="flex gap-2 flex-wrap justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          void runDiditFieldVerify()
                        }}
                        className="btn-secondary text-sm px-3 py-1"
                        disabled={
                          identityVerifyBusy || !(identityVerificationMethod === 'didit' && livenessCheckEnabled && livenessApproved)
                        }
                      >
                        🔄 Volver a verificar
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
                        <span className="text-xl">{getRegisterVerificationMessageIcon(data.message)}</span>
                        <div>
                          <p className="font-medium text-gray-800 capitalize">{getRegisterVerificationFieldLabel(field)}</p>
                          <p className="text-sm text-gray-600">
                            {field === 'nationalIdDocumentExpiresAt' && (data.provided === '—' || data.provided === '(OCR)') ? (
                              <span>
                                Origen: <span className="font-medium">lectura automática</span>
                              </span>
                            ) : (
                              <>
                                Ingresado: <span className="font-medium">{data.provided}</span>
                              </>
                            )}
                          </p>
                          {data.extracted && (
                            <p className="text-sm text-gray-600">
                              Registro muestra: <span className="font-medium">{data.extracted}</span>
                            </p>
                          )}
                        </div>
                      </div>
                      <div className={`text-sm font-medium ${getRegisterVerificationMessageClass(data.message)}`}>{data.message}</div>
                    </div>
                  ))}

                  <div className="text-center p-3 bg-blue-50 rounded-lg">
                    <p className="text-sm font-medium text-blue-800">
                      Verificación: {verificationResults.verifiedFields}/{verificationResults.totalFields} campos correctos
                    </p>
                    {Object.values(verificationResults.verification).some(isWarningRegisterVerificationMessage) && (
                      <div className="mt-2 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                        <p className="text-sm text-orange-600 font-medium">
                          ⚠️ Completá todos los datos correctamente antes de enviar el alta
                        </p>
                        <p className="text-xs text-orange-500 mt-1">Corregí los datos y tocá «Volver a verificar».</p>
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
                  identityVerifyBusy ||
                  verificationHasIssues() ||
                  (livenessCheckEnabled && !diditConfiguredOnServer) ||
                  (livenessCheckEnabled && !livenessApproved)
                }
                className="btn-primary flex-1 disabled:opacity-60"
              >
                <PendingButtonContent pending={loading} pendingText="Guardando…" idle="Guardar y enviar a validación" />
              </button>
              <a href="/" className="btn-secondary flex-1 text-center">
                Volver
              </a>
            </div>
          </form>
        </div>
      </div>
    </main>
  )
}
