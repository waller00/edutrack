'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

type RegisterRole = 'STAFF' | 'TEACHER' | ''
type UsernameStatus = 'idle'|'checking'|'ok'|'taken'|'invalid'
type VerificationEntry = {
  provided: string
  extracted?: string
  message: string
}

type VerificationResults = {
  verifiedFields: number
  totalFields: number
  verification: Record<string, VerificationEntry>
}

type DniValidation = {
  confidence: number
  reasons: string[]
}

type ProcessDniResponse = {
  success: boolean
  data: { firstName: string; lastName: string; nationalId: string; birthdate: string }
  message: string
}

type VerifyDniResponse = {
  success: boolean
  message?: string
  validation?: DniValidation
  verifiedFields?: number
  totalFields?: number
  verification?: Record<string, VerificationEntry>
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
  const sum = padded
    .split('')
    .map((d, i) => parseInt(d, 10) * weights[i])
    .reduce((a, b) => a + b, 0)
  const check = (10 - (sum % 10)) % 10
  return check
}

function isValidUruguayanCI(input: string) {
  const digits = onlyDigits(input)
  if (digits.length < 7 || digits.length > 8) return false
  const base = digits.slice(0, -1)
  const check = parseInt(digits.slice(-1))
  const expected = computeCICheckDigit(base)
  return check === expected
}

function isStrongPassword(pw: string) {
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(pw)
}

function normalizeLocalPhoneUY(local: string) {
  const digits = onlyDigits(local)
  if (!digits) return ''
  const noZero = digits.startsWith('0') ? digits.slice(1) : digits
  return noZero
}
function isValidLocalPhoneUY(local: string) {
  const nz = normalizeLocalPhoneUY(local)
  return /^\d{8}$/.test(nz)
}

function isValidEmail(email: string) {
  const trimmed = email.trim()
  if (!trimmed || /\s/.test(trimmed)) return false

  const atIndex = trimmed.indexOf('@')
  if (atIndex <= 0 || atIndex !== trimmed.lastIndexOf('@') || atIndex === trimmed.length - 1) return false

  const localPart = trimmed.slice(0, atIndex)
  const domain = trimmed.slice(atIndex + 1)
  if (!localPart || !domain || domain.startsWith('.') || domain.endsWith('.')) return false

  const labels = domain.split('.')
  if (labels.length < 2 || labels.some((label) => label.length === 0)) return false

  return true
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

function getVerificationMessageIcon(message: string) {
  if (message.includes('✓')) return '✅'
  if (message.includes('✗')) return '❌'
  if (message.includes('⚠️')) return '⚠️'
  return '❓'
}

function getVerificationMessageClass(message: string) {
  if (message.includes('✓')) return 'text-green-600'
  if (message.includes('✗')) return 'text-red-600'
  if (message.includes('⚠️')) return 'text-orange-600'
  return 'text-yellow-600'
}

function getVerificationFieldLabel(field: string) {
  switch (field) {
    case 'firstName':
      return 'Nombre'
    case 'lastName':
      return 'Apellidos'
    case 'nationalId':
      return 'Cédula'
    default:
      return 'Fecha de Nacimiento'
  }
}

function isWarningVerificationMessage(field: VerificationEntry) {
  return field.message.includes('⚠️ Faltan apellidos') || field.message.includes('⚠️ No se pudo extraer')
}

function resolveUsernameStatus(valid: boolean, available: boolean) {
  if (!valid) return 'invalid'
  return available ? 'ok' : 'taken'
}

function getDniProcessingErrorMessage(error: unknown) {
  const message = String((error as { message?: string })?.message || '')
  if (message.includes('400')) return '❌ Formato de imagen no válido. Por favor, sube una imagen clara del DNI.'
  if (message.includes('500')) return '❌ Error del servidor. Por favor, intenta nuevamente.'
  return '❌ Error al procesar el DNI. Por favor, completa los campos manualmente.'
}

function validateDniUploadInput(params: {
  file?: File
  firstName: string
  lastName: string
  nationalId: string
  birthdate: string
}) {
  if (!params.file) return 'missing-file'
  if (!params.file.type.startsWith('image/')) return '❌ Por favor, selecciona una imagen válida'
  if (params.file.size > 5 * 1024 * 1024) return '❌ La imagen es demasiado grande. Máximo 5MB'
  if (!params.firstName || !params.lastName || !params.nationalId || !params.birthdate) {
    return '❌ Por favor, completa todos los campos manualmente antes de verificar con el DNI'
  }
  return null
}

function getBirthdateValidationError(birthdate: string) {
  if (!birthdate) return 'Fecha de nacimiento obligatoria'
  const bd = new Date(birthdate)
  const today = new Date()
  if (bd > today) return 'La fecha de nacimiento no puede ser futura'
  const minAgeYears = 5
  const age = today.getFullYear() - bd.getFullYear() - (today < new Date(today.getFullYear(), bd.getMonth(), bd.getDate()) ? 1 : 0)
  if (age < minAgeYears) return `La edad mínima es ${minAgeYears} años`
  return null
}

function getIdentityValidationError(params: {
  username: string
  usernameStatus: UsernameStatus
  nationalId: string
  firstName: string
  lastName: string
  role: RegisterRole
}) {
  if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(params.username)) return 'Usuario inválido (3-30, letras, números, punto, guion)'
  if (params.usernameStatus === 'taken') return 'Nombre de usuario no disponible'
  if (!isValidUruguayanCI(params.nationalId)) return 'Cédula uruguaya inválida'
  if (params.firstName.trim().length === 0 || params.lastName.trim().length === 0) return 'Nombres y apellidos son obligatorios'
  if (!params.role) return 'Debes seleccionar un perfil'
  return null
}

function validateRegisterForm(params: {
  email: string
  password: string
  confirm: string
  username: string
  usernameStatus: UsernameStatus
  nationalId: string
  firstName: string
  lastName: string
  role: RegisterRole
  phoneLocal: string
  birthdate: string
  dniFile: File | null
  verificationResults: VerificationResults | null
}) {
  if (!isValidEmail(params.email)) return 'Email inválido'
  if (!isStrongPassword(params.password)) return 'La contraseña debe tener al menos 8 caracteres, una mayúscula, una minúscula y un número'
  if (params.password !== params.confirm) return 'Las contraseñas no coinciden'
  const identityError = getIdentityValidationError(params)
  if (identityError) return identityError
  if (params.phoneLocal && !isValidLocalPhoneUY(params.phoneLocal)) return 'Teléfono inválido (ingresa 8 dígitos o 09XXXXXXXX)'
  const birthdateError = getBirthdateValidationError(params.birthdate)
  if (birthdateError) return birthdateError
  if (!params.dniFile || !params.verificationResults) return 'Debes verificar tu DNI antes de crear la cuenta'
  return null
}

export default function RegisterPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [username, setUsername] = useState('')
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle')
  const [nationalId, setNationalId] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phoneLocal, setPhoneLocal] = useState('')
  const [birthdate, setBirthdate] = useState('')
  const [role, setRole] = useState<RegisterRole>('')
  const [error, setError] = useState('')
  const [ok, setOk] = useState(false)
  const [loading, setLoading] = useState(false)
  const [dniFile, setDniFile] = useState<File | null>(null)
  const [dniPreviewUrl, setDniPreviewUrl] = useState('')
  const [processingDni, setProcessingDni] = useState(false)
  const [verificationStep, setVerificationStep] = useState(0) // 0: not started, 1: names, 2: surnames, 3: id, 4: birthdate, 5: complete
  const [verificationResults, setVerificationResults] = useState<VerificationResults | null>(null)
  const [dniValidation, setDniValidation] = useState<DniValidation | null>(null)
  const [sessionGate, setSessionGate] = useState(true)

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
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result || ''))
        reader.readAsDataURL(compressedImage)
      })

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
        
        setError('✅ Datos extraídos correctamente del DNI')
      } else {
        setError('❌ No se pudieron extraer los datos del DNI. Por favor, completa los campos manualmente.')
      }
    } catch (error: any) {
      console.error('Error processing DNI:', error)
      console.error('Error details:', error.message, error.stack)
      setError(getDniProcessingErrorMessage(error))
    } finally {
      setProcessingDni(false)
    }
  }

  // Function to compress image
  function compressImage(file: File, quality: number, maxWidth: number): Promise<File> {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      
      img.onload = () => {
        // Calculate new dimensions
        let { width, height } = img;
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }
        
        canvas.width = width;
        canvas.height = height;
        
        // Draw and compress
        ctx?.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (blob) {
            const compressedFile = new File([blob], file.name, {
              type: 'image/jpeg',
              lastModified: Date.now(),
            });
            resolve(compressedFile);
          } else {
            resolve(file); // Fallback to original
          }
        }, 'image/jpeg', quality);
      };
      
      img.src = URL.createObjectURL(file);
    });
  }

  async function handleDniUpload(event: React.ChangeEvent<HTMLInputElement>) { // NOSONAR preserve current verification flow
    const file = event.target.files?.[0]
    const validationError = validateDniUploadInput({ file, firstName, lastName, nationalId, birthdate })
    if (validationError === 'missing-file') return
    if (validationError) {
      setError(validationError)
      return
    }
    
    if (dniPreviewUrl) URL.revokeObjectURL(dniPreviewUrl)
    setDniFile(file)
    setDniPreviewUrl(URL.createObjectURL(file))
    setProcessingDni(true)
    setError('')
    setVerificationStep(1) // Start verification process
    
    try {
      console.log('Starting DNI verification with context...');
      
      // Compress image before sending
      const compressedImage = await compressImage(file, 0.8, 1024);
      
      // Convert file to base64
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result || ''))
        reader.readAsDataURL(compressedImage)
      })

      // Call verification API with context
      const response = await api<VerifyDniResponse>('/auth/verify-step-by-step', {
        method: 'POST',
        body: JSON.stringify({ 
          image: base64,
          firstName: firstName,
          lastName: lastName,
          nationalId: nationalId,
          birthdate: birthdate
        }),
      })

      console.log('Verification Response:', response);

      if (response.success && response.verification && typeof response.verifiedFields === 'number' && typeof response.totalFields === 'number') {
        setVerificationResults({
          verification: response.verification,
          verifiedFields: response.verifiedFields,
          totalFields: response.totalFields,
        })
        setVerificationStep(5) // Complete
        setError('')
      } else {
        if (response.validation) {
          // DNI validation failed
          setError(`❌ ${response.message}`)
          setDniValidation(response.validation)
          setVerificationStep(0)
          // Show validation details
          console.log('DNI Validation Failed:', response.validation);
        } else {
          setError(response.message || 'Error al verificar el DNI.')
          setVerificationStep(0)
        }
      }
    } catch (err: any) {
      console.error('Error during DNI verification:', err)
      
      // Handle different types of errors
      if (err.status === 400) {
        // DNI validation failed
        const errorData = err.data;
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
      setProcessingDni(false)
    }
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
    const valid = /^[a-zA-Z0-9_.-]{3,30}$/.test(username)
    if (!valid) { setUsernameStatus('invalid'); return }
    setUsernameStatus('checking')
    const t = setTimeout(async () => {
      try {
        const res = await api<{available:boolean; valid:boolean}>(`/auth/check-username?u=${encodeURIComponent(username)}`)
        const nextStatus = resolveUsernameStatus(res.valid, res.available)
        setUsernameStatus(nextStatus)
      } catch { setUsernameStatus('invalid') }
    }, 400)
    return () => clearTimeout(t)
  }, [username])

  useEffect(() => {
    if (!verificationResults) return
    setVerificationResults(null)
    setDniValidation(null)
  }, [firstName, lastName, nationalId, birthdate])

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
      dniFile,
      verificationResults,
    })
    if (baseValidation) return baseValidation
    if (verificationHasIssues()) return 'Debes verificar tu DNI antes de crear la cuenta'
    return null
  }

  const strength = getPasswordStrength(password)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const v = validate()
    if (v) { setError(v); return }
    setLoading(true)
    try {
      const payload = {
        email,
        password,
        username,
        nationalId: onlyDigits(nationalId).length ? formatUruguayanCI(nationalId).replace(/\./g, '').replace('-', '') : undefined,
        firstName,
        lastName,
        phone: phoneLocal ? `+598${normalizeLocalPhoneUY(phoneLocal)}` : undefined,
        birthdate: new Date(birthdate).toISOString(),
        role,
      }
      await api('/auth/register', { method: 'POST', body: JSON.stringify(payload) })
      setOk(true)
    } catch (e: any) {
      if (String(e?.message || '').includes('409')) {
        setError('Datos duplicados (email, usuario o cédula). Verifica e intenta nuevamente.')
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
                  pattern="^[a-zA-Z0-9_.-]{3,30}$"
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
                  <button 
                    type="button" 
                    onClick={()=>setShowPwd(s=>!s)} 
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                  >
                    {showPwd ? '🙈' : '👁️'}
                  </button>
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
                  <button 
                    type="button" 
                    onClick={()=>setShowConfirm(s=>!s)} 
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                  >
                    {showConfirm ? '🙈' : '👁️'}
                  </button>
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
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Teléfono</label>
                <div className="flex gap-2 items-center">
                  <span className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-700 select-none text-sm font-medium">+598</span>
                  <input 
                    value={phoneLocal} 
                    onChange={e=>setPhoneLocal(e.target.value)} 
                    placeholder="094481122" 
                    className="input-field flex-1"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Fecha de nacimiento</label>
                <input 
                  value={birthdate} 
                  onChange={e=>setBirthdate(e.target.value)} 
                  type="date" 
                  required 
                  max={new Date().toISOString().split('T')[0]} 
                  className="input-field"
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
                          if (dniFile) handleDniUpload({ target: { files: [dniFile] } } as React.ChangeEvent<HTMLInputElement>)
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
                          {getVerificationMessageIcon(data.message)}
                        </span>
                        <div>
                          <p className="font-medium text-gray-800 capitalize">
                            {getVerificationFieldLabel(field)}
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
                      <div className={`text-sm font-medium ${getVerificationMessageClass(data.message)}`}>
                        {data.message}
                      </div>
                    </div>
                  ))}
                  
                  <div className="text-center p-3 bg-blue-50 rounded-lg">
                    <p className="text-sm font-medium text-blue-800">
                      Verificación: {verificationResults.verifiedFields}/{verificationResults.totalFields} campos correctos
                    </p>
                    {Object.values(verificationResults.verification).some(isWarningVerificationMessage) && (
                      <div className="mt-2 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                        <p className="text-sm text-orange-600 font-medium">
                          ⚠️ Completa todos los campos correctamente antes de crear la cuenta
                        </p>
                        <p className="text-xs text-orange-500 mt-1">
                          Puedes corregir los datos manualmente y usar "Volver a Verificar" para reprocesar la imagen
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

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
                    <p className="text-xs text-red-500">
                      💡 <strong>Sugerencia:</strong> Asegúrate de subir una foto clara de un DNI uruguayo real, no un formulario o imagen de prueba.
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
                disabled={loading || verificationHasIssues()}
                className="btn-primary flex-1 disabled:opacity-60"
              >
                {loading ? '⏳ Creando…' : 'Crear cuenta'}
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
