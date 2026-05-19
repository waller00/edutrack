'use client'
import { useEffect, useMemo, useState } from 'react'
import { Copy, Download, FileText, Info, KeyRound, Lock, Save, ShieldCheck, ShieldOff, User } from 'lucide-react'
import { PendingButtonContent } from '@/components/common/PendingButtonContent'
import { api } from '@/lib/api/client'
import PhoneBirthdateFields from '@/components/forms/PhoneBirthdateFields'
import WebPushSection from '@/components/notifications/WebPushSection'
import { formatLocalMobileInputFromE164 } from '@/lib/forms/uruguay-forms'
import { PasswordVisibilityToggle } from '@/components/common/PasswordVisibilityToggle'
import {
  buildProfilePayload,
  canEditNationalId,
  formatCI,
  getPasswordErrorMessage,
  getProfileErrorMessage,
  isStrongPassword,
  STRONG_PASSWORD_MESSAGE,
  validateProfileForm,
} from '@/lib/profile/profile-form'

export default function ProfilePage(){ // NOSONAR preserve current profile UI flow
  const [me,setMe]=useState<any>(null)
  const [username,setUsername]=useState('')
  const [nationalId,setNationalId]=useState('')
  const [firstName,setFirstName]=useState('')
  const [lastName,setLastName]=useState('')
  const [phoneLocal,setPhoneLocal]=useState('')
  const [birthdate,setBirthdate]=useState('')
  const [nationalIdDocumentExpiresAt,setNationalIdDocumentExpiresAt]=useState('')
  const [saving,setSaving]=useState(false)
  const [msg,setMsg]=useState('')

  const [hasPassword,setHasPassword]=useState(true)
  const [currentPassword,setCurrentPassword]=useState('')
  const [newPassword,setNewPassword]=useState('')
  const [confirm,setConfirm]=useState('')
  const [savingPass,setSavingPass]=useState(false)
  const [showCur,setShowCur]=useState(false)
  const [showNew,setShowNew]=useState(false)
  const [showConf,setShowConf]=useState(false)
  const [twoFactorEnabled,setTwoFactorEnabled]=useState(false)
  const [twoFactorQr,setTwoFactorQr]=useState('')
  const [twoFactorManualKey,setTwoFactorManualKey]=useState('')
  const [twoFactorCode,setTwoFactorCode]=useState('')
  const [twoFactorDisableValue,setTwoFactorDisableValue]=useState('')
  const [twoFactorBackupCodes,setTwoFactorBackupCodes]=useState<string[]>([])
  const [savingTwoFactor,setSavingTwoFactor]=useState(false)
  const [manualKeyCopied,setManualKeyCopied]=useState(false)

  const ci = useMemo(()=>formatCI(nationalId),[nationalId])
  useEffect(()=>{ setNationalId(ci) },[ci])

  useEffect(()=>{
    api('/auth/me').then((u:any)=>{
      setMe(u)
      setUsername(u.username||'')
      setNationalId(u.nationalId||'')
      setFirstName(u.firstName||'')
      setLastName(u.lastName||'')
      setPhoneLocal(formatLocalMobileInputFromE164(u.phone))
      setBirthdate(u.birthdate? String(u.birthdate).slice(0,10): '')
      setNationalIdDocumentExpiresAt(
        u.nationalIdDocumentExpiresAt ? String(u.nationalIdDocumentExpiresAt).slice(0, 10) : '',
      )
      setHasPassword(!!u.hasPassword)
      setTwoFactorEnabled(!!u.twoFactorEnabled)
    }).catch(()=> window.location.href='/login')
  },[])

  async function saveProfile(){
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
    try{
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
      await api('/auth/profile',{ method:'PUT', body: JSON.stringify(payload)})
      setMsg('Perfil actualizado')
    }catch(e:any){
      setMsg(getProfileErrorMessage(e))
    }finally{ setSaving(false) }
  }

  async function changePassword(){
    if(!hasPassword) return
    setMsg('')
    if(newPassword!==confirm) return setMsg('Las contraseñas no coinciden')
    if(!isStrongPassword(newPassword)) return setMsg(STRONG_PASSWORD_MESSAGE)
    setSavingPass(true)
    try{
      await api('/auth/password/change',{ method:'PUT', body: JSON.stringify({ currentPassword, newPassword }) })
      setMsg('Contraseña actualizada')
      setCurrentPassword(''); setNewPassword(''); setConfirm('')
    }catch(e:any){
      setMsg(getPasswordErrorMessage(e))
    }finally{ setSavingPass(false) }
  }

  async function startTwoFactorSetup(){
    setMsg('')
    setSavingTwoFactor(true)
    try{
      const result = await api<any>('/auth/2fa/setup',{ method:'POST', body: JSON.stringify({}) })
      setTwoFactorQr(result.qrCodeDataUrl)
      setTwoFactorManualKey(result.manualEntryKey || '')
      setTwoFactorCode('')
      setTwoFactorBackupCodes([])
      setManualKeyCopied(false)
    }catch(e:any){
      setMsg(e?.message || 'No se pudo iniciar la configuración de 2FA')
    }finally{ setSavingTwoFactor(false) }
  }

  async function confirmTwoFactor(){
    setMsg('')
    setSavingTwoFactor(true)
    try{
      const result = await api<any>('/auth/2fa/confirm',{ method:'POST', body: JSON.stringify({ code: twoFactorCode.trim() }) })
      setTwoFactorEnabled(true)
      setTwoFactorQr('')
      setTwoFactorManualKey('')
      setTwoFactorCode('')
      setTwoFactorBackupCodes(result.backupCodes || [])
      setMsg('Autenticación en dos pasos activada')
    }catch(e:any){
      setMsg(e?.message || 'Código inválido')
    }finally{ setSavingTwoFactor(false) }
  }

  async function disableTwoFactor(){
    setMsg('')
    setSavingTwoFactor(true)
    try{
      await api('/auth/2fa/disable',{
        method:'POST',
        body: JSON.stringify(hasPassword ? { password: twoFactorDisableValue } : { code: twoFactorDisableValue }),
      })
      setTwoFactorEnabled(false)
      setTwoFactorDisableValue('')
      setTwoFactorBackupCodes([])
      setMsg('Autenticación en dos pasos desactivada')
    }catch(e:any){
      setMsg(e?.message || 'No se pudo desactivar 2FA')
    }finally{ setSavingTwoFactor(false) }
  }

  async function copyTwoFactorManualKey(){
    if(!twoFactorManualKey) return
    try{
      if(navigator.clipboard?.writeText){
        await navigator.clipboard.writeText(twoFactorManualKey)
      }else{
        copyTextWithFallback(twoFactorManualKey)
      }
      setManualKeyCopied(true)
      setMsg('Clave copiada')
    }catch{
      try{
        copyTextWithFallback(twoFactorManualKey)
        setManualKeyCopied(true)
        setMsg('Clave copiada')
      }catch{
        setManualKeyCopied(false)
        setMsg('No se pudo copiar la clave. Seleccionala y copiala manualmente.')
      }
    }
  }

  function copyTextWithFallback(text: string){
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', 'true')
    area.style.position = 'fixed'
    area.style.top = '-9999px'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    area.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    area.remove()
    if(!ok) throw new Error('COPY_FAILED')
  }

  function downloadTwoFactorBackupCodes(){
    if(twoFactorBackupCodes.length===0) return
    const issuedAt = new Date().toISOString().slice(0,10)
    const content = [
      'Codigos de recuperacion 2FA - EduTrack',
      `Cuenta: ${me?.email || ''}`,
      `Fecha: ${issuedAt}`,
      '',
      ...twoFactorBackupCodes,
      '',
      'Guarda estos codigos en un lugar seguro. Cada codigo se puede usar una sola vez.',
    ].join('\n')
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `edutrack-codigos-recuperacion-${issuedAt}.txt`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  if(!me) return null
  const isAdmin = me.role === 'ADMIN'

  return (
    <main className="mx-auto max-w-7xl p-6 space-y-8">
      {/* Header moderno */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
            <User className="h-7 w-7 text-emerald-600" aria-hidden />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Mi Perfil</h1>
            <p className="text-gray-600">Gestiona tu información personal y seguridad</p>
          </div>
        </div>
        <div className="text-right">
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
              onChange={e=>setUsername(e.target.value)} 
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
              onChange={e=>setNationalId(e.target.value)} 
              disabled={!isAdmin} 
              className="input-field disabled:opacity-60"
              placeholder="1.234.567-8"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Nombre</label>
            <input 
              value={firstName} 
              onChange={e=>setFirstName(e.target.value)} 
              className="input-field"
              placeholder="Tu nombre"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Apellido</label>
            <input 
              value={lastName} 
              onChange={e=>setLastName(e.target.value)} 
              className="input-field"
              placeholder="Tu apellido"
            />
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
              onChange={(e) => setNationalIdDocumentExpiresAt(e.target.value)}
              type="date"
              min="1950-01-01"
              max="2100-12-31"
              className="input-field"
              aria-label="Vencimiento del DNI"
            />
            <p className="text-xs text-gray-500 mt-1">Opcional si aún no consta en el sistema.</p>
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
              idle={
                <>
                  <Save className="h-4 w-4 shrink-0" aria-hidden />
                  Guardar cambios
                </>
              }
            />
          </button>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
              <Lock className="h-4 w-4 text-emerald-600" aria-hidden />
            </div>
            <h2 className="text-lg font-semibold text-gray-900">Seguridad</h2>
          </div>
        </div>
        {hasPassword ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Contraseña actual</label>
              <div className="relative">
                <input 
                  type={showCur?'text':'password'} 
                  value={currentPassword} 
                  onChange={e=>setCurrentPassword(e.target.value)} 
                  className="input-field pr-10"
                  placeholder="Tu contraseña actual"
                />
                <PasswordVisibilityToggle
                  visible={showCur}
                  onToggle={() => setShowCur((s) => !s)}
                  field="contraseña actual"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Nueva contraseña</label>
              <div className="relative">
                <input 
                  type={showNew?'text':'password'} 
                  value={newPassword} 
                  onChange={e=>setNewPassword(e.target.value)} 
                  className="input-field pr-10"
                  placeholder="Mín 8, Aa y 0-9"
                />
                <PasswordVisibilityToggle
                  visible={showNew}
                  onToggle={() => setShowNew((s) => !s)}
                  field="nueva contraseña"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Confirmar nueva</label>
              <div className="relative">
                <input 
                  type={showConf?'text':'password'} 
                  value={confirm} 
                  onChange={e=>setConfirm(e.target.value)} 
                  className="input-field pr-10"
                  placeholder="Repite la nueva contraseña"
                />
                <PasswordVisibilityToggle
                  visible={showConf}
                  onToggle={() => setShowConf((s) => !s)}
                  field="confirmación"
                />
              </div>
            </div>
            <div className="md:col-span-3 flex justify-end pt-6 border-t border-gray-200">
              <button
                onClick={changePassword}
                disabled={savingPass}
                className="btn-primary inline-flex items-center justify-center gap-2 disabled:opacity-60"
              >
                <PendingButtonContent
                  pending={savingPass}
                  pendingText="Actualizando…"
                  idle={
                    <>
                      <KeyRound className="h-4 w-4 shrink-0" aria-hidden />
                      Actualizar contraseña
                    </>
                  }
                />
              </button>
            </div>
          </div>
        ) : (
          <div className="p-6 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                <Info className="h-4 w-4 text-blue-600" aria-hidden />
              </div>
              <div>
                <p className="text-sm font-medium text-blue-800">Sin contraseña configurada</p>
                <p className="text-sm text-blue-700">Tu cuenta no tiene contraseña (ingresaste con Google). Puedes crear una desde Onboarding.</p>
              </div>
            </div>
          </div>
        )}

        <div className="mt-8 pt-6 border-t border-gray-200 space-y-5">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center shrink-0">
                {twoFactorEnabled ? (
                  <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden />
                ) : (
                  <ShieldOff className="h-4 w-4 text-gray-500" aria-hidden />
                )}
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-900">Autenticación en dos pasos</h3>
                <p className="text-sm text-gray-600">
                  {twoFactorEnabled
                    ? 'Activa. Se pedirá un código de Google Authenticator al iniciar sesión.'
                    : 'Opcional. Usa Google Authenticator o cualquier app compatible con TOTP.'}
                </p>
              </div>
            </div>
            {!twoFactorEnabled && !twoFactorQr && (
              <button
                type="button"
                onClick={startTwoFactorSetup}
                disabled={savingTwoFactor}
                className="btn-secondary justify-center"
              >
                <PendingButtonContent pending={savingTwoFactor} pendingText="Generando…" idle="Activar 2FA" />
              </button>
            )}
          </div>

          {twoFactorQr && (
            <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
              <div className="bg-white rounded-lg p-3 w-fit">
                <img src={twoFactorQr} alt="Código QR para configurar 2FA" className="w-56 h-56" />
              </div>
              <div className="space-y-4">
                <p className="text-sm text-emerald-900">
                  Escanea el QR con Google Authenticator y escribe el código de 6 dígitos para confirmar la activación.
                </p>
                {twoFactorManualKey && (
                  <div className="rounded-lg border border-emerald-200 bg-white p-3">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-gray-800">Clave manual</p>
                        <code className="mt-1 block break-all text-sm text-gray-900">{twoFactorManualKey}</code>
                      </div>
                      <button type="button" onClick={copyTwoFactorManualKey} className="btn-secondary justify-center">
                        <Copy className="h-4 w-4" aria-hidden />
                        {manualKeyCopied ? 'Copiado' : 'Copiar'}
                      </button>
                    </div>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Código</label>
                  <input
                    className="input-field max-w-xs text-center tracking-[0.4em]"
                    value={twoFactorCode}
                    onChange={e=>setTwoFactorCode(e.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="123456"
                  />
                </div>
                <div className="flex flex-wrap gap-3">
                  <button type="button" onClick={confirmTwoFactor} disabled={savingTwoFactor} className="btn-primary">
                    <PendingButtonContent pending={savingTwoFactor} pendingText="Confirmando…" idle="Confirmar 2FA" />
                  </button>
                  <button type="button" onClick={()=>{ setTwoFactorQr(''); setTwoFactorManualKey(''); setTwoFactorCode('') }} className="btn-secondary">
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          )}

          {twoFactorBackupCodes.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-amber-900">Códigos de respaldo</p>
                  <p className="text-sm text-amber-800 mt-1">Guárdalos en un lugar seguro. Se muestran una sola vez.</p>
                </div>
                <button type="button" onClick={downloadTwoFactorBackupCodes} className="btn-secondary justify-center">
                  <Download className="h-4 w-4" aria-hidden />
                  Descargar
                </button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-3">
                {twoFactorBackupCodes.map(code => (
                  <code key={code} className="rounded bg-white px-2 py-1 text-sm text-gray-900 text-center">{code}</code>
                ))}
              </div>
            </div>
          )}

          {twoFactorEnabled && (
            <div className="flex flex-col md:flex-row gap-3 md:items-end">
              <div className="w-full md:max-w-sm">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {hasPassword ? 'Contraseña actual para desactivar' : 'Código 2FA para desactivar'}
                </label>
                <input
                  type={hasPassword ? 'password' : 'text'}
                  className="input-field"
                  value={twoFactorDisableValue}
                  onChange={e=>setTwoFactorDisableValue(e.target.value)}
                  placeholder={hasPassword ? 'Tu contraseña actual' : '123456'}
                />
              </div>
              <button
                type="button"
                onClick={disableTwoFactor}
                disabled={savingTwoFactor || !twoFactorDisableValue.trim()}
                className="btn-secondary justify-center disabled:opacity-60"
              >
                <PendingButtonContent pending={savingTwoFactor} pendingText="Desactivando…" idle="Desactivar 2FA" />
              </button>
            </div>
          )}
        </div>
      </section>

      <WebPushSection />
    </main>
  )
} 
