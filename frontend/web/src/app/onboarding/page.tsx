'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

type UsernameStatus = 'idle' | 'checking' | 'ok' | 'taken' | 'invalid'
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
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, '')
}

function formatUruguayanCI(input: string) {
  const digits = onlyDigits(input).slice(0, 8)
  if (digits.length <= 1) return digits
  if (digits.length <= 4) return `${digits[0]}.${digits.slice(1)}`
  if (digits.length <= 7) return `${digits[0]}.${digits.slice(1, 4)}.${digits.slice(4)}`
  return `${digits[0]}.${digits.slice(1, 4)}.${digits.slice(4, 7)}-${digits.slice(7)}`
}

function computeCICheckDigit(base7: string) {
  const weights = [2, 9, 8, 7, 6, 3, 4]
  const padded = base7.padStart(7, '0')
  const sum = padded.split('').map((d, i) => parseInt(d, 10) * weights[i]).reduce((a, b) => a + b, 0)
  return (10 - (sum % 10)) % 10
}

function isValidUruguayanCI(input: string) {
  const digits = onlyDigits(input)
  if (digits.length < 7 || digits.length > 8) return false
  const base = digits.slice(0, -1)
  const check = parseInt(digits.slice(-1), 10)
  return computeCICheckDigit(base) === check
}

function normalizeLocalPhoneUY(local: string) {
  const digits = onlyDigits(local)
  if (!digits) return ''
  return digits.startsWith('0') ? digits.slice(1) : digits
}

function isValidLocalPhoneUY(local: string) {
  return /^\d{8}$/.test(normalizeLocalPhoneUY(local))
}

function isStrongPassword(pw: string) {
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(pw)
}

function getPasswordStrength(password: string) {
  if (password.length === 0) return 0
  return isStrongPassword(password) ? 100 : Math.min(75, password.length * 8)
}

function getStrengthBarClass(strength: number) {
  if (strength > 80) return 'bg-emerald-500'
  if (strength > 50) return 'bg-yellow-500'
  return 'bg-red-500'
}

function getUsernameStatus(status: UsernameStatus) {
  switch (status) {
    case 'checking':
      return { text: 'Verificando...', className: 'text-gray-500' }
    case 'ok':
      return { text: 'Disponible', className: 'text-green-600' }
    case 'taken':
      return { text: 'No disponible', className: 'text-red-600' }
    case 'invalid':
      return { text: 'Inválido', className: 'text-red-600' }
    default:
      return null
  }
}

function getVerificationFieldLabel(field: string) {
  switch (field) {
    case 'firstName':
      return 'Nombre'
    case 'lastName':
      return 'Apellido'
    case 'nationalId':
      return 'Cédula'
    default:
      return 'Fecha de nacimiento'
  }
}

function getVerificationMessageClass(message: string) {
  return String(message).includes('✓') ? 'text-green-600' : 'text-red-600'
}

function resolveUsernameStatus(valid: boolean, available: boolean): UsernameStatus {
  if (!valid) return 'invalid'
  return available ? 'ok' : 'taken'
}

type Me = {
  email: string
  username?: string
  firstName?: string
  lastName?: string
  nationalId?: string
  birthdate?: string
  phone?: string
  role: 'ADMIN' | 'STAFF' | 'TEACHER'
  hasPassword: boolean
}

export default function OnboardingPage() {
  const [me, setMe] = useState<Me | null>(null)
  const [username, setUsername] = useState('')
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle')
  const [nationalId, setNationalId] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phoneLocal, setPhoneLocal] = useState('')
  const [birthdate, setBirthdate] = useState('')
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
        setRole(data.role === 'TEACHER' ? 'TEACHER' : 'STAFF')
        const normalizedPhone = onlyDigits(data.phone || '').replace(/^598/, '')
        setPhoneLocal(normalizedPhone)
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
    const valid = /^[a-zA-Z0-9_.-]{3,30}$/.test(username)
    if (!valid) {
      setUsernameStatus('invalid')
      return
    }
    setUsernameStatus('checking')
    const t = setTimeout(async () => {
      try {
        const res = await api<{ available: boolean; valid: boolean }>(`/auth/check-username?u=${encodeURIComponent(username)}`)
        const nextStatus = resolveUsernameStatus(res.valid, res.available)
        setUsernameStatus(nextStatus)
      } catch {
        setUsernameStatus('invalid')
      }
    }, 400)
    return () => clearTimeout(t)
  }, [username])

  useEffect(() => {
    if (!verificationResults) return
    setVerificationResults(null)
    setDniValidation(null)
  }, [firstName, lastName, nationalId, birthdate])

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

  function compressImage(file: File, quality: number, maxWidth: number): Promise<File> {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      const img = new Image()

      img.onload = () => {
        let { width, height } = img
        if (width > maxWidth) {
          height = (height * maxWidth) / width
          width = maxWidth
        }
        canvas.width = width
        canvas.height = height
        ctx?.drawImage(img, 0, 0, width, height)
        canvas.toBlob((blob) => {
          if (!blob) {
            resolve(file)
            return
          }
          resolve(new File([blob], file.name, { type: 'image/jpeg', lastModified: Date.now() }))
        }, 'image/jpeg', quality)
      }

      img.src = URL.createObjectURL(file)
    })
  }

  async function handleDniUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Selecciona una imagen válida del DNI.')
      return
    }
    if (!firstName || !lastName || !nationalId || !birthdate) {
      setError('Completa nombre, apellido, cédula y fecha antes de verificar con el DNI.')
      return
    }

    if (dniPreviewUrl) URL.revokeObjectURL(dniPreviewUrl)
    setDniFile(file)
    setDniPreviewUrl(URL.createObjectURL(file))
    setProcessingDni(true)
    setVerificationResults(null)
    setDniValidation(null)
    setError('')
    setVerificationStep(1)

    try {
      const compressedImage = await compressImage(file, 0.8, 1024)
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result || ''))
        reader.readAsDataURL(compressedImage)
      })

      const response = await api<VerifyDniResponse>('/auth/verify-step-by-step', {
        method: 'POST',
        body: JSON.stringify({
          image: base64,
          firstName,
          lastName,
          nationalId,
          birthdate,
        }),
      })

      if (response.success && response.verification) {
        setVerificationResults({ verification: response.verification })
        setVerificationStep(5)
      } else {
        setDniValidation(response.validation || null)
        setVerificationStep(0)
        setError(response.message || 'No se pudo verificar el DNI.')
      }
    } catch (err: any) {
      setDniValidation(err?.data?.validation || null)
      setVerificationStep(0)
      setError(err?.message || 'No se pudo verificar el DNI.')
    } finally {
      setProcessingDni(false)
    }
  }

  function validate() {
    if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(username)) return 'Usuario inválido.'
    if (usernameStatus === 'taken') return 'Ese nombre de usuario ya existe.'
    if (!isValidUruguayanCI(nationalId)) return 'La cédula no es válida.'
    if (!firstName.trim() || !lastName.trim()) return 'Nombre y apellido son obligatorios.'
    if (!birthdate) return 'La fecha de nacimiento es obligatoria.'
    if (phoneLocal && !isValidLocalPhoneUY(phoneLocal)) return 'Teléfono inválido.'
    if (!dniFile || !verificationResults || verificationHasIssues()) return 'Debes verificar tu DNI antes de continuar.'
    if (!hasPassword) {
      if (!isStrongPassword(password)) return 'La contraseña debe tener 8 caracteres, mayúscula, minúscula y número.'
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
  const usernameStatusInfo = getUsernameStatus(usernameStatus)

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
                <label className="block text-sm font-medium text-gray-700 mb-2">Teléfono</label>
                <div className="flex gap-2 items-center">
                  <span className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-700 select-none text-sm font-medium">+598</span>
                  <input value={phoneLocal} onChange={(e) => setPhoneLocal(e.target.value)} className="input-field flex-1" placeholder="094481122" />
                </div>
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
                      <button type="button" onClick={() => setShowPwd((value) => !value)} className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600">
                        {showPwd ? '🙈' : '👁️'}
                      </button>
                    </div>
                    <div className="h-2 bg-gray-200 rounded mt-2">
                      <div className={`${getStrengthBarClass(strength)} h-2 rounded transition-all duration-300`} style={{ width: `${strength}%` }} />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Confirmar contraseña</label>
                    <div className="relative">
                      <input value={confirm} onChange={(e) => setConfirm(e.target.value)} type={showConfirm ? 'text' : 'password'} className="input-field pr-10" />
                      <button type="button" onClick={() => setShowConfirm((value) => !value)} className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600">
                        {showConfirm ? '🙈' : '👁️'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="pt-6 border-t border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Verificación de identidad</h2>
              <p className="text-sm text-gray-600 mb-4">Subí una foto clara del DNI. Se comparan nombre, apellido, cédula y fecha. Si algo viene mal desde Google, podés corregirlo antes de verificar.</p>

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
                          {getVerificationFieldLabel(field)}
                        </p>
                        <p className="text-sm text-gray-600">Ingresado: <span className="font-medium">{data.provided}</span></p>
                        {data.extracted && <p className="text-sm text-gray-600">DNI: <span className="font-medium">{data.extracted}</span></p>}
                      </div>
                      <div className={`text-sm font-medium ${getVerificationMessageClass(data.message)}`}>{data.message}</div>
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
