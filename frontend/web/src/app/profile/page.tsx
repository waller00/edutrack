'use client'
import type { FormEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Bell, ChevronDown, ExternalLink, FileText, KeyRound, Mail, Save, ShieldCheck, User, X } from 'lucide-react'
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
  const [section, setSection] = useState<'personal' | 'security' | 'notifications'>('personal')
  const [notificationsVisited, setNotificationsVisited] = useState(false)
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [nationalId, setNationalId] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phoneLocal, setPhoneLocal] = useState('')
  const [birthdate, setBirthdate] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [msgTone, setMsgTone] = useState<'success' | 'error'>('success')
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false)
  const [twoFactorLoading, setTwoFactorLoading] = useState(true)
  const [twoFactorError, setTwoFactorError] = useState(false)
  const twoFactorRequest = useRef(0)
  const [twoFactorCode, setTwoFactorCode] = useState('')
  const [twoFactorDisableBusy, setTwoFactorDisableBusy] = useState(false)
  const [disableEmailBusy, setDisableEmailBusy] = useState(false)

  useEffect(() => {
    if (loading) return
    if (!me) { globalThis.location.href = '/login'; return }
    setEmail(me.email || '')
    setUsername(me.username || '')
    setNationalId(formatCI(me.nationalId || ''))
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
      notify('2FA desactivado', 'success')
      setTwoFactorEnabled(false)
    } else if (params.has('twoFactorDisableError')) {
      notify('No se pudo desactivar 2FA. Reintentá o solicitá la confirmación por correo.', 'error')
    }
    // Limpiamos los params para que un refresh o "atrás" no re-dispare el aviso
    // ni vuelva a forzar el estado de 2FA en cada montaje.
    if (params.has('twoFactorDisabled') || params.has('twoFactorDisableError')) {
      globalThis.history.replaceState(null, '', '/profile')
    }
  }, [])

  const loadTwoFactor = useCallback(async () => {
    if (!me?.id) return
    const request = ++twoFactorRequest.current
    setTwoFactorLoading(true)
    setTwoFactorError(false)
    try {
      const status = await api<{ enabled: boolean }>('/auth/account/2fa/status')
      if (request === twoFactorRequest.current) setTwoFactorEnabled(Boolean(status.enabled))
    } catch {
      if (request === twoFactorRequest.current) setTwoFactorError(true)
    } finally {
      if (request === twoFactorRequest.current) setTwoFactorLoading(false)
    }
  }, [me?.id])
  const cancelTwoFactorLoad = useCallback(() => { twoFactorRequest.current++ }, [])

  useEffect(() => {
    void loadTwoFactor()
    return cancelTwoFactorLoad
  }, [loadTwoFactor, cancelTwoFactorLoad])

  function notify(text: string, tone: 'success' | 'error') {
    setMsg(text)
    setMsgTone(tone)
  }

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
    if (validationError) {
      notify(validationError, 'error')
      return
    }
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
      notify('Perfil actualizado', 'success')
    } catch (e: any) {
      notify(getProfileErrorMessage(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  async function requestDisableTwoFactorEmail() {
    setMsg('')
    setDisableEmailBusy(true)
    try {
      await api('/auth/account/2fa/disable-email', { method: 'POST', body: JSON.stringify({}) })
      notify('Te enviamos un correo para confirmar la desactivación de 2FA.', 'success')
    } catch (e: any) {
      notify(e?.data?.message || e?.message || 'No se pudo enviar el correo de confirmación', 'error')
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
      notify('2FA desactivado', 'success')
    } catch (e: any) {
      notify(e?.data?.message || e?.message || 'No se pudo desactivar 2FA', 'error')
    } finally {
      setTwoFactorDisableBusy(false)
    }
  }

  if (!me) return null
  const isAdmin = me.role === 'ADMIN'

  return (
    <main className="responsive-page max-w-4xl space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="hidden rounded-xl bg-emerald-50 p-3 text-emerald-700 sm:block">
            <User className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Mi Perfil</h1>
            <p className="mt-1 text-sm text-slate-500">Actualizá tus datos y las preferencias de tu cuenta.</p>
          </div>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
          {me.roleLabel || getRoleLabel(me.role)}
        </span>
      </header>

      <div role="group" aria-label="Secciones del perfil" className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1">
        {([
          ['personal', 'Datos personales', FileText],
          ['security', 'Seguridad', ShieldCheck],
          ['notifications', 'Notificaciones', Bell],
        ] as const).map(([value, label, Icon]) => (
          <button key={value} type="button" aria-pressed={section === value} aria-controls={`profile-${value}`}
            onClick={() => { setSection(value); if (value === 'notifications') setNotificationsVisited(true) }}
            className={`flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg px-2 py-2.5 text-xs font-medium transition sm:text-sm ${section === value ? 'bg-emerald-50 text-emerald-700' : 'text-slate-500 hover:bg-slate-50'}`}>
            <Icon className="hidden h-4 w-4 shrink-0 sm:block" aria-hidden />{label}
          </button>
        ))}
      </div>

      {msg && (
        <div role={msgTone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${msgTone === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
          {msgTone === 'error' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
          <span className="min-w-0 flex-1">{msg}</span>
          <button type="button" onClick={() => setMsg('')} className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100" aria-label="Cerrar aviso">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}

      <section id="profile-personal" aria-labelledby="profile-personal-title" hidden={section !== 'personal'} className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
        <h2 id="profile-personal-title" className="font-semibold text-slate-900">Datos personales</h2>
        <p className="mt-1 text-sm text-slate-500">Mantené tus datos de contacto al día.</p>
        <form noValidate onSubmit={(event) => { event.preventDefault(); void saveProfile() }} className="mt-5 space-y-5">
          <fieldset disabled={saving} className="grid min-w-0 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="profile-first-name" className="mb-2 block text-sm font-medium text-slate-700">Nombre</label>
              <input id="profile-first-name" value={firstName} onChange={e => setFirstName(e.target.value)} autoComplete="given-name" className="input-field" />
            </div>
            <div>
              <label htmlFor="profile-last-name" className="mb-2 block text-sm font-medium text-slate-700">Apellido</label>
              <input id="profile-last-name" value={lastName} onChange={e => setLastName(e.target.value)} autoComplete="family-name" className="input-field" />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="profile-email" className="mb-2 block text-sm font-medium text-slate-700">Correo</label>
              <input id="profile-email" value={email} onChange={e => setEmail(e.target.value)} className="input-field" placeholder="tu@correo.com" type="email" autoComplete="email" />
            </div>
            <PhoneBirthdateFields phoneLocal={phoneLocal} birthdate={birthdate} onPhoneChange={setPhoneLocal} onBirthdateChange={setBirthdate} />
          </fieldset>
          <details className="group rounded-lg border border-slate-200">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-3 text-sm font-medium text-slate-600 [&::-webkit-details-marker]:hidden">
              Identificación de la cuenta<ChevronDown className="h-4 w-4 shrink-0 transition group-open:rotate-180" aria-hidden />
            </summary>
            <div className="grid gap-4 border-t border-slate-100 p-3 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-slate-500">Usuario</p>
                <p className="mt-1 break-words text-sm text-slate-700">{username || 'Sin usuario asignado'}</p>
              </div>
              <div>
                {isAdmin ? <>
                  <label htmlFor="profile-national-id" className="mb-2 block text-sm font-medium text-slate-700">Cédula</label>
                  <input id="profile-national-id" value={nationalId} onChange={e => setNationalId(formatCI(e.target.value))} disabled={saving} inputMode="numeric" className="input-field" placeholder="1.234.567-8" />
                </> : <>
                  <p className="text-xs font-medium text-slate-500">Cédula</p>
                  <p className="mt-1 text-sm text-slate-700">{nationalId || 'Sin cédula registrada'}</p>
                  <p className="mt-1 text-xs text-slate-500">Para corregirla, contactá a administración.</p>
                </>}
              </div>
            </div>
          </details>
          <div className="flex justify-end border-t border-slate-100 pt-4">
            <button type="submit" disabled={saving} className="btn-primary inline-flex w-full items-center justify-center gap-2 disabled:opacity-60 sm:w-auto">
              <PendingButtonContent pending={saving} pendingText="Guardando…" idle={<><Save className="h-4 w-4 shrink-0" aria-hidden />Guardar cambios</>} />
            </button>
          </div>
        </form>
      </section>

      <section id="profile-security" aria-labelledby="profile-security-title" hidden={section !== 'security'} className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
        <h2 id="profile-security-title" className="font-semibold text-slate-900">Seguridad de la cuenta</h2>
        <p className="mt-1 text-sm text-slate-500">Gestioná tu contraseña y la verificación en dos pasos.</p>
        <div className="mt-5 space-y-5">
          <div className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" aria-hidden />
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Contraseña</h3>
                <p className="mt-1 text-xs text-slate-500">Elegí una contraseña nueva para tu cuenta.</p>
              </div>
            </div>
            <a href={accountPasswordUrl()} className="btn-secondary w-full shrink-0 sm:w-auto">Cambiar contraseña<ExternalLink className="h-4 w-4 shrink-0" aria-hidden /></a>
          </div>
          <div className="space-y-4 rounded-lg border border-slate-200 p-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">Verificación en dos pasos</h3>
                  {!twoFactorLoading && !twoFactorError && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${twoFactorEnabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{twoFactorEnabled ? 'Activada' : 'Sin activar'}</span>}
                </div>
                <p className="mt-1 text-xs text-slate-500">Protegé el acceso con un código de tu autenticador.</p>
              </div>
            </div>
            {twoFactorLoading ? <p role="status" className="text-sm text-slate-500">Consultando estado…</p> : twoFactorError ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-amber-50 p-3">
                <p role="alert" className="text-sm text-amber-800">No se pudo consultar la verificación en dos pasos.</p>
                <button type="button" onClick={() => void loadTwoFactor()} className="text-sm font-medium text-emerald-700 hover:underline">Reintentar</button>
              </div>
            ) : twoFactorEnabled ? (
              <>
                <a href={accountRecoveryCodesUrl()} className="btn-secondary w-full sm:w-auto">Códigos de respaldo<ExternalLink className="h-4 w-4 shrink-0" aria-hidden /></a>
                <details className="group border-t border-slate-100 pt-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm text-slate-600 [&::-webkit-details-marker]:hidden">
                    Desactivar verificación en dos pasos<ChevronDown className="h-4 w-4 shrink-0 transition group-open:rotate-180" aria-hidden />
                  </summary>
                  <div className="mt-4 space-y-3">
                    <p className="text-xs text-slate-500">Ingresá el código de tu autenticador para desactivarla.</p>
                    <form onSubmit={disableTwoFactorWithCode} className="space-y-2">
                      <label htmlFor="profile-2fa-code" className="block text-sm font-medium text-slate-700">Código de 2FA</label>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <input id="profile-2fa-code" value={twoFactorCode} onChange={(event) => setTwoFactorCode(event.target.value)} disabled={twoFactorDisableBusy}
                          className="input-field text-center tabular-nums sm:max-w-40" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,8}" required placeholder="123456" />
                        <button type="submit" disabled={twoFactorDisableBusy || disableEmailBusy || !twoFactorCode.trim()} className="btn-secondary w-full justify-center border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-60 sm:w-auto">
                          <PendingButtonContent pending={twoFactorDisableBusy} pendingText="Desactivando…" idle="Desactivar 2FA" />
                        </button>
                      </div>
                    </form>
                    <button type="button" onClick={requestDisableTwoFactorEmail} disabled={disableEmailBusy || twoFactorDisableBusy} className="inline-flex items-start gap-1.5 text-left text-sm text-slate-500 hover:text-emerald-700 hover:underline disabled:opacity-60">
                      <PendingButtonContent pending={disableEmailBusy} pendingText="Enviando correo…" idle={<><Mail className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />¿Sin acceso a tu autenticador? Desactivar por correo</>} />
                    </button>
                  </div>
                </details>
              </>
            ) : <a href={accountTwoFactorUrl()} className="btn-primary w-full sm:w-auto">Configurar 2FA<ExternalLink className="h-4 w-4 shrink-0" aria-hidden /></a>}
          </div>
        </div>
      </section>

      <section id="profile-notifications" aria-label="Preferencias de notificaciones" hidden={section !== 'notifications'}>
        {notificationsVisited && <WebPushSection />}
      </section>
    </main>
  )
}
