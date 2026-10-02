'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api/client'
import PhoneBirthdateFields from '@/components/forms/PhoneBirthdateFields'
import {
  onlyDigits,
  formatUruguayanCI,
  normalizeLocalPhoneUY,
} from '@/lib/forms/uruguay-forms'
import { PasswordVisibilityToggle } from '@/components/common/PasswordVisibilityToggle'
import { loginUrl, logoutUrl } from '@/lib/auth/urls'
import { PASSWORD_MAX_LENGTH, getPasswordStrength, getStrengthBarClass } from '@/lib/auth/password-strength'
import { validateRegisterForm, type RegisterRole } from '@/lib/auth/register-form-validation'
import {
  isRegisterFormComplete,
  validateRegisterFields,
  type RegisterFieldName,
  type RegisterFieldValues,
} from '@/lib/auth/register-field-validation'
import FormField, { fieldInputClass } from '@/components/forms/FormField'
import { Clock } from 'lucide-react'
import { PendingButtonContent } from '@/components/common/PendingButtonContent'

/**
 * Alta en **un solo paso**: se completan los datos y se crea la cuenta.
 *
 * Antes había un segundo paso de revisión porque la prueba de vida con Didit devolvía los datos
 * leídos del documento y había que confirmarlos contra lo declarado. Sin esa verificación, el paso
 * sólo repetía lo que el usuario acababa de escribir. La identidad la controla administración al
 * aprobar la cuenta, que nace pendiente.
 */

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
  const [sessionGate, setSessionGate] = useState(true)
  const [ssoRegistrationToken, setSsoRegistrationToken] = useState<string | null>(null)
  const [ssoEmailLocked, setSsoEmailLocked] = useState(false)
  const [ssoPrefillLoading, setSsoPrefillLoading] = useState(false)
  /** Un campo solo muestra su error después de que el usuario lo tocó (o al intentar avanzar). */
  const [touched, setTouched] = useState<Partial<Record<RegisterFieldName, boolean>>>({})

  useEffect(() => {
    let alive = true
    api('/auth/me')
      .then(() => {
        // Ya hay sesión: no tiene sentido registrarse de nuevo.
        if (alive) globalThis.location.replace('/')
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
  const formComplete = isRegisterFormComplete(fieldValues, { passwordRequired })

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
   * `edutrack.login.autostarted` hay que borrarlo porque si no, la pantalla de login muestra
   * "no pudimos confirmar la sesión" en vez del ingreso.
   */
  function cancelRegistration() {
    try {
      globalThis.sessionStorage.removeItem('edutrack.login.autostarted')
    } catch {
      /* navegador sin sessionStorage */
    }
    const target = '/login?cancelled=1'
    globalThis.location.href = ssoRegistrationToken ? logoutUrl(target) : target
  }

  /** Al intentar enviar se revelan todos los errores pendientes de una vez. */
  function revealAllErrors() {
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
  }

  function validate(): string | null {
    return validateRegisterForm({
      email,
      password,
      confirm,
      nationalId,
      firstName,
      lastName,
      role,
      phoneLocal,
      birthdate,
      passwordRequired: !ssoRegistrationToken,
    })
  }

  const strength = getPasswordStrength(password)

  /** Crea la cuenta. Se dispara desde «Crear cuenta», al enviar el formulario. */
  async function submitRegistration() {
    setError('')
    const v = validate()
    if (v) { setError(v); return }
    setLoading(true)
    try {
      const payload: Record<string, unknown> = {
        email,
        nationalId: onlyDigits(nationalId).length ? formatUruguayanCI(nationalId).replace(/\./g, '').replace('-', '') : undefined,
        firstName,
        lastName,
        phone: phoneLocal ? `+598${normalizeLocalPhoneUY(phoneLocal)}` : undefined,
        birthdate: new Date(birthdate).toISOString(),
        role,
      }
      // Con Google no hay campo de contraseña: la cuenta la crea Keycloak. Mandarla igual, aunque
      // sea vacía, hacía que la API pidiera una contraseña que el usuario no tiene dónde escribir.
      if (ssoRegistrationToken) payload.ssoRegistrationToken = ssoRegistrationToken
      else payload.password = password
      await api('/auth/register', { method: 'POST', body: JSON.stringify(payload) })
      setRegisteredWithSso(Boolean(ssoRegistrationToken))
      setOk(true)
    } catch (e: unknown) {
      const err = e as { status?: number; message?: string; data?: { message?: string } }
      const apiMsg = (typeof err.data?.message === 'string' && err.data.message) || err.message || ''
      const isBareStatus = /^API \d{3}$/i.test(apiMsg.trim())
      if (!isBareStatus && apiMsg) {
        setError(apiMsg)
      } else if (err.status === 409) {
        setError('Ese correo, usuario o cédula ya está registrado.')
      } else {
        setError('No se pudo registrar. Intenta nuevamente.')
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

          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!formComplete) {
                revealAllErrors()
                return
              }
              void submitRegistration()
            }}
            className="space-y-6"
            noValidate
          >
            <p className="text-sm text-gray-600">
              Los campos marcados con <span className="font-semibold text-red-500">*</span> son obligatorios.
            </p>

            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
              <p className="text-sm text-emerald-800 mb-3">También puedes entrar con Google. Después solo vas a completar los datos que falten.</p>
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

            <div className="flex items-start gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
              <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>
                Tu cuenta queda pendiente hasta que administración revise tus datos y la apruebe.
              </p>
            </div>

            <div className="flex gap-4 pt-6 border-t border-gray-200">
              <button
                type="submit"
                className="btn-primary flex-1 justify-center disabled:opacity-60"
                disabled={!formComplete || loading}
              >
                <PendingButtonContent pending={loading} pendingText="Creando cuenta…" idle="Crear cuenta" />
              </button>
              <button
                type="button"
                onClick={cancelRegistration}
                disabled={loading}
                className="btn-secondary flex-1 disabled:opacity-60"
              >
                Cancelar
              </button>
            </div>

            {!formComplete && Object.keys(touched).length > 0 && (
              <p className="text-center text-sm text-gray-500">
                Completá los campos marcados en rojo para crear la cuenta.
              </p>
            )}
          </form>
        </div>
      </div>
    </main>
  )
} 
