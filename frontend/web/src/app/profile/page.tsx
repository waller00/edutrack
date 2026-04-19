'use client'
import { useEffect, useMemo, useState } from 'react'
import { FileText, Info, KeyRound, Lock, Save, User } from 'lucide-react'
import { PendingButtonContent } from '@/components/PendingButtonContent'
import { api } from '@/lib/api'
import PhoneBirthdateFields from '@/components/PhoneBirthdateFields'
import { PasswordVisibilityToggle } from '@/components/PasswordVisibilityToggle'
import {
  buildProfilePayload,
  canEditNationalId,
  formatCI,
  getPasswordErrorMessage,
  getProfileErrorMessage,
  isStrongPassword,
  STRONG_PASSWORD_MESSAGE,
  validateProfileForm,
} from '@/lib/profile-form'

export default function ProfilePage(){ // NOSONAR preserve current profile UI flow
  const [me,setMe]=useState<any>(null)
  const [username,setUsername]=useState('')
  const [nationalId,setNationalId]=useState('')
  const [firstName,setFirstName]=useState('')
  const [lastName,setLastName]=useState('')
  const [phoneLocal,setPhoneLocal]=useState('')
  const [birthdate,setBirthdate]=useState('')
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

  const ci = useMemo(()=>formatCI(nationalId),[nationalId])
  useEffect(()=>{ setNationalId(ci) },[ci])

  useEffect(()=>{
    api('/auth/me').then((u:any)=>{
      setMe(u)
      setUsername(u.username||'')
      setNationalId(u.nationalId||'')
      setFirstName(u.firstName||'')
      setLastName(u.lastName||'')
      setPhoneLocal(u.phone?u.phone.replace('+598','').replace(/^0/,''): '')
      setBirthdate(u.birthdate? String(u.birthdate).slice(0,10): '')
      setHasPassword(!!u.hasPassword)
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
      </section>
    </main>
  )
} 
