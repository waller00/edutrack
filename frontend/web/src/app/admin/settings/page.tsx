'use client'
import { useCallback, useEffect, useState } from 'react'
import RoleGuard from '@/components/RoleGuard'
import AdminProfilesPanel from '@/components/AdminProfilesPanel'
import { api } from '@/lib/api'
import { IdCard, Shield, UserCog } from 'lucide-react'

<<<<<<< Updated upstream
type SettingsResponse = {
  diditConfigured: boolean
  livenessCheckEnabled: boolean
  attendanceNoShowGraceMinutes: number
  attendanceLateToleranceMinutes: number
  attendanceClassBridgeGapMinutes: number
  attendanceMonitorEnabled: boolean
  attendanceMonitorIntervalMs: number
  biometricLateHour: number
  biometricLateMinute: number
}

export default function AdminSystemSettingsPage() {
  const [data, setData] = useState<SettingsResponse | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
=======
type SettingsResponse = { diditConfigured: boolean }
type SettingsSection = 'registration' | 'profiles'

const SETTINGS_SECTIONS: { id: SettingsSection; label: string; desc: string }[] = [
  {
    id: 'registration',
    label: 'Registro y verificación',
    desc: 'Estado del alta de personas y verificación online.',
  },
  {
    id: 'profiles',
    label: 'Perfiles y permisos',
    desc: 'Roles, perfiles y matriz de permisos por módulo.',
  },
]

export default function AdminSystemSettingsPage() {
  const [data, setData] = useState<SettingsResponse | null>(null)
  const [section, setSection] = useState<SettingsSection>('registration')
>>>>>>> Stashed changes

  const load = useCallback(async () => {
    try {
      const r = await api<SettingsResponse>('/admin/system-settings')
      setData(r)
    } catch {
      setData(null)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

<<<<<<< Updated upstream
  async function save() {
    if (!data) return
    setSaving(true)
    setMsg(null)
    try {
      const updated = await api<SettingsResponse>('/admin/system-settings', {
        method: 'PUT',
        body: JSON.stringify({
          livenessCheckEnabled: data.livenessCheckEnabled,
          attendanceNoShowGraceMinutes: data.attendanceNoShowGraceMinutes,
          attendanceLateToleranceMinutes: data.attendanceLateToleranceMinutes,
          attendanceClassBridgeGapMinutes: data.attendanceClassBridgeGapMinutes,
          attendanceMonitorEnabled: data.attendanceMonitorEnabled,
          attendanceMonitorIntervalMs: data.attendanceMonitorIntervalMs,
          biometricLateHour: data.biometricLateHour,
          biometricLateMinute: data.biometricLateMinute,
        }),
      })
      setData(updated)
      setMsg('Configuración guardada correctamente.')
    } catch {
      setMsg('No se pudo guardar la configuración.')
    } finally {
      setSaving(false)
    }
=======
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('section') === 'profiles') setSection('profiles')
  }, [])

  function selectSection(nextSection: SettingsSection) {
    setSection(nextSection)
    const url = nextSection === 'registration' ? '/admin/settings' : `/admin/settings?section=${nextSection}`
    window.history.replaceState(null, '', url)
>>>>>>> Stashed changes
  }

  return (
    <RoleGuard allow={['ADMIN']}>
      <main className="mx-auto max-w-7xl p-6 space-y-6">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold uppercase text-emerald-700">Solo administradores</p>
          <h1 className="text-2xl font-bold text-gray-950">Configuración del sistema</h1>
          <p className="max-w-3xl text-sm text-gray-600">
            Ajustes operativos centrales del sistema, separados por área para que cada cambio tenga su lugar.
          </p>
        </div>

<<<<<<< Updated upstream
        {!data ? (
          <p className="text-gray-500">Cargando…</p>
        ) : (
          <div className="card space-y-4">
            <h2 className="text-base font-semibold text-gray-900">Parámetros operativos de asistencia</h2>

            <label className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 p-3">
              <span className="text-sm text-gray-700">Monitor automático de incidentes</span>
              <input
                type="checkbox"
                checked={data.attendanceMonitorEnabled}
                onChange={(e) => setData((prev) => (prev ? { ...prev, attendanceMonitorEnabled: e.target.checked } : prev))}
              />
            </label>

            <label className="block space-y-1">
              <span className="text-sm text-gray-700">Tolerancia no-show docente (minutos)</span>
              <input
                type="number"
                min={1}
                max={180}
                className="input-modern w-full"
                value={data.attendanceNoShowGraceMinutes}
                onChange={(e) =>
                  setData((prev) =>
                    prev ? { ...prev, attendanceNoShowGraceMinutes: Number(e.target.value) || 1 } : prev,
                  )
                }
              />
            </label>

            <label className="block space-y-1">
              <span className="text-sm text-gray-700">Tolerancia de llegada tarde (minutos)</span>
              <input
                type="number"
                min={0}
                max={120}
                className="input-modern w-full"
                value={data.attendanceLateToleranceMinutes}
                onChange={(e) =>
                  setData((prev) =>
                    prev ? { ...prev, attendanceLateToleranceMinutes: Number(e.target.value) || 0 } : prev,
                  )
                }
              />
            </label>

            <label className="block space-y-1">
              <span className="text-sm text-gray-700">
                Puente entre clases (minutos). Menor a este hueco = un solo par entrada/salida para el bloque; mayor o
                igual = nueva entrada obligatoria.
              </span>
              <input
                type="number"
                min={15}
                max={240}
                className="input-modern w-full"
                value={data.attendanceClassBridgeGapMinutes}
                onChange={(e) =>
                  setData((prev) =>
                    prev ? { ...prev, attendanceClassBridgeGapMinutes: Number(e.target.value) || 60 } : prev,
                  )
                }
              />
            </label>

            <label className="block space-y-1">
              <span className="text-sm text-gray-700">Intervalo del monitor (ms)</span>
              <input
                type="number"
                min={30000}
                max={3600000}
                step={1000}
                className="input-modern w-full"
                value={data.attendanceMonitorIntervalMs}
                onChange={(e) =>
                  setData((prev) =>
                    prev ? { ...prev, attendanceMonitorIntervalMs: Number(e.target.value) || 30000 } : prev,
                  )
                }
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-sm text-gray-700">Hora de tardanza biométrica</span>
                <input
                  type="number"
                  min={0}
                  max={23}
                  className="input-modern w-full"
                  value={data.biometricLateHour}
                  onChange={(e) =>
                    setData((prev) => (prev ? { ...prev, biometricLateHour: Number(e.target.value) || 0 } : prev))
                  }
                />
              </label>
              <label className="block space-y-1">
                <span className="text-sm text-gray-700">Minuto de tardanza biométrica</span>
                <input
                  type="number"
                  min={0}
                  max={59}
                  className="input-modern w-full"
                  value={data.biometricLateMinute}
                  onChange={(e) =>
                    setData((prev) => (prev ? { ...prev, biometricLateMinute: Number(e.target.value) || 0 } : prev))
                  }
                />
              </label>
            </div>

            <label className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 p-3">
              <span className="text-sm text-gray-700">Preferencia “liveness” (histórico; no altera Didit)</span>
              <input
                type="checkbox"
                checked={data.livenessCheckEnabled}
                onChange={(e) => setData((prev) => (prev ? { ...prev, livenessCheckEnabled: e.target.checked } : prev))}
              />
            </label>

            <p className="text-sm font-medium text-gray-900">
              Estado Didit en el servidor:{' '}
              <span className={data.diditConfigured ? 'text-emerald-700' : 'text-amber-800'}>
                {data.diditConfigured ? 'Credenciales detectadas — el alta exige Didit' : 'Faltan credenciales Didit'}
              </span>
            </p>
            <p className="text-sm text-gray-600">
              La política del producto es exigir prueba de vida en altas cuando el proceso no está en modo sólo desarrollo:
              necesitás <span className="font-mono text-xs">DIDIT_API_KEY</span> y{' '}
              <span className="font-mono text-xs">DIDIT_WORKFLOW_ID</span> en el backend. Opcionalmente, en desarrollo sin
              Didit podés usar <span className="font-mono text-xs">ALLOW_REGISTER_WITHOUT_DIDIT=true</span> únicamente en
              el servidor.
            </p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={save} className="btn-primary text-sm" disabled={saving}>
                {saving ? 'Guardando...' : 'Guardar configuración'}
              </button>
              <button type="button" onClick={() => void load()} className="btn-secondary text-sm">
                Recargar
              </button>
            </div>
            {msg && <p className="text-sm text-gray-700">{msg}</p>}
=======
        <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="self-start rounded-xl border border-gray-200 bg-white p-2 shadow-sm">
            {SETTINGS_SECTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => selectSection(item.id)}
                className={`flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left transition ${
                  section === item.id ? 'bg-emerald-50 text-emerald-900' : 'text-gray-700 hover:bg-slate-50'
                }`}
              >
                <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-emerald-700 ring-1 ring-emerald-100">
                  {item.id === 'registration' ? <IdCard className="h-4 w-4" aria-hidden /> : <UserCog className="h-4 w-4" aria-hidden />}
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold">{item.label}</span>
                  <span className="block text-xs text-gray-500">{item.desc}</span>
                </span>
              </button>
            ))}
          </aside>

          <div className="min-w-0">
            {section === 'registration' ? (
              <section className="space-y-6">
                <div className="flex items-center gap-3">
                  <div className="rounded-xl bg-emerald-100 p-3">
                    <Shield className="h-7 w-7 text-emerald-700" aria-hidden />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">Registro y alta de personas</h2>
                    <p className="text-sm text-gray-600">
                      Quien crea cuenta debe completar la verificación online con sus datos declarados cuando el servidor
                      está correctamente configurado.
                    </p>
                  </div>
                </div>

                {!data ? (
                  <p className="text-gray-500">Cargando...</p>
                ) : (
                  <div className="card space-y-4">
                    <p className="text-sm font-medium text-gray-900">
                      Estado actual:{' '}
                      <span className={data.diditConfigured ? 'text-emerald-700' : 'text-amber-800'}>
                        {data.diditConfigured
                          ? 'Verificación disponible para nuevos registros'
                          : 'Falta definir las credenciales en el servidor'}
                      </span>
                    </p>
                    {!data.diditConfigured ? (
                      <p className="text-sm text-amber-800">
                        En el entorno de despliegue definí las variables de entorno del verificador (API y flujo) según
                        la documentación del proveedor. Hasta entonces el formulario de registro mostrará que el alta no
                        está disponible.
                      </p>
                    ) : (
                      <p className="text-sm text-gray-600">
                        El servicio de verificación responde en el backend: no hace falta activar ni desactivar nada desde
                        la interfaz.
                      </p>
                    )}
                    <div>
                      <button type="button" onClick={() => void load()} className="btn-secondary text-sm">
                        Consultar estado
                      </button>
                    </div>
                  </div>
                )}
              </section>
            ) : (
              <AdminProfilesPanel compact />
            )}
>>>>>>> Stashed changes
          </div>
        </div>
      </main>
    </RoleGuard>
  )
}
