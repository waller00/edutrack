'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api/client'
import {
  formatLocalMobileInputFromE164,
  formatUruguayanCI,
  isValidUruguayanCI,
  isValidLocalPhoneUY,
  normalizeLocalPhoneUY,
} from '@/lib/forms/uruguay-forms'
import { PendingButtonContent } from '@/components/common/PendingButtonContent'
import DateField from '@/components/forms/DateField'
import {
  getOnboardingUsernameStatusDisplay,
  resolveOnboardingUsernameStatus,
  type OnboardingUsernameStatus,
} from '@/lib/auth/onboarding-form-helpers'
import { getRegisterBirthdateValidationError, REGISTER_USERNAME_REGEX } from '@/lib/auth/register-form-validation'

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

/**
 * Completar el perfil: la cuenta existe (p. ej. entró con Google) pero le faltan datos. Se guardan
 * con `PUT /auth/profile`; la identidad la controla administración al aprobar la cuenta.
 */
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
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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
        globalThis.location.href = '/login'
      })
  }, [])

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
        setUsernameStatus(resolveOnboardingUsernameStatus(res.valid, res.available))
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
        .replace(/[̀-ͯ]/g, '')
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
    return null
  }

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
      globalThis.location.href = '/'
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
            <p className="text-gray-600">Completá los datos que faltan. Después un administrador aprueba tu cuenta.</p>
          </div>

          <div className="mb-6 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Correo asociado: <span className="font-semibold">{me.email}</span>
          </div>

          <form onSubmit={onSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <label htmlFor="onboarding-username" className="block text-sm font-medium text-gray-700 mb-2">
                  Usuario
                  {usernameStatusInfo && (
                    <span className={`ml-2 text-xs ${usernameStatusInfo.className}`}>{usernameStatusInfo.text}</span>
                  )}
                </label>
                <input
                  id="onboarding-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="input-field"
                  placeholder="nombre.apellido"
                />
              </div>

              <div>
                <label htmlFor="onboarding-first-name" className="block text-sm font-medium text-gray-700 mb-2">Nombre</label>
                <input id="onboarding-first-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} className="input-field" />
              </div>

              <div>
                <label htmlFor="onboarding-last-name" className="block text-sm font-medium text-gray-700 mb-2">Apellido</label>
                <input id="onboarding-last-name" value={lastName} onChange={(e) => setLastName(e.target.value)} className="input-field" />
              </div>

              <div>
                <label htmlFor="onboarding-national-id" className="block text-sm font-medium text-gray-700 mb-2">Cédula</label>
                <input
                  id="onboarding-national-id"
                  value={nationalId}
                  onChange={(e) => handleNationalIdChange(e.target.value)}
                  className="input-field"
                  placeholder="X.XXX.XXX-X"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Fecha de nacimiento</label>
                <DateField
                  value={birthdate}
                  onChange={setBirthdate}
                  max={new Date().toISOString().split('T')[0]}
                  className="input-field"
                />
              </div>

              <div>
                <label htmlFor="onboarding-phone" className="block text-sm font-medium text-gray-700 mb-2">Celular (Uruguay)</label>
                <div className="flex gap-2 items-center">
                  <span className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-700 select-none text-sm font-medium">
                    +598
                  </span>
                  <input
                    id="onboarding-phone"
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
                <label htmlFor="onboarding-role" className="block text-sm font-medium text-gray-700 mb-2">Perfil</label>
                <select
                  id="onboarding-role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'STAFF' | 'TEACHER')}
                  className="select-field"
                >
                  <option value="STAFF">Personal</option>
                  <option value="TEACHER">Docente</option>
                </select>
              </div>
            </div>

            {error && (
              <div role="alert" className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-600 text-sm">{error}</p>
              </div>
            )}

            <div className="flex gap-4 pt-6 border-t border-gray-200">
              <button disabled={loading} className="btn-primary flex-1 disabled:opacity-60">
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
