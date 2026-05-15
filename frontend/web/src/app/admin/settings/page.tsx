'use client'

import AdminOperationalSettingsPanel, {
  type OperationalSettingsSection,
  type OperationalSettingsData,
} from '@/components/AdminOperationalSettingsPanel'
import RoleGuard from '@/components/RoleGuard'
import { api } from '@/lib/api'
import { Fingerprint, Loader2, Settings, Timer } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

type SettingsResponse = OperationalSettingsData

type SettingsSection = OperationalSettingsSection

const SETTINGS_SECTIONS: {
  id: SettingsSection
  label: string
  desc: string
  Icon: typeof Settings
}[] = [
  {
    id: 'system',
    label: 'Sistema',
    desc: 'Estado general y monitor automático.',
    Icon: Settings,
  },
  {
    id: 'attendance',
    label: 'Asistencia',
    desc: 'Tolerancias, tardanzas y reloj biométrico.',
    Icon: Timer,
  },
  {
    id: 'identity',
    label: 'Identidad',
    desc: 'Verificación Didit y prueba de vida.',
    Icon: Fingerprint,
  },
]

export default function AdminSystemSettingsPage() {
  const [data, setData] = useState<SettingsResponse | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [section, setSection] = useState<SettingsSection>('system')

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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const s = params.get('section')
    if (s === 'attendance' || s === 'identity' || s === 'system') setSection(s)
  }, [])

  function selectSection(nextSection: SettingsSection) {
    setSection(nextSection)
    const url =
      nextSection === 'system' ? '/admin/settings' : `/admin/settings?section=${nextSection}`
    window.history.replaceState(null, '', url)
  }

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
  }

  return (
    <RoleGuard permission="settings.manage">
      <main className="mx-auto max-w-7xl p-6 space-y-6">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold uppercase text-emerald-700">Solo administradores</p>
          <h1 className="text-2xl font-bold text-gray-950">Configuración del sistema</h1>
          <p className="max-w-3xl text-sm text-gray-600">
            Ajustes operativos centrales del sistema, separados por área para que cada cambio tenga su lugar.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="self-start rounded-xl border border-gray-200 bg-white p-2 shadow-sm">
            {SETTINGS_SECTIONS.map(({ id, label, desc, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => selectSection(id)}
                className={`flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left transition ${
                  section === id ? 'bg-emerald-50 text-emerald-900' : 'text-gray-700 hover:bg-slate-50'
                }`}
              >
                <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-emerald-700 ring-1 ring-emerald-100">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold">{label}</span>
                  <span className="block text-xs text-gray-500">{desc}</span>
                </span>
              </button>
            ))}
          </aside>

          <div className="min-w-0">
            {!data ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-gray-200 bg-white py-16 shadow-sm">
                <Loader2 className="h-8 w-8 animate-spin text-emerald-600/70" aria-hidden />
                <p className="text-sm text-gray-500">Cargando configuración…</p>
              </div>
            ) : (
              <AdminOperationalSettingsPanel
                section={section}
                data={data}
                setData={setData}
                saving={saving}
                msg={msg}
                onSave={save}
                onReload={load}
              />
            )}
          </div>
        </div>
      </main>
    </RoleGuard>
  )
}
