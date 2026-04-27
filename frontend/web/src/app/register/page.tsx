'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import PhoneBirthdateFields from '@/components/PhoneBirthdateFields'
import {
  onlyDigits,
  formatUruguayanCI,
  normalizeLocalPhoneUY,
} from '@/lib/uruguay-forms'
import { PasswordVisibilityToggle } from '@/components/PasswordVisibilityToggle'
import { Lightbulb } from 'lucide-react'
import { PendingButtonContent } from '@/components/PendingButtonContent'
import { getPasswordStrength, getStrengthBarClass } from '@/lib/password-strength'
import { compressImage, fileToDataUrl } from '@/lib/image-upload'
import {
  getRegisterDniProcessingErrorMessage,
  getRegisterVerificationFieldLabel,
  getRegisterVerificationMessageClass,
  getRegisterVerificationMessageIcon,
  isWarningRegisterVerificationMessage,
  resolveRegisterUsernameStatus,
  validateRegisterDniUploadInput,
  validateRegisterForm,
  type RegisterRole,
  type RegisterUsernameStatus,
  type RegisterVerificationResults,
} from '@/lib/register-form-validation'

type DniValidation = {
  confidence: number
  reasons: string[]
}

type ProcessDniResponse = {
  success: boolean
  data: {
    firstName: string
    lastName: string
    nationalId: string
    birthdate: string
    nationalIdDocumentExpiresAt?: string
  }
  message: string
}

type VerifyDniResponse = {
  success: boolean
  message?: string
  validation?: DniValidation
  verifiedFields?: number
  totalFields?: number
  verification?: RegisterVerificationResults['verification']
  extractedData?: { nationalIdDocumentExpiresAt?: string }
}

const DNI_REVERIFY_DEBOUNCE_MS = 550

export default function RegisterPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [username, setUsername] = useState('')
  const [usernameStatus, setUsernameStatus] = useState<RegisterUsernameStatus>('idle')
  const [nationalId, setNationalId] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phoneLocal, setPhoneLocal] = useState('')
  const [birthdate, setBirthdate] = useState('')
  const [nationalIdDocumentExpiresAt, setNationalIdDocumentExpiresAt] = useState('')
  const [role, setRole] = useState<RegisterRole>('')
  const [error, setError] = useState('')
  const [ok, setOk] = useState(false)
  const [loading, setLoading] = useState(false)
  const [dniFile, setDniFile] = useState<File | null>(null)
  const [dniPreviewUrl, setDniPreviewUrl] = useState('')
  const [processingDni, setProcessingDni] = useState(false)
  const [verificationStep, setVerificationStep] = useState(0) // 0: not started, 1: names, 2: surnames, 3: id, 4: birthdate, 5: complete
  const [verificationResults, setVerificationResults] = useState<RegisterVerificationResults | null>(null)
  const [dniValidation, setDniValidation] = useState<DniValidation | null>(null)
  const [sessionGate, setSessionGate] = useState(true)
  const [livenessCheckEnabled, setLivenessCheckEnabled] = useState(false)
  const [livenessToken, setLivenessToken] = useState<string | null>(null)
  const [livenessApproved, setLivenessApproved] = useState(false)
  const [livenessStarting, setLivenessStarting] = useState(false)
  const [livenessPollError, setLivenessPollError] = useState('')

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
    let alive = true
    api('/auth/me')
      .then(() => {
        if (alive) window.location.replace('/')
      })
      .catch(() => {
        if (alive) setSessionGate(false)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    api<{ livenessCheckEnabled?: boolean }>('/auth/registration-options')
      .then((o) => {
        if (alive) setLivenessCheckEnabled(!!o?.livenessCheckEnabled)
      })
      .catch(() => {
        if (alive) setLivenessCheckEnabled(false)
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
        } catch { /* no sessionStorage (SSR) */ }
        return true
      }
    } catch {
      /* sigue haciendo poll */
    }
    return false
  }, [])

  useEffect(() => {
    if (!livenessToken || livenessApproved) return
    const t = window.setInterval(() => {
      void pollLiveness(livenessToken)
    }, 2500)
    return () => window.clearInterval(t)
  }, [livenessToken, livenessApproved, pollLiveness])

  const lastEmailForLivenessRef = useRef<string | null>(null)
  useEffect(() => {
    if (!livenessCheckEnabled) {
      lastEmailForLivenessRef.current = email
      return
    }
    const prev = lastEmailForLivenessRef.current
    if (prev != null && prev !== email && (livenessToken != null || livenessApproved)) {
      setLivenessToken(null)
      setLivenessApproved(false)
      setLivenessPollError('Cambiaste el email: volvé a hacer la prueba de vida con el nuevo correo.')
      try {
        window.sessionStorage.removeItem('edutrack_liveness_token')
      } catch { /* */ }
    }
    lastEmailForLivenessRef.current = email
  }, [email, livenessCheckEnabled, livenessToken, livenessApproved])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const run = () => {
      const p = new URLSearchParams(window.location.search)
      if (p.get('liveness') !== '1') return
      let tok: string | null = null
      try {
        tok = window.sessionStorage.getItem('edutrack_liveness_token')
      } catch { /* */ }
      if (tok) {
        setLivenessToken(tok)
        void pollLiveness(tok)
      }
    }
    run()
    window.addEventListener('focus', run)
    return () => window.removeEventListener('focus', run)
  }, [pollLiveness])

  // Función para manejar el cambio de cédula con formato automático
  function handleNationalIdChange(value: string) {
    const formatted = formatUruguayanCI(value)
    setNationalId(formatted)
  }

  async function processDniImage(file: File) {
    setProcessingDni(true)
    setError('')
    
    try {
      console.log('Starting DNI processing for file:', file.name, file.size);
      
      // Compress image before sending
      const compressedImage = await compressImage(file, 0.8, 1024); // 80% quality, max 1024px width
      console.log('Compressed image size:', compressedImage.size);
      
      // Convert file to base64
      const base64 = await fileToDataUrl(compressedImage)

      console.log('Base64 length:', base64.length);

      // Call OCR API (we'll implement this endpoint)
      const response = await api<ProcessDniResponse>('/auth/process-dni', {
        method: 'POST',
        body: JSON.stringify({ image: base64 })
      })

      console.log('DNI processing response:', response);

      if (response.success) {
        const { firstName: extractedFirstName, lastName: extractedLastName, nationalId: extractedNationalId, birthdate: extractedBirthdate } = response.data
        
        console.log('Extracted data:', { extractedFirstName, extractedLastName, extractedNationalId, extractedBirthdate });
        
        // Fill the form fields
        if (extractedFirstName) setFirstName(extractedFirstName)
        if (extractedLastName) setLastName(extractedLastName)
        if (extractedNationalId) handleNationalIdChange(extractedNationalId)
        if (extractedBirthdate) setBirthdate(extractedBirthdate)
        if (response.data.nationalIdDocumentExpiresAt)
          setNationalIdDocumentExpiresAt(response.data.nationalIdDocumentExpiresAt)

        setError('✅ Datos extraídos correctamente del DNI')
      } else {
        setError('❌ No se pudieron extraer los datos del DNI. Por favor, completa los campos manualmente.')
      }
    } catch (error: any) {
      console.error('Error processing DNI:', error)
      console.error('Error details:', error.message, error.stack)
      setError(getRegisterDniProcessingErrorMessage(error))
    } finally {
      setProcessingDni(false)
    }
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
    setError('')
    setVerificationStep(1)
    setVerificationResults(null)
    setDniValidation(null)

    try {
      console.log('Starting DNI verification with context...')

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

      console.log('Verification Response:', response)

      if (seq !== verifySeqRef.current) return

      if (response.success && response.verification && typeof response.verifiedFields === 'number' && typeof response.totalFields === 'number') {
        setVerificationResults({
          verification: response.verification,
          verifiedFields: response.verifiedFields,
          totalFields: response.totalFields,
        })
        if (response.extractedData?.nationalIdDocumentExpiresAt) {
          setNationalIdDocumentExpiresAt((prev) => prev || response.extractedData!.nationalIdDocumentExpiresAt!)
        }
        setVerificationStep(5)
        setError('')
      } else {
        if (response.validation) {
          setError(`❌ ${response.message}`)
          setDniValidation(response.validation)
          setVerificationStep(0)
          console.log('DNI Validation Failed:', response.validation)
        } else {
          setError(response.message || 'Error al verificar el DNI.')
          setVerificationStep(0)
        }
      }
    } catch (err: any) {
      console.error('Error during DNI verification:', err)
      if (seq !== verifySeqRef.current) return

      if (err.status === 400) {
        const errorData = err.data
        if (errorData && errorData.validation) {
          setError(`❌ ${errorData.message || 'La imagen no parece ser un DNI uruguayo válido'}`)
          setDniValidation(errorData.validation)
        } else {
          setError(`❌ ${err.message || 'La imagen no parece ser un DNI uruguayo válido'}`)
        }
      } else {
        setError(err.message || 'Error al verificar el DNI.')
      }
      setVerificationStep(0)
    } finally {
      if (seq === verifySeqRef.current) setProcessingDni(false)
    }
  }, [])

  async function handleDniUpload(event: React.ChangeEvent<HTMLInputElement>) { // NOSONAR preserve current verification flow
    const file = event.target.files?.[0]
    const validationError = validateRegisterDniUploadInput({
      file,
      firstName,
      lastName,
      nationalId,
      birthdate,
      nationalIdDocumentExpiresAt,
    })
    if (validationError === 'missing-file') return
    if (validationError) {
      setError(validationError)
      return
    }
    if (!file) return

    if (dniPreviewUrl) URL.revokeObjectURL(dniPreviewUrl)
    setDniFile(file)
    setDniPreviewUrl(URL.createObjectURL(file))
    await runVerifyDniImage(file)
  }

  // Generate username automatically from firstName and lastName
  useEffect(() => {
    if (firstName.trim() && lastName.trim()) {
      generateUsername(firstName.trim(), lastName.trim())
    }
  }, [firstName, lastName])

  async function generateUsername(firstName: string, lastName: string) {
    // Normalize names: remove accents, convert to lowercase, replace spaces with dots
    const normalize = (str: string) => str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove accents
      .toLowerCase()
      .replace(/\s+/g, '.') // Replace spaces with dots
      .replace(/[^a-z.]/g, '') // Remove non-letters except dots

    const normalizedFirst = normalize(firstName)
    const normalizedLast = normalize(lastName)
    
    // Split lastName into parts
    const lastParts = normalizedLast.split('.')
    const firstLastName = lastParts[0]
    const secondLastName = lastParts[1] || ''
    
    // Generate base username: firstname.lastname
    let baseUsername = `${normalizedFirst}.${firstLastName}`
    
    // If second lastname exists, try: firstname.lastname.firstletterofsecondlastname
    if (secondLastName) {
      baseUsername = `${normalizedFirst}.${firstLastName}.${secondLastName.charAt(0)}`
    }
    
    // Check if base username is available
    try {
      const res = await api<{available:boolean; valid:boolean}>(`/auth/check-username?u=${encodeURIComponent(baseUsername)}`)
      if (res.available) {
        setUsername(baseUsername)
        return
      }
    } catch {}
    
    // If not available, try with numbers: 1, 2, 3, etc.
    let counter = 1
    while (counter <= 999) {
      const usernameWithNumber = `${baseUsername}${counter}`
      try {
        const res = await api<{available:boolean; valid:boolean}>(`/auth/check-username?u=${encodeURIComponent(usernameWithNumber)}`)
        if (res.available) {
          setUsername(usernameWithNumber)
          return
        }
      } catch {}
      counter++
    }
    
    // Fallback: use timestamp
    const fallbackUsername = `${baseUsername}${Date.now().toString().slice(-4)}`
    setUsername(fallbackUsername)
  }

  // check username availability with debounce
  useEffect(() => {
    if (!username) { setUsernameStatus('idle'); return }
    const valid = /^[-a-zA-Z0-9_.]{3,30}$/.test(username)
    if (!valid) { setUsernameStatus('invalid'); return }
    setUsernameStatus('checking')
    const t = setTimeout(async () => {
      try {
        const res = await api<{available:boolean; valid:boolean}>(`/auth/check-username?u=${encodeURIComponent(username)}`)
        const nextStatus = resolveRegisterUsernameStatus(res.valid, res.available)
        setUsernameStatus(nextStatus)
      } catch { setUsernameStatus('invalid') }
    }, 400)
    return () => clearTimeout(t)
  }, [username])

  useEffect(() => {
    if (!dniFileRef.current) return
    const fields = identityFieldsRef.current
    const validationError = validateRegisterDniUploadInput({
      file: dniFileRef.current,
      ...fields,
    })
    if (validationError && validationError !== 'missing-file') {
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
      username,
      usernameStatus,
      nationalId,
      firstName,
      lastName,
      role,
      phoneLocal,
      birthdate,
      nationalIdDocumentExpiresAt,
      dniFile,
      verificationResults,
      livenessCheckEnabled,
      livenessApproved,
    })
    if (baseValidation) return baseValidation
    if (verificationHasIssues()) return 'Debes verificar tu DNI antes de crear la cuenta'
    return null
  }

  const startDiditLiveness = useCallback(async () => {
    if (!email.trim()) {
      setLivenessPollError('Completá tu email arriba antes de iniciar la prueba de vida.')
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
        window.sessionStorage.setItem('edutrack_liveness_token', res.livenessToken)
      } catch { /* */ }
      window.open(res.verificationUrl, '_blank', 'noopener,noreferrer')
    } catch (e: unknown) {
      const err = e as { data?: { message?: string }; message?: string }
      const msg = (typeof err.data?.message === 'string' && err.data.message) || err.message || 'No se pudo iniciar la verificación.'
      setLivenessPollError(String(msg))
    } finally {
      setLivenessStarting(false)
    }
  }, [email])

  const strength = getPasswordStrength(password)

  const dniBlockOk = Boolean(verificationResults && !verificationHasIssues())
  const showLiveness = livenessCheckEnabled && dniBlockOk

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
        username,
        nationalId: onlyDigits(nationalId).length ? formatUruguayanCI(nationalId).replace(/\./g, '').replace('-', '') : undefined,
        firstName,
        lastName,
        phone: phoneLocal ? `+598${normalizeLocalPhoneUY(phoneLocal)}` : undefined,
        birthdate: new Date(birthdate).toISOString(),
        nationalIdDocumentExpiresAt: new Date(nationalIdDocumentExpiresAt).toISOString(),
        role,
      }
      if (livenessCheckEnabled && livenessToken) {
        payload.livenessToken = livenessToken
      }
      await api('/auth/register', { method: 'POST', body: JSON.stringify(payload) })
      setOk(true)
    } catch (e: unknown) {
      const err = e as { status?: number; message?: string; data?: { message?: string } }
      const apiMsg = (typeof err.data?.message === 'string' && err.data.message) || err.message || ''
      const isBareStatus = /^API \d{3}$/i.test(apiMsg.trim())
      if (!isBareStatus && apiMsg) {
        setError(apiMsg)
      } else if (err.status === 409) {
        setError('Ese email, usuario o cédula ya está registrado.')
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
              <p className="text-gray-600">Revisa tu correo y espera la aprobación de un administrador para habilitar el acceso completo.</p>
            </div>
            <a href="/" className="btn-primary w-full text-center justify-center">
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
                onClick={() => { window.location.href = `${process.env.NEXT_PUBLIC_API_URL}/auth/google` }}
                className="btn-secondary w-full justify-center"
              >
                Continuar con Google
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                <input 
                  value={email} 
                  onChange={e=>setEmail(e.target.value)} 
                  type="email" 
                  required 
                  className="input-field"
                  placeholder="tu@email.com"
                />
              </div>
              
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Usuario
                  {usernameStatus === 'checking' && <span className="ml-2 text-xs text-gray-500">Verificando...</span>}
                  {usernameStatus === 'ok' && <span className="ml-2 text-xs text-green-600">✓ Disponible</span>}
                  {usernameStatus === 'taken' && <span className="ml-2 text-xs text-red-600">✗ No disponible</span>}
                  {usernameStatus === 'invalid' && <span className="ml-2 text-xs text-red-600">✗ Inválido</span>}
                </label>
                <input 
                  value={username} 
                  onChange={e=>setUsername(e.target.value)} 
                  type="text" 
                  required 
                  className="input-field"
                  placeholder="nombre.apellido"
                  pattern="^[-a-zA-Z0-9_.]{3,30}$"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Se genera automáticamente, pero puedes editarlo (3-30 caracteres, letras, números, punto, guion)
                </p>
              </div>
              
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
                  />
                  <PasswordVisibilityToggle
                    visible={showConfirm}
                    onToggle={() => setShowConfirm((s) => !s)}
                    field="confirmación"
                  />
                </div>
              </div>
              
              
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

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Vencimiento del DNI</label>
                <input
                  value={nationalIdDocumentExpiresAt}
                  onChange={(e) => setNationalIdDocumentExpiresAt(e.target.value)}
                  type="date"
                  min="1950-01-01"
                  max="2100-12-31"
                  className="input-field"
                  required
                  aria-label="Vencimiento del DNI"
                />
              
              </div>
              
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">Perfil</label>
                <select 
                  value={role} 
                  onChange={e=>setRole(e.target.value as RegisterRole)} 
                  className="select-field"
                  required
                >
                  <option value="">Selecciona un perfil</option>
                  <option value="STAFF">Staff</option>
                  <option value="TEACHER">Teacher</option>
                </select>
              </div>
            </div>

            {/* DNI Verification Section */}
            <div className="mt-8 pt-6 border-t border-gray-200">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">📷 Verificación con DNI</h3>
              <p className="text-sm text-gray-600 mb-4">
                Sube una foto clara de tu DNI para verificar que los datos ingresados coincidan
              </p>
              
              <input
                type="file"
                accept="image/*"
                onChange={handleDniUpload}
                className="block w-full text-sm text-gray-500
                  file:mr-4 file:py-2 file:px-4
                  file:rounded-full file:border-0
                  file:text-sm file:font-semibold
                  file:bg-green-50 file:text-green-700
                  hover:file:bg-green-100"
                disabled={processingDni}
              />
              
              {dniFile && (
                <div className="mt-2 space-y-3">
                  <p className="text-sm text-gray-600">
                    Archivo seleccionado: <span className="font-medium">{dniFile.name}</span>
                  </p>
                  {dniPreviewUrl && (
                    <div className="rounded-xl border border-gray-200 bg-white p-3">
                      <img
                        src={dniPreviewUrl}
                        alt="Vista previa del DNI"
                        className="max-h-72 w-full rounded-lg object-contain"
                      />
                    </div>
                  )}
                </div>
              )}
              
              {/* Verification Progress */}
              {processingDni && (
                <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                    <div>
                      <p className="text-blue-800 font-medium">Verificando datos con DNI...</p>
                      <div className="text-sm text-blue-600 mt-1">
                        {verificationStep === 1 && "🔍 Verificando nombres..."}
                        {verificationStep === 2 && "🔍 Verificando apellidos..."}
                        {verificationStep === 3 && "🔍 Verificando cédula..."}
                        {verificationStep === 4 && "🔍 Verificando fecha de nacimiento..."}
                        {verificationStep === 5 && "✅ Verificación completada"}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Verification Results */}
              {verificationResults && (
                <div className="mt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium text-gray-800">Resultados de Verificación:</h4>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          if (dniFile) handleDniUpload({ target: { files: [dniFile] } } as unknown as React.ChangeEvent<HTMLInputElement>)
                        }}
                        className="btn-secondary text-sm px-3 py-1"
                        disabled={processingDni || !dniFile}
                      >
                        🔄 Volver a Verificar
                      </button>
                      <button
                        onClick={() => {
                          if (dniPreviewUrl) URL.revokeObjectURL(dniPreviewUrl);
                          setDniFile(null);
                          setDniPreviewUrl('');
                          setVerificationResults(null);
                          setVerificationStep(0);
                          setDniValidation(null);
                          setError('');
                        }}
                        className="btn-secondary text-sm px-3 py-1"
                        disabled={processingDni}
                      >
                        📷 Cambiar Imagen
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
                            Ingresado: <span className="font-medium">{data.provided}</span>
                          </p>
                          {data.extracted && (
                            <p className="text-sm text-gray-600">
                              DNI muestra: <span className="font-medium">{data.extracted}</span>
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
                          Puedes corregir los datos manualmente y usar &quot;Volver a Verificar&quot; para reprocesar la imagen
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {showLiveness && (
              <div className="mt-8 pt-6 border-t border-amber-200">
                <h3 className="text-lg font-semibold text-gray-800 mb-2">Prueba de vida (Didit)</h3>
                <p className="text-sm text-gray-600 mb-4">
                  El administrador requiere una verificación biométrica. Se abre Didit en otra pestaña; cuando termines, volvé acá. La comprobación se actualiza sola, o usá &quot;Ya terminé&quot;.
                </p>
                {livenessApproved ? (
                  <p className="text-sm font-medium text-green-700">Prueba de vida aprobada. Podés crear la cuenta.</p>
                ) : (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          void startDiditLiveness()
                        }}
                        disabled={livenessStarting}
                        className="btn-primary"
                      >
                        <PendingButtonContent
                          pending={livenessStarting}
                          pendingText="Iniciando…"
                          idle="Iniciar prueba de vida (Didit)"
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (livenessToken) void pollLiveness(livenessToken)
                        }}
                        className="btn-secondary text-sm"
                        disabled={!livenessToken}
                      >
                        Ya terminé: comprobar
                      </button>
                    </div>
                    {livenessToken && !livenessApproved && (
                      <p className="text-xs text-amber-800">
                        Esperando confirmación de Didit (la página consulta en segundo plano)…
                      </p>
                    )}
                  </div>
                )}
                {livenessPollError && <p className="text-sm text-red-600 mt-2">{livenessPollError}</p>}
              </div>
            )}

            {/* DNI Validation Details */}
            {dniValidation && (
              <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                <h4 className="font-medium text-red-800 mb-3">🔍 Validación del DNI</h4>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-red-700">Confianza:</span>
                    <span className={`text-sm font-bold ${
                      dniValidation.confidence >= 60 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {dniValidation.confidence}%
                    </span>
                  </div>
                  <div className="space-y-1">
                    {dniValidation.reasons.map((reason) => (
                      <p key={reason} className="text-xs text-red-600">{reason}</p>
                    ))}
                  </div>
                  <div className="mt-3 pt-2 border-t border-red-200">
                    <p className="flex items-start gap-1.5 text-xs text-red-500">
                      <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span>
                        <strong>Sugerencia:</strong> Asegúrate de subir una foto clara de un DNI uruguayo real, no un
                        formulario o imagen de prueba.
                      </span>
                    </p>
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-600 text-sm">{error}</p>
              </div>
            )}
            
            <div className="flex gap-4 pt-6 border-t border-gray-200">
              <button
                disabled={loading || verificationHasIssues() || (livenessCheckEnabled && !livenessApproved)}
                className="btn-primary flex-1 disabled:opacity-60"
              >
                <PendingButtonContent pending={loading} pendingText="Creando…" idle="Crear cuenta" />
              </button>
              <a href="/login" className="btn-secondary flex-1 text-center">
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
