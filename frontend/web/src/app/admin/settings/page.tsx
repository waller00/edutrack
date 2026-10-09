'use client'

import AdminOperationalSettingsPanel, {
  type OperationalSettingsSection,
  type OperationalSettingsData,
} from '@/components/admin/AdminOperationalSettingsPanel'
import AdminBiometricDevicesPanel from '@/components/admin/AdminBiometricDevicesPanel'
import AdminMoodlePanel from '@/components/admin/AdminMoodlePanel'
import RoleGuard from '@/components/auth/RoleGuard'
import { api } from '@/lib/api/client'
import { BookOpen, Cpu, Loader2, Settings, Timer } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

type SettingsResponse = OperationalSettingsData

type SettingsSection = OperationalSettingsSection | 'readers' | 'moodle'

const SETTINGS_SECTIONS: {
  id: SettingsSection
  label: string
  Icon: typeof Settings
}[] = [
  {
    id: 'system',
    label: 'Sistema',
    Icon: Settings,
  },
  {
    id: 'attendance',
    label: 'Asistencia',
    Icon: Timer,
  },
  {
    id: 'moodle',
    label: 'Moodle',
    Icon: BookOpen,
  },
  {
    id: 'readers',
    label: 'Lectores',
    Icon: Cpu,
  },
]

export default function AdminSystemSettingsPage() {
  const [data, setData] = useState<SettingsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [savedData, setSavedData] = useState<SettingsResponse | null>(null)
  const [confirmReload, setConfirmReload] = useState(false)
  const [visited, setVisited] = useState<SettingsSection[]>([])
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [section, setSection] = useState<SettingsSection>('system')

  function normalize(data: SettingsResponse): SettingsResponse {
    return {
      ...data,
      attendanceEarlyExitToleranceMinutes:
        data.attendanceEarlyExitToleranceMinutes ??
        data.attendanceLateToleranceMinutes ??
        5,
      biometricDuplicateWindowMinutes:
        data.biometricDuplicateWindowMinutes ?? 5,
      institutionTimezone: data.institutionTimezone ?? 'America/Montevideo',
      institutionTimezoneOptions: data.institutionTimezoneOptions ?? [
        { value: 'America/Montevideo', label: 'Uruguay — Montevideo' },
      ],
      studentRollCallEditWindowHours: data.studentRollCallEditWindowHours ?? 48,
      studentRollCallCopyPreviousEnabled:
        data.studentRollCallCopyPreviousEnabled ?? true,
      studentDailyAbsenceThresholdPercent:
        data.studentDailyAbsenceThresholdPercent ?? 50,
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    setConfirmReload(false)
    setMsg(null)
    try {
      const updated = normalize(
        await api<SettingsResponse>('/admin/system-settings'),
      )
      setData(updated)
      setSavedData(updated)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [])
  const dirty = JSON.stringify(data) !== JSON.stringify(savedData)

  function reload() {
    if (dirty) setConfirmReload(true)
    else void load()
  }

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const params = new URLSearchParams(globalThis.location.search)
    const s = params.get('section')
    if (
      s === 'attendance' ||
      s === 'system' ||
      s === 'readers' ||
      s === 'moodle'
    ) {
      setSection(s)
      setVisited([s])
    }
  }, [])

  function selectSection(nextSection: SettingsSection) {
    setSection(nextSection)
    setVisited((previous) =>
      previous.includes(nextSection) ? previous : [...previous, nextSection],
    )
    const url =
      nextSection === 'system'
        ? '/admin/settings'
        : `/admin/settings?section=${nextSection}`
    globalThis.history.replaceState(null, '', url)
  }

  async function save() {
    if (!data) return
    setSaving(true)
    setMsg(null)
    try {
      const updated = await api<SettingsResponse>('/admin/system-settings', {
        method: 'PUT',
        body: JSON.stringify({
          attendanceNoShowGraceMinutes: data.attendanceNoShowGraceMinutes,
          attendanceLateToleranceMinutes: data.attendanceLateToleranceMinutes,
          attendanceEarlyExitToleranceMinutes:
            data.attendanceEarlyExitToleranceMinutes,
          attendanceClassBridgeGapMinutes: data.attendanceClassBridgeGapMinutes,
          attendanceMonitorEnabled: data.attendanceMonitorEnabled,
          attendanceMonitorIntervalMs: data.attendanceMonitorIntervalMs,
          biometricDuplicateWindowMinutes: data.biometricDuplicateWindowMinutes,
          institutionTimezone: data.institutionTimezone,
          studentRollCallEditWindowHours: data.studentRollCallEditWindowHours,
          studentRollCallCopyPreviousEnabled:
            data.studentRollCallCopyPreviousEnabled,
          studentDailyAbsenceThresholdPercent:
            data.studentDailyAbsenceThresholdPercent,
        }),
      })
      setData(normalize(updated))
      setSavedData(normalize(updated))
      setConfirmReload(false)
      setMsg('Configuración guardada correctamente.')
    } catch {
      setMsg('No se pudo guardar la configuración.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <RoleGuard permission="settings.manage" permissionScope="all">
      <main className="responsive-page max-w-5xl space-y-4">
        <header className="flex items-start gap-3">
          <span className="hidden rounded-xl bg-emerald-50 p-3 text-emerald-700 sm:block">
            <Settings className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              Configuración del sistema
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Elegí un área para revisar y ajustar su configuración.
            </p>
          </div>
        </header>
        <div
          role="group"
          aria-label="Secciones de configuración"
          className="grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-white p-1 sm:grid-cols-4"
        >
          {SETTINGS_SECTIONS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => selectSection(id)}
              aria-pressed={section === id}
              aria-controls={
                id === 'system' || id === 'attendance'
                  ? 'settings-operational'
                  : `settings-${id}`
              }
              className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition ${section === id ? 'bg-emerald-50 text-emerald-700' : 'text-slate-500 hover:bg-slate-50'}`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              {label}
            </button>
          ))}
        </div>
        <div
          id="settings-operational"
          hidden={section === 'readers' || section === 'moodle'}
        >
          {loading ? (
            <p
              role="status"
              className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500"
            >
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Cargando configuración…
            </p>
          ) : loadError ? (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
            >
              <p>No se pudo cargar la configuración.</p>
              <button
                type="button"
                onClick={() => void load()}
                className="font-medium hover:underline"
              >
                Reintentar
              </button>
            </div>
          ) : (
            data && (
              <AdminOperationalSettingsPanel
                section={section === 'attendance' ? 'attendance' : 'system'}
                data={data}
                setData={setData}
                saving={saving}
                msg={msg}
                dirty={dirty}
                confirmReload={confirmReload}
                onReload={reload}
                onDiscardReload={() => void load()}
                onCancelReload={() => setConfirmReload(false)}
                onSave={() => void save()}
              />
            )
          )}
        </div>
        <div id="settings-moodle" hidden={section !== 'moodle'}>
          {visited.includes('moodle') && <AdminMoodlePanel />}
        </div>
        <div id="settings-readers" hidden={section !== 'readers'}>
          {visited.includes('readers') && <AdminBiometricDevicesPanel />}
        </div>
      </main>
    </RoleGuard>
  )
}
