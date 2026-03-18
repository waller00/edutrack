'use client'
import { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'

function onlyDigits(v:string){ return v.replace(/\D/g,'') }
function formatCI(input: string){
  const d = onlyDigits(input).slice(0,8)
  if (d.length<=1) return d
  if (d.length<=4) return `${d[0]}.${d.slice(1)}`
  if (d.length<=7) return `${d[0]}.${d.slice(1,4)}.${d.slice(4)}`
  return `${d[0]}.${d.slice(1,4)}.${d.slice(4,7)}-${d.slice(7)}`
}
function computeCI(base7:string){ const w=[2,9,8,7,6,3,4]; const p=base7.padStart(7,'0'); const s=p.split('').map((d,i)=>parseInt(d)*w[i]).reduce((a,b)=>a+b,0); return (10-(s%10))%10 }
function validCI(input:string){ const d=onlyDigits(input); if(d.length<7||d.length>8) return false; const b=d.slice(0,-1); return computeCI(b)===parseInt(d.slice(-1)) }
function normLocalPhoneUY(local:string){ const d=onlyDigits(local); if(!d) return ''; return d.startsWith('0')?d.slice(1):d }
function isValidLocalPhone(local:string){ return /^\d{8}$/.test(normLocalPhoneUY(local)) }

export default function ProfilePage(){
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
    if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(username)) return setMsg('Usuario inválido')
    if (me?.role === 'ADMIN') {
      if (!validCI(nationalId)) return setMsg('Cédula inválida')
    }
    if (!firstName.trim() || !lastName.trim()) return setMsg('Nombre y apellido obligatorios')
    if (phoneLocal && !isValidLocalPhone(phoneLocal)) return setMsg('Teléfono inválido')
    setSaving(true)
    try{
      const payload:any = {
        username,
        firstName,
        lastName,
        phone: phoneLocal? `+598${normLocalPhoneUY(phoneLocal)}`: undefined,
        birthdate: birthdate? new Date(birthdate).toISOString(): undefined,
      }
      if (me?.role === 'ADMIN') {
        payload.nationalId = nationalId
      }
      await api('/auth/profile',{ method:'PUT', body: JSON.stringify(payload)})
      setMsg('Perfil actualizado')
    }catch(e:any){
      if(String(e?.message||'').includes('409')) setMsg('Usuario o cédula ya registrados')
      else if(String(e?.message||'').includes('403')) setMsg('No tienes permisos para cambiar cédula/rol')
      else setMsg('Error al guardar')
    }finally{ setSaving(false) }
  }

  async function changePassword(){
    if(!hasPassword) return
    setMsg('')
    if(newPassword!==confirm) return setMsg('Las contraseñas no coinciden')
    if(!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(newPassword)) return setMsg('Contraseña débil')
    setSavingPass(true)
    try{
      await api('/auth/password/change',{ method:'PUT', body: JSON.stringify({ currentPassword, newPassword }) })
      setMsg('Contraseña actualizada')
      setCurrentPassword(''); setNewPassword(''); setConfirm('')
    }catch(e:any){
      if(String(e?.message||'').includes('401')) setMsg('Contraseña actual incorrecta')
      else setMsg('No se pudo actualizar la contraseña')
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
            <span className="text-emerald-600 text-xl">👤</span>
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
              <span className="text-emerald-600">📝</span>
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
              max={new Date().toISOString().split('T')[0]} 
              className="input-field"
            />
          </div>
        </div>
        <div className="flex justify-end pt-6 border-t border-gray-200">
          <button 
            onClick={saveProfile} 
            disabled={saving} 
            className="btn-primary disabled:opacity-60"
          >
            {saving ? '⏳ Guardando…' : '💾 Guardar cambios'}
          </button>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
              <span className="text-emerald-600">🔒</span>
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
                <button 
                  type="button" 
                  onClick={()=>setShowCur(s=>!s)} 
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                >
                  {showCur ? '🙈' : '👁️'}
                </button>
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
                <button 
                  type="button" 
                  onClick={()=>setShowNew(s=>!s)} 
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                >
                  {showNew ? '🙈' : '👁️'}
                </button>
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
                <button 
                  type="button" 
                  onClick={()=>setShowConf(s=>!s)} 
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                >
                  {showConf ? '🙈' : '👁️'}
                </button>
              </div>
            </div>
            <div className="md:col-span-3 flex justify-end pt-6 border-t border-gray-200">
              <button 
                onClick={changePassword} 
                disabled={savingPass} 
                className="btn-primary disabled:opacity-60"
              >
                {savingPass ? '⏳ Actualizando…' : '🔐 Actualizar contraseña'}
              </button>
            </div>
          </div>
        ) : (
          <div className="p-6 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                <span className="text-blue-600">ℹ️</span>
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