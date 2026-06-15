'use client'
import type { FormEvent } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, FileText, KeyRound, Mail, Save, ShieldCheck, User } from 'lucide-react'
import { PendingButtonContent } from '@/components/common/PendingButtonContent'
import { api } from '@/lib/api/client'
import { accountPasswordUrl, accountRecoveryCodesUrl, accountTwoFactorUrl } from '@/lib/auth/urls'
import PhoneBirthdateFields from '@/components/forms/PhoneBirthdateFields'
import WebPushSection from '@/components/notifications/WebPushSection'
import { formatLocalMobileInputFromE164 } from '@/lib/forms/uruguay-forms'
import { useAuth } from '@/contexts/AuthContext'
import { getRoleLabel } from '@/lib/roles/display'
import {
  buildProfilePayload,
  canEditNationalId,
  formatCI,
  getProfileErrorMessage,
  validateProfileForm,
} from '@/lib/profile/profile-form'

export default function ProfilePage() {
  const { me, loading, refresh } = useAuth()
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [nationalId, setNationalId] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phoneLocal, setPhoneLocal] = useState('')
  const [birthdate, setBirthdate] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false)
  const [twoFactorLoading, setTwoFactorLoading] = useState(true)
  const [twoFactorCode, setTwoFactorCode] = useState('')
  const [twoFactorDisableBusy, setTwoFactorDisableBusy] = useState(false)
  const [disableEmailBusy, setDisableEmailBusy] = useState(false)

  const ci = useMemo(() => formatCI(nationalId), [nationalId])
  useEffect(() => { setNationalId(ci) }, [ci])

  useEffect(() => {
    if (loading) return
    if (!me) { globalThis.location.href = '/login'; return }
    setEmail(me.email || '')
    setUsername(me.username || '')
    setNationalId(me.nationalId || '')
    setFirstName(me.firstName || '')
    setLastName(me.lastName || '')
    setPhoneLocal(formatLocalMobileInputFromE164(me.phone))
    setBirthdate(me.birthdate ? String(me.birthdate).slice(0, 10) : '')
  }, [loading, me])

  useEffect(() => {
    const href = typeof window !== 'undefined' ? window.location.href : ''
    const query = href.includes('?') ? href.slice(href.indexOf('?')) : ''
    const params = new URLSearchParams(query)
    if (params.has('twoFactorDisabled')) {
      setMsg('2FA desactivado')
      setTwoFactorEnabled(false)
    } else if (params.has('twoFactorDisableError')) {
      setMsg('No se pudo desactivar 2FA. Reintentá o solicitá la confirmación por correo.')
    }
    // Limpiamos los params para que un refresh o "atrás" no re-dispare el aviso
    // ni vuelva a forzar el estado de 2FA en cada montaje.
    if (params.has('twoFactorDisabled') || params.has('twoFactorDisableError')) {
      globalThis.history.replaceState(null, '', '/profile')
    }
  }, [])

  // Consultamos el estado de 2FA cuando el usuario queda identificado; depende del id
  // (estable) para no re-consultar en cada refresh del perfil.
  useEffect(() => {
    if (!me?.id) return
    setTwoFactorLoading(true)
    api<{ enabled: boolean }>('/auth/account/2fa/status')
      .then((status) => setTwoFactorEnabled(Boolean(status.enabled)))
      .catch(() => setTwoFactorEnabled(false))
      .finally(() => setTwoFactorLoading(false))
  }, [me?.id])

  async function saveProfile() {
    setMsg('')
    const validationError = validateProfileForm({
      email,
      username: undefined,
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
        email,
        username: undefined,
        firstName,
        lastName,
        phoneLocal,
        birthdate,
        nationalId,
        isAdmin: canEditNationalId(me?.role),
      })
      await api('/auth/profile', { method: 'PUT', body: JSON.stringify(payload) })
      await refresh()
      setMsg('Perfil actualizado')
    } catch (e: any) {
      setMsg(getProfileErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  async function requestDisableTwoFactorEmail() {
    setMsg('')
    setDisableEmailBusy(true)
    try {
      await api('/auth/account/2fa/disable-email', { method: 'POST', body: JSON.stringify({}) })
      setMsg('Te enviamos un correo para confirmar la desactivación de 2FA.')
    } catch (e: any) {
      setMsg(e?.data?.message || e?.message || 'No se pudo enviar el correo de confirmación')
    } finally {
      setDisableEmailBusy(false)
    }
  }

  async function disableTwoFactorWithCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMsg('')
    setTwoFactorDisableBusy(true)
    try {
      await api('/auth/account/2fa/disable', { method: 'POST', body: JSON.stringify({ code: twoFactorCode }) })
      setTwoFactorEnabled(false)
      setTwoFactorCode('')
      setMsg('2FA desactivado')
    } catch (e: any) {
      setMsg(e?.data?.message || e?.message || 'No se pudo desactivar 2FA')
    } finally {
      setTwoFactorDisableBusy(false)
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
          <div className="text-sm text-gray-600">{me.roleLabel || getRoleLabel(me.role)}</div>
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
            <label htmlFor="profile-email" className="block text-sm font-medium text-gray-700 mb-2">Correo</label>
            <input
              id="profile-email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="input-field"
              placeholder="tu@correo.com"
              type="email"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Usuario</label>
            <input
              value={username}
              readOnly
              aria-readonly="true"
              className="input-field cursor-not-allowed bg-gray-50 text-gray-600"
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
        <div className="card-header">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-100">
              <ShieldCheck className="h-4 w-4 text-sky-700" aria-hidden />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-950">Seguridad de la cuenta</h2>
              <p className="text-sm text-gray-600">Gestioná tu contraseña y la verificación en dos pasos.</p>
            </div>
          </div>
        </div>
        <div className="divide-y divide-gray-100">
          <div className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-gray-700" aria-hidden />
              <div>
                <h3 className="font-semibold text-gray-950">Contraseña</h3>
                <p className="text-sm text-gray-600">Cambiá tu contraseña actual desde el gestor seguro de cuenta.</p>
              </div>
            </div>
            <a href={accountPasswordUrl()} className="btn-secondary w-full sm:w-auto">
              Cambiar contraseña
              <ExternalLink className="h-4 w-4" aria-hidden />
            </a>
          </div>
          <div className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden />
              <div>
                <h3 className="font-semibold text-gray-950">Verificación en dos pasos</h3>
                <p className="text-sm text-gray-600">
                  {twoFactorEnabled
                    ? '2FA está activo. Ingresá el código de tu autenticador para desactivarlo.'
                    : 'Activá tu autenticador y guardá los códigos de respaldo al terminar.'}
                </p>
              </div>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
              {twoFactorLoading ? (
                <span className="btn-secondary w-full cursor-wait justify-center opacity-70 sm:w-auto">Consultando…</span>
              ) : twoFactorEnabled ? (
                <>
                  <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                    <a href={accountRecoveryCodesUrl()} className="btn-secondary w-full sm:w-auto">
                      Códigos de respaldo
                      <ExternalLink className="h-4 w-4" aria-hidden />
                    </a>
                  </div>
                  <form onSubmit={disableTwoFactorWithCode} className="flex w-full flex-col gap-2 sm:w-[22rem]">
                    <label htmlFor="profile-2fa-code" className="sr-only">Código de 2FA</label>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        id="profile-2fa-code"
                        value={twoFactorCode}
                        onChange={(event) => setTwoFactorCode(event.target.value)}
                        className="input-field text-center tabular-nums sm:w-32"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9 ]{6,8}"
                        placeholder="123456"
                      />
                      <button
                        type="submit"
                        disabled={twoFactorDisableBusy || !twoFactorCode.trim()}
                        className="btn-secondary w-full justify-center border-red-200 text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 sm:flex-1"
                      >
                        <PendingButtonContent
                          pending={twoFactorDisableBusy}
                          pendingText="Desactivando…"
                          idle="Desactivar 2FA"
                        />
                      </button>
                    </div>
                  </form>
                  <button
                    type="button"
                    onClick={requestDisableTwoFactorEmail}
                    disabled={disableEmailBusy}
                    className="inline-flex items-center gap-1.5 self-start text-sm text-gray-500 underline-offset-2 hover:text-emerald-700 hover:underline disabled:cursor-wait disabled:opacity-60 sm:self-end"
                  >
                    <PendingButtonContent
                      pending={disableEmailBusy}
                      pendingText="Enviando correo…"
                      idle={<><Mail className="h-3.5 w-3.5" aria-hidden />¿Sin acceso a tu autenticador? Desactivar por correo</>}
                    />
                  </button>
                </>
              ) : (
                <a href={accountTwoFactorUrl()} className="btn-primary w-full sm:w-auto">
                  Configurar 2FA
                  <ExternalLink className="h-4 w-4" aria-hidden />
                </a>
              )}
            </div>
          </div>
        </div>
      </section>

      <WebPushSection />
    </main>
  )
}
