'use client'

import { Loader2, RefreshCw, Save, Shield, SlidersHorizontal } from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'

/** Offset GMT en vivo de una zona IANA (refleja horario de verano). Ej: "GMT-03:00". */
function gmtOffsetLabel(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(
      new Date(),
    )
    const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? ''
    return name.replace(/^UTC/, 'GMT') || 'GMT'
  } catch {
    return ''
  }
}

export type OperationalSettingsData = {
  attendanceNoShowGraceMinutes: number
  attendanceLateToleranceMinutes: number
  attendanceEarlyExitToleranceMinutes: number
  attendanceClassBridgeGapMinutes: number
  attendanceMonitorEnabled: boolean
  attendanceMonitorIntervalMs: number
  biometricDuplicateWindowMinutes: number
  institutionTimezone: string
  institutionTimezoneOptions: ReadonlyArray<{ value: string; label: string }>
}

export type OperationalSettingsSection = 'system' | 'attendance'

type Props = {
  section?: OperationalSettingsSection
  data: OperationalSettingsData
  setData: Dispatch<SetStateAction<OperationalSettingsData | null>>
  saving: boolean
  msg: string | null
  onSave: () => void
  onReload: () => void
}

const shellCard = 'rounded-xl border border-gray-200/80 bg-white p-5 shadow-sm'
const labelCls = 'block text-xs font-medium uppercase tracking-wide text-gray-500'

function SaveBar({ saving, onSave, onReload }: Pick<Props, 'saving' | 'onSave' | 'onReload'>) {
  return (
    <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center">
      <button type="button" onClick={() => void onReload()} className="btn-secondary inline-flex items-center justify-center gap-2 text-sm">
        <RefreshCw className="h-4 w-4" aria-hidden />
        Recargar
      </button>
      <button type="button" onClick={onSave} className="btn-primary inline-flex items-center justify-center gap-2 text-sm disabled:opacity-60" disabled={saving}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
        {saving ? 'Guardando…' : 'Guardar configuración'}
      </button>
    </div>
  )
}

export default function AdminOperationalSettingsPanel({
  section = 'system',
  data,
  setData,
  saving,
  msg,
  onSave,
  onReload,
}: Props) {
  const copy = {
    system: {
      title: 'Configuración del sistema',
      desc: 'Estado general del sistema y comportamiento del monitor automático.',
      Icon: Shield,
    },
    attendance: {
      title: 'Asistencia y registro horario',
      desc: 'Parámetros separados para evaluar entradas y salidas del personal.',
      Icon: SlidersHorizontal,
    },
  }[section]
  const HeaderIcon = copy.Icon

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-emerald-100 bg-gradient-to-br from-white via-white to-emerald-50/40 p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-emerald-100">
              <HeaderIcon className="h-5 w-5 text-emerald-700" aria-hidden />
            </span>
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-gray-900">{copy.title}</h2>
              <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-gray-600">{copy.desc}</p>
            </div>
          </div>
          <SaveBar saving={saving} onSave={onSave} onReload={onReload} />
        </div>
      </section>

      {section === 'system' && (
        <>
        <section className={`${shellCard} space-y-5`}>
          <div className="border-b border-gray-100 pb-4">
            <h3 className="text-sm font-semibold text-gray-900">Zona horaria institucional</h3>
            <p className="text-xs text-gray-500">
              Define el calendario civil y los horarios que usa el backend (eventos, asistencias, reportes).
            </p>
          </div>
          <label className="block space-y-2 sm:max-w-md">
            <span className={labelCls}>Zona horaria (IANA)</span>
            <select
              className="input-modern w-full text-sm"
              value={data.institutionTimezone}
              onChange={(e) => setData((prev) => (prev ? { ...prev, institutionTimezone: e.target.value } : prev))}
            >
              {data.institutionTimezoneOptions.map((opt) => {
                const gmt = gmtOffsetLabel(opt.value)
                return (
                  <option key={opt.value} value={opt.value}>
                    {gmt ? `${opt.label} (${gmt})` : opt.label}
                  </option>
                )
              })}
            </select>
            <span className="block text-xs text-slate-500">
              Por defecto: Uruguay (Montevideo). Los cambios aplican al guardar; puede requerir recargar otras pantallas.
            </span>
          </label>
        </section>

        <section className={`${shellCard} space-y-5`}>
          <div className="border-b border-gray-100 pb-4">
            <h3 className="text-sm font-semibold text-gray-900">Monitor automático</h3>
            <p className="text-xs text-gray-500">Controla la generación automática de incidencias operativas.</p>
          </div>
          <label className="flex cursor-pointer flex-col gap-3 rounded-xl border border-gray-100 bg-slate-50/40 px-4 py-3.5 transition hover:border-emerald-100 hover:bg-emerald-50/20 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <span className="text-sm font-medium text-gray-800">Monitor automático de incidentes</span>
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
              checked={data.attendanceMonitorEnabled}
              onChange={(e) => setData((prev) => (prev ? { ...prev, attendanceMonitorEnabled: e.target.checked } : prev))}
            />
          </label>
          <label className="block space-y-2">
            <span className={labelCls}>Intervalo del monitor (ms)</span>
            <input
              type="number"
              min={30000}
              max={3600000}
              step={1000}
              className="input-modern w-full text-sm tabular-nums sm:max-w-xs"
              value={data.attendanceMonitorIntervalMs}
              onChange={(e) => setData((prev) => (prev ? { ...prev, attendanceMonitorIntervalMs: Number(e.target.value) || 30000 } : prev))}
            />
          </label>
        </section>
        </>
      )}

      {section === 'attendance' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <section className={`${shellCard} space-y-5`}>
            <div className="border-b border-gray-100 pb-4">
              <h3 className="text-sm font-semibold text-gray-900">Entrada</h3>
              <p className="text-xs text-gray-500">Reglas usadas para presentes, tardanzas y no-show al iniciar actividad.</p>
            </div>
            <label className="block space-y-2">
              <span className={labelCls}>Tolerancia llegada tarde (min)</span>
              <input
                type="number"
                min={0}
                max={120}
                className="input-modern w-full text-sm tabular-nums"
                value={data.attendanceLateToleranceMinutes}
                onChange={(e) => setData((prev) => (prev ? { ...prev, attendanceLateToleranceMinutes: Number(e.target.value) || 0 } : prev))}
              />
              <span className="block text-xs text-slate-500">
                Minutos de gracia luego del inicio de la clase antes de marcar la entrada como TARDE.
              </span>
            </label>
            <label className="block space-y-2">
              <span className={labelCls}>Ausencia docente (min)</span>
              <input
                type="number"
                min={1}
                max={180}
                className="input-modern w-full text-sm tabular-nums"
                value={data.attendanceNoShowGraceMinutes}
                onChange={(e) => setData((prev) => (prev ? { ...prev, attendanceNoShowGraceMinutes: Number(e.target.value) || 1 } : prev))}
              />
              <span className="block text-xs text-slate-500">
                Minutos sin marcar luego del inicio para dar al docente por ausente y generar el incidente.
              </span>
            </label>
            <label className="block space-y-2">
              <span className={labelCls}>Ventana de entrada anticipada (min)</span>
              <input
                type="number"
                min={90}
                max={240}
                className="input-modern w-full text-sm tabular-nums"
                value={data.attendanceClassBridgeGapMinutes}
                onChange={(e) => setData((prev) => (prev ? { ...prev, attendanceClassBridgeGapMinutes: Number(e.target.value) || 90 } : prev))}
              />
              <span className="block text-xs text-slate-500">
                Cuánto antes del inicio de una clase se admite una marca de entrada para asociarla a esa
                clase (entre 90 y 240 min).
              </span>
            </label>
          </section>

          <section className={`${shellCard} space-y-5`}>
            <div className="border-b border-gray-100 pb-4">
              <h3 className="text-sm font-semibold text-gray-900">Salida</h3>
              <p className="text-xs text-gray-500">Reglas usadas para salida normal y salida anticipada al cerrar actividad.</p>
            </div>
            <label className="block space-y-2">
              <span className={labelCls}>Tolerancia salida anticipada (min)</span>
              <input
                type="number"
                min={0}
                max={120}
                className="input-modern w-full text-sm tabular-nums"
                value={data.attendanceEarlyExitToleranceMinutes}
                onChange={(e) => setData((prev) => (prev ? { ...prev, attendanceEarlyExitToleranceMinutes: Number(e.target.value) || 0 } : prev))}
              />
            </label>
          </section>

          <section className={`${shellCard} space-y-5 lg:col-span-2`}>
            <div className="border-b border-gray-100 pb-4">
              <h3 className="text-sm font-semibold text-gray-900">Biométrico</h3>
              <p className="text-xs text-gray-500">Ventana para huellas repetidas: la entrada conserva la primera y la salida conserva la última.</p>
            </div>
            <label className="block space-y-2 sm:max-w-sm">
              <span className={labelCls}>Ventana huellas repetidas (min)</span>
              <input
                type="number"
                min={0}
                max={120}
                className="input-modern w-full text-sm tabular-nums"
                value={data.biometricDuplicateWindowMinutes}
                onChange={(e) => setData((prev) => (prev ? { ...prev, biometricDuplicateWindowMinutes: Number(e.target.value) || 0 } : prev))}
              />
            </label>
          </section>
        </div>
      )}

      {msg ? (
        <div
          className={`rounded-lg border px-3 py-2.5 text-sm ${
            msg.includes('No se pudo') ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50/80 text-emerald-900'
          }`}
          role="status"
        >
          {msg}
        </div>
      ) : null}
    </div>
  )
}
