'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { compressImage, fileToDataUrl } from '@/lib/image-upload'
import {
  formatLocalMobileInputFromE164,
  formatUruguayanCI,
  isValidUruguayanCI,
  isValidLocalPhoneUY,
  normalizeLocalPhoneUY,
} from '@/lib/uruguay-forms'
import { PasswordVisibilityToggle } from '@/components/PasswordVisibilityToggle'
import {
  isStrongPassword,
  STRONG_PASSWORD_MESSAGE,
  getPasswordStrength,
  getStrengthBarClass,
} from '@/lib/password-strength'
import {
  getOnboardingUsernameStatusDisplay,
  getOnboardingVerificationFieldLabel,
  getOnboardingVerificationMessageClass,
  resolveOnboardingUsernameStatus,
  type OnboardingUsernameStatus,
} from '@/lib/onboarding-form-helpers'
import { getRegisterNationalIdDocumentExpiresAtValidationError } from '@/lib/register-form-validation'

type VerificationEntry = {
  provided: string
  extracted?: string
  message: string
}
type VerificationResults = {
  verification: Record<string, VerificationEntry>
}
type DniValidation = {
  reasons?: string[]
}
type VerifyDniResponse = {
  success: boolean
  verification?: Record<string, VerificationEntry>
  validation?: DniValidation | null
  message?: string
  extractedData?: { nationalIdDocumentExpiresAt?: string }
}

const DNI_REVERIFY_DEBOUNCE_MS = 550

type Me = {
  email: string
  username?: string
  firstName?: string
  lastName?: string
  nationalId?: string
  birthdate?: string
  nationalIdDocumentExpiresAt?: string
  phone?: string
  role: 'ADMIN' | 'STAFF' | 'TEACHER'
  hasPassword: boolean
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
  const [nationalIdDocumentExpiresAt, setNationalIdDocumentExpiresAt] = useState('')
  const [role, setRole] = useState<'STAFF' | 'TEACHER'>('STAFF')
  const [hasPassword, setHasPassword] = useState(true)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [dniFile, setDniFile] = useState<File | null>(null)
  const [dniPreviewUrl, setDniPreviewUrl] = useState('')
  const [processingDni, setProcessingDni] = useState(false)
  const [verificationStep, setVerificationStep] = useState(0)
  const [verificationResults, setVerificationResults] = useState<VerificationResults | null>(null)
  const [dniValidation, setDniValidation] = useState<DniValidation | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const dniFileRef = useRef<File | null>(null)
  const verifySeqRef = useRef(0)
  const identityFieldsRef = useRef({
    firstName,
    lastName,
    nationalId,
    birthdate,
    nationalIdDocumentExpiresAt,
  })
  identityFieldsRef.current = {
    firstName,
    lastName,
    nationalId,
    birthdate,
    nationalIdDocumentExpiresAt,
  }
  useEffect(() => {
    dniFileRef.current = dniFile
  }, [dniFile])

  useEffect(() => {
    api<Me & { needsProfileCompletion: boolean }>('/auth/me')
      .then((data) => {
        setMe(data)
        setHasPassword(!!data.hasPassword)
        setUsername(data.username || '')
        setFirstName(data.firstName || '')
        setLastName(data.lastName || '')
        setNationalId(data.nationalId ? formatUruguayanCI(data.nationalId) : '')
        setBirthdate(data.birthdate ? new Date(data.birthdate).toISOString().split('T')[0] : '')
        setNationalIdDocumentExpiresAt(
          data.nationalIdDocumentExpiresAt
            ? new Date(data.nationalIdDocumentExpiresAt).toISOString().split('T')[0]
            : '',
        )
        setRole(data.role === 'TEACHER' ? 'TEACHER' : 'STAFF')
        setPhoneLocal(formatLocalMobileInputFromE164(data.phone))
      })
      .catch(() => {
        window.location.href = '/login'
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
    const valid = /^[-a-zA-Z0-9_.]{3,30}$/.test(username)
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

  useEffect(() => () => {
    if (dniPreviewUrl) URL.revokeObjectURL(dniPreviewUrl)
  }, [dniPreviewUrl])

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
      } catch {}
    }

    setUsername(`${base}${Date.now().toString().slice(-4)}`)
  }

  function handleNationalIdChange(value: string) {
    setNationalId(formatUruguayanCI(value))
  }

  function verificationHasIssues() {
    if (!verificationResults?.verification) return true
    return Object.values(verificationResults.verification).some((field: any) =>
      String(field?.message || '').includes('✗') || String(field?.message || '').includes('⚠️')
    )
  }

  const runVerifyDniImage = useCallback(async (file: File) => {
    const seq = ++verifySeqRef.current
    const {
      firstName: fn,
      lastName: ln,
      nationalId: ni,
      birthdate: bd,
      nationalIdDocumentExpiresAt: exp,
    } = identityFieldsRef.current

    setProcessingDni(true)
    setVerificationResults(null)
    setDniValidation(null)
    setError('')
    setVerificationStep(1)

    try {
      const compressedImage = await compressImage(file, 0.8, 1024)
      const base64 = await fileToDataUrl(compressedImage)

      const response = await api<VerifyDniResponse>('/auth/verify-step-by-step', {
        method: 'POST',
        body: JSON.stringify({
          image: base64,
          firstName: fn,
          lastName: ln,
          nationalId: ni,
          birthdate: bd,
          nationalIdDocumentExpiresAt: exp,
        }),
      })

      if (seq !== verifySeqRef.current) return

      if (response.success && response.verification) {
        setVerificationResults({ verification: response.verification })
        if (response.extractedData?.nationalIdDocumentExpiresAt) {
          setNationalIdDocumentExpiresAt((prev) => prev || response.extractedData!.nationalIdDocumentExpiresAt!)
        }
        setVerificationStep(5)
      } else {
        setDniValidation(response.validation || null)
        setVerificationStep(0)
        setError(response.message || 'No se pudo verificar el DNI.')
      }
    } catch (err: any) {
      if (seq !== verifySeqRef.current) return
      setDniValidation(err?.data?.validation || null)
      setVerificationStep(0)
      setError(err?.message || 'No se pudo verificar el DNI.')
    } finally {
      if (seq === verifySeqRef.current) setProcessingDni(false)
    }
  }, [])

  async function handleDniUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Selecciona una imagen válida del DNI.')
      return
    }
    if (!firstName || !lastName || !nationalId || !birthdate || !nationalIdDocumentExpiresAt) {
      setError('Completa nombre, apellido, cédula, fecha de nacimiento y vencimiento del DNI antes de verificar.')
      return
    }

    if (dniPreviewUrl) URL.revokeObjectURL(dniPreviewUrl)
    setDniFile(file)
    setDniPreviewUrl(URL.createObjectURL(file))
    await runVerifyDniImage(file)
  }

  useEffect(() => {
    if (!dniFileRef.current) return
    const fields = identityFieldsRef.current
    const f = dniFileRef.current
    if (!f.type.startsWith('image/')) {
      setVerificationResults(null)
      setDniValidation(null)
      return
    }
    if (!fields.firstName || !fields.lastName || !fields.nationalId || !fields.birthdate || !fields.nationalIdDocumentExpiresAt) {
      setVerificationResults(null)
      setDniValidation(null)
      return
    }
    const id = window.setTimeout(() => {
      const file = dniFileRef.current
      if (!file) return
      void runVerifyDniImage(file)
    }, DNI_REVERIFY_DEBOUNCE_MS)
    return () => window.clearTimeout(id)
  }, [firstName, lastName, nationalId, birthdate, nationalIdDocumentExpiresAt, runVerifyDniImage])

  function validate() {
    if (!/^[-a-zA-Z0-9_.]{3,30}$/.test(username)) return 'Usuario inválido.'
    if (usernameStatus === 'taken') return 'Ese nombre de usuario ya existe.'
    if (!isValidUruguayanCI(nationalId)) return 'La cédula no es válida.'
    if (!firstName.trim() || !lastName.trim()) return 'Nombre y apellido son obligatorios.'
    if (!birthdate) return 'La fecha de nacimiento es obligatoria.'
    const expErr = getRegisterNationalIdDocumentExpiresAtValidationError(nationalIdDocumentExpiresAt)
    if (expErr) return expErr
    if (phoneLocal && !isValidLocalPhoneUY(phoneLocal)) {
      return 'Celular inválido. Ingresá 9 dígitos empezando con 09.'
    }
    if (!dniFile || !verificationResults || verificationHasIssues()) return 'Debes verificar tu DNI antes de continuar.'
    if (!hasPassword) {
      if (!isStrongPassword(password)) return STRONG_PASSWORD_MESSAGE
      if (password !== confirm) return 'Las contraseñas no coinciden.'
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
          nationalIdDocumentExpiresAt: new Date(nationalIdDocumentExpiresAt).toISOString(),
          role,
        }),
      })
      if (!hasPassword) {
        await api('/auth/password', { method: 'PUT', body: JSON.stringify({ password }) })
      }
      window.location.href = '/'
    } catch (err: any) {
      if (String(err?.message || '').includes('409')) setError('Usuario o cédula ya registrados.')
      else setError('No se pudo guardar el perfil.')
    } finally {
      setLoading(false)
    }
  }

  if (!me) return null

  const strength = getPasswordStrength(password)
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
            <p className="text-gray-600">Ingresaste con Google. Terminá el alta validando tu DNI y corrigiendo los datos que haga falta.</p>
          </div>

          <div className="mb-6 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Email asociado: <span className="font-semibold">{me.email}</span>
          </div>

          <form onSubmit={onSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Usuario
                  {usernameStatusInfo && <span className={`ml-2 text-xs ${usernameStatusInfo.className}`}>{usernameStatusInfo.text}</span>}
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
                <input value={nationalId} onChange={(e) => handleNationalIdChange(e.target.value)} className="input-field" placeholder="X.XXX.XXX-X" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Fecha de nacimiento</label>
                <input value={birthdate} onChange={(e) => setBirthdate(e.target.value)} type="date" max={new Date().toISOString().split('T')[0]} className="input-field" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Vencimiento del DNI</label>
                <input
                  value={nationalIdDocumentExpiresAt}
                  onChange={(e) => setNationalIdDocumentExpiresAt(e.target.value)}
                  type="date"
                  min="1950-01-01"
                  max="2100-12-31"
                  className="input-field"
                  aria-label="Vencimiento del DNI"
                />
                <p className="text-xs text-gray-500 mt-1">Como figura en el documento (Vencimiento / Validade).</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Celular (Uruguay)</label>
                <div className="flex gap-2 items-center">
                  <span className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-700 select-none text-sm font-medium">+598</span>
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
                  <option value="STAFF">Staff</option>
                  <option value="TEACHER">Teacher</option>
                </select>
              </div>

              {!hasPassword && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Contraseña</label>
                    <div className="relative">
                      <input value={password} onChange={(e) => setPassword(e.target.value)} type={showPwd ? 'text' : 'password'} className="input-field pr-10" placeholder="Mín 8, Aa y 0-9" />
                      <PasswordVisibilityToggle visible={showPwd} onToggle={() => setShowPwd((value) => !value)} />
                    </div>
                    <div className="h-2 bg-gray-200 rounded mt-2">
                      <div className={`${getStrengthBarClass(strength)} h-2 rounded transition-all duration-300`} style={{ width: `${strength}%` }} />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Confirmar contraseña</label>
                    <div className="relative">
                      <input value={confirm} onChange={(e) => setConfirm(e.target.value)} type={showConfirm ? 'text' : 'password'} className="input-field pr-10" />
                      <PasswordVisibilityToggle
                        visible={showConfirm}
                        onToggle={() => setShowConfirm((value) => !value)}
                        field="confirmación"
                      />
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="pt-6 border-t border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Verificación de identidad</h2>
              <p className="text-sm text-gray-600 mb-4">Subí una foto clara del DNI. Se comparan nombre, apellido, cédula, fecha de nacimiento y vencimiento del documento. Si algo viene mal desde Google, podés corregirlo antes de verificar.</p>

              <input
                type="file"
                accept="image/*"
                onChange={handleDniUpload}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-green-50 file:text-green-700 hover:file:bg-green-100"
                disabled={processingDni}
              />

              {dniFile && (
                <div className="mt-4 space-y-3">
                  <p className="text-sm text-gray-600">Archivo seleccionado: <span className="font-medium">{dniFile.name}</span></p>
                  {dniPreviewUrl && (
                    <div className="rounded-xl border border-gray-200 bg-white p-3">
                      <img src={dniPreviewUrl} alt="Vista previa del DNI" className="max-h-72 w-full rounded-lg object-contain" />
                    </div>
                  )}
                </div>
              )}

              {processingDni && (
                <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600" />
                    <div>
                      <p className="text-blue-800 font-medium">Verificando datos con DNI...</p>
                      <p className="text-sm text-blue-600 mt-1">
                        {verificationStep === 1 && 'Comparando nombres y documento'}
                        {verificationStep === 5 && 'Verificación completada'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {verificationResults?.verification && (
                <div className="mt-4 space-y-3">
                  {Object.entries(verificationResults.verification).map(([field, data]) => (
                    <div key={field} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div>
                        <p className="font-medium text-gray-800 capitalize">
                          {getOnboardingVerificationFieldLabel(field)}
                        </p>
                        <p className="text-sm text-gray-600">Ingresado: <span className="font-medium">{data.provided}</span></p>
                        {data.extracted && <p className="text-sm text-gray-600">DNI: <span className="font-medium">{data.extracted}</span></p>}
                      </div>
                      <div className={`text-sm font-medium ${getOnboardingVerificationMessageClass(data.message)}`}>{data.message}</div>
                    </div>
                  ))}
                </div>
              )}

              {dniValidation && (
                <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                  <h3 className="font-medium text-red-800 mb-2">No se pudo validar el DNI</h3>
                  <div className="space-y-1">
                    {dniValidation.reasons?.map((reason) => (
                      <p key={reason} className="text-sm text-red-600">{reason}</p>
                    ))}
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
              <button disabled={loading} className="btn-primary flex-1 disabled:opacity-60">
                {loading ? 'Guardando…' : 'Guardar y enviar a validación'}
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
