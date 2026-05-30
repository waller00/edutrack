'use client'
import { useEffect, useMemo, useState } from 'react'
import { FileText, Save, User } from 'lucide-react'
import { PendingButtonContent } from '@/components/common/PendingButtonContent'
import { api } from '@/lib/api/client'
import PhoneBirthdateFields from '@/components/forms/PhoneBirthdateFields'
import WebPushSection from '@/components/notifications/WebPushSection'
import { formatLocalMobileInputFromE164 } from '@/lib/forms/uruguay-forms'
import {
  buildProfilePayload,
  canEditNationalId,
  formatCI,
  getProfileErrorMessage,
  validateProfileForm,
} from '@/lib/profile/profile-form'

export default function ProfilePage() {
  const [me, setMe] = useState<any>(null)
  const [username, setUsername] = useState('')
  const [nationalId, setNationalId] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phoneLocal, setPhoneLocal] = useState('')
  const [birthdate, setBirthdate] = useState('')
  const [nationalIdDocumentExpiresAt, setNationalIdDocumentExpiresAt] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const ci = useMemo(() => formatCI(nationalId), [nationalId])
  useEffect(() => { setNationalId(ci) }, [ci])

  useEffect(() => {
    api('/auth/me').then((u: any) => {
      setMe(u)
      setUsername(u.username || '')
      setNationalId(u.nationalId || '')
      setFirstName(u.firstName || '')
      setLastName(u.lastName || '')
      setPhoneLocal(formatLocalMobileInputFromE164(u.phone))
      setBirthdate(u.birthdate ? String(u.birthdate).slice(0, 10) : '')
      setNationalIdDocumentExpiresAt(
        u.nationalIdDocumentExpiresAt ? String(u.nationalIdDocumentExpiresAt).slice(0, 10) : '',
      )
    }).catch(() => { window.location.href = '/login' })
  }, [])

  async function saveProfile() {
    setMsg('')
    const validationError = validateProfileForm({
      username,
      nationalId,
      firstName,
      lastName,
      phoneLocal,
      canEditCi: canEditNationalId(me?.role),
    })
    if (validationError) return setMsg(validationError)
    setSaving(true)
    try {
      const payload = buildProfilePayload({
        username,
        firstName,
        lastName,
        phoneLocal,
        birthdate,
        nationalIdDocumentExpiresAt,
        nationalId,
        isAdmin: canEditNationalId(me?.role),
      })
      await api('/auth/profile', { method: 'PUT', body: JSON.stringify(payload) })
      setMsg('Perfil actualizado')
    } catch (e: any) {
      setMsg(getProfileErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  if (!me) return null
  const isAdmin = me.role === 'ADMIN'

  return (
    <main className="responsive-page max-w-7xl space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
            <User className="h-7 w-7 text-emerald-600" aria-hidden />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Mi Perfil</h1>
            <p className="text-gray-600">Datos personales y notificaciones</p>
          </div>
        </div>
        <div className="text-left sm:text-right">
          <div className="text-lg font-semibold text-emerald-600">{me.name || me.email}</div>
          <div className="text-sm text-gray-600">{me.role}</div>
        </div>
      </div>

      {msg && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-blue-800">
          {msg}
        </div>
      )}

      <section className="card">
        <div className="card-header">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
              <FileText className="h-4 w-4 text-emerald-600" aria-hidden />
            </div>
            <h2 className="text-lg font-semibold text-gray-900">Datos Personales</h2>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Usuario</label>
            <input
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="input-field"
              placeholder="Ingresa tu nombre de usuario"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Cédula {isAdmin ? null : <span className="text-xs text-gray-500">(solo editable por administración)</span>}
            </label>
            <input
              value={nationalId}
              onChange={e => setNationalId(e.target.value)}
              disabled={!isAdmin}
              className="input-field disabled:opacity-60"
              placeholder="1.234.567-8"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Nombre</label>
            <input value={firstName} onChange={e => setFirstName(e.target.value)} className="input-field" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Apellido</label>
            <input value={lastName} onChange={e => setLastName(e.target.value)} className="input-field" />
          </div>
          <PhoneBirthdateFields
            phoneLocal={phoneLocal}
            birthdate={birthdate}
            onPhoneChange={setPhoneLocal}
            onBirthdateChange={setBirthdate}
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Vencimiento del DNI</label>
            <input
              value={nationalIdDocumentExpiresAt}
              onChange={e => setNationalIdDocumentExpiresAt(e.target.value)}
              type="date"
              className="input-field"
            />
          </div>
        </div>
        <div className="flex justify-end pt-6 border-t border-gray-200">
          <button
            onClick={saveProfile}
            disabled={saving}
            className="btn-primary inline-flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <PendingButtonContent
              pending={saving}
              pendingText="Guardando…"
              idle={<><Save className="h-4 w-4 shrink-0" aria-hidden />Guardar cambios</>}
            />
          </button>
        </div>
      </section>

      <section className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Contraseña y 2FA</h2>
        <p className="text-sm text-gray-600">
          La contraseña y la autenticación en dos pasos se gestionan en el portal de cuenta (Keycloak).
          Cerrá sesión y usá «¿Olvidaste tu contraseña?» en la pantalla de inicio de sesión, o pedí a un administrador
          que envíe un restablecimiento desde Usuarios.
        </p>
      </section>

      <WebPushSection />
    </main>
  )
}
