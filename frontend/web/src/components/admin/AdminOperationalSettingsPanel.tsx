'use client'

import { Loader2, RefreshCw, Save } from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'
import SettingsDetails from './settings/SettingsDetails'

/** Offset GMT actual de una zona IANA, incluido el horario de verano. */
function gmtOffsetLabel(tz: string): string {
  try {
    return (
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        timeZoneName: 'shortOffset',
      })
        .formatToParts(new Date())
        .find((part) => part.type === 'timeZoneName')?.value ?? ''
    )
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
  studentRollCallEditWindowHours: number
  studentRollCallCopyPreviousEnabled: boolean
  studentDailyAbsenceThresholdPercent: number
}

export type OperationalSettingsSection = 'system' | 'attendance'

type Props = {
  section?: OperationalSettingsSection
  data: OperationalSettingsData
  setData: Dispatch<SetStateAction<OperationalSettingsData | null>>
  saving: boolean
  msg: string | null
  dirty?: boolean
  confirmReload?: boolean
  onDiscardReload?: () => void
  onCancelReload?: () => void
  onSave: () => void
  onReload: () => void
}

const fieldClass = 'input-field w-full text-sm tabular-nums'
const cardClass =
  'space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5'

type NumberKey = {
  [K in keyof OperationalSettingsData]: OperationalSettingsData[K] extends number
    ? K
    : never
}[keyof OperationalSettingsData]

export default function AdminOperationalSettingsPanel({
  section = 'system',
  data,
  setData,
  saving,
  msg,
  dirty,
  confirmReload,
  onSave,
  onReload,
  onDiscardReload,
  onCancelReload,
}: Props) {
  function numberField(
    key: NumberKey,
    label: string,
    min: number,
    max: number,
    hint: string,
    divisor = 1,
  ) {
    const id = `setting-${key}`
    return (
      <div className="min-w-0">
        <label
          htmlFor={id}
          className="mb-1.5 block text-sm font-medium text-slate-700"
        >
          {label}
        </label>
        <input
          id={id}
          type="number"
          min={min}
          max={max}
          step={1 / divisor}
          required
          disabled={saving}
          className={fieldClass}
          value={data[key] / divisor}
          aria-describedby={`${id}-hint`}
          onChange={(e) =>
            setData((previous) =>
              previous
                ? { ...previous, [key]: Number(e.target.value) * divisor }
                : previous,
            )
          }
        />
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-slate-500">
          {hint}
        </p>
      </div>
    )
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSave()
      }}
      className="space-y-4"
    >
      {msg && (
        <p
          role={msg.includes('No se pudo') ? 'alert' : 'status'}
          className={`rounded-xl border p-3 text-sm ${msg.includes('No se pudo') ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}
        >
          {msg}
        </p>
      )}
      {section === 'system' ? (
        <>
          <section className={cardClass}>
            <div>
              <h2 className="font-semibold text-slate-900">
                Zona horaria institucional
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Se aplica a los horarios, las asistencias y los reportes.
              </p>
            </div>
            <div className="sm:max-w-md">
              <label
                htmlFor="setting-timezone"
                className="mb-1.5 block text-sm font-medium text-slate-700"
              >
                Zona horaria
              </label>
              <select
                id="setting-timezone"
                className={fieldClass}
                value={data.institutionTimezone}
                disabled={saving}
                onChange={(e) =>
                  setData((previous) =>
                    previous
                      ? { ...previous, institutionTimezone: e.target.value }
                      : previous,
                  )
                }
              >
                {data.institutionTimezoneOptions.map((option) => {
                  const offset = gmtOffsetLabel(option.value)
                  return (
                    <option key={option.value} value={option.value}>
                      {option.label}
                      {offset ? ` (${offset})` : ''}
                    </option>
                  )
                })}
              </select>
              <p className="mt-1.5 text-xs text-slate-500">
                El cambio se aplica al guardar. Recargá las demás pantallas para
                actualizar sus horarios.
              </p>
            </div>
          </section>
          <section className={cardClass}>
            <label className="flex cursor-pointer items-start justify-between gap-4">
              <span className="min-w-0">
                <span className="block font-semibold text-slate-900">
                  Monitor automático de incidentes
                </span>
                <span className="mt-1 block text-sm text-slate-500">
                  Detecta ausencias y otras incidencias del personal.
                </span>
              </span>
              <input
                aria-label="Monitor automático de incidentes"
                type="checkbox"
                checked={data.attendanceMonitorEnabled}
                disabled={saving}
                className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 accent-emerald-600 focus:ring-emerald-500"
                onChange={(e) =>
                  setData((previous) =>
                    previous
                      ? {
                          ...previous,
                          attendanceMonitorEnabled: e.target.checked,
                        }
                      : previous,
                  )
                }
              />
            </label>
            <SettingsDetails
              title="Frecuencia de revisión"
              description={`Cada ${data.attendanceMonitorIntervalMs / 1000} segundos`}
            >
              {numberField(
                'attendanceMonitorIntervalMs',
                'Intervalo de revisión (segundos)',
                30,
                3600,
                'Tiempo entre revisiones automáticas: entre 30 segundos y 1 hora.',
                1000,
              )}
            </SettingsDetails>
          </section>
        </>
      ) : (
        <>
          <section className={cardClass}>
            <div>
              <h2 className="font-semibold text-slate-900">
                Asistencia del personal
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Definí el margen permitido al entrar y salir de clase.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {numberField(
                'attendanceLateToleranceMinutes',
                'Tolerancia de llegada tarde (minutos)',
                0,
                120,
                'Pasado este margen, la entrada se registra como tarde.',
              )}
              {numberField(
                'attendanceEarlyExitToleranceMinutes',
                'Tolerancia de salida anticipada (minutos)',
                0,
                120,
                'Margen permitido antes de terminar la clase.',
              )}
            </div>
          </section>
          <SettingsDetails
            title="Ausencias y entradas anticipadas"
            description="Cuándo registrar una ausencia y cuánto antes admitir una entrada."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {numberField(
                'attendanceNoShowGraceMinutes',
                'Registrar ausencia después de (minutos)',
                1,
                180,
                'Tiempo sin una marca de entrada desde el inicio de clase.',
              )}
              {numberField(
                'attendanceClassBridgeGapMinutes',
                'Admitir entradas hasta (minutos antes)',
                15,
                240,
                'Permite asociar una entrada anticipada a la clase, entre 15 y 240 minutos antes.',
              )}
            </div>
          </SettingsDetails>
          <SettingsDetails
            title="Pase de lista estudiantil"
            description={`${data.studentRollCallEditWindowHours} horas para corregir · Falta diaria desde ${data.studentDailyAbsenceThresholdPercent}% de ausencias`}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {numberField(
                'studentRollCallEditWindowHours',
                'Plazo para corregir el pase de lista (horas)',
                1,
                720,
                'Desde el fin de clase. Después, sólo administración puede corregirlo. El cambio también se aplica a listas anteriores.',
              )}
              {numberField(
                'studentDailyAbsenceThresholdPercent',
                'Umbral de falta diaria (%)',
                1,
                100,
                'Porcentaje de clases ausentes que cuenta como falta entera. Por debajo, una ausencia cuenta como media falta.',
              )}
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-slate-50 p-3">
              <input
                type="checkbox"
                aria-label="Sugerir copiar la hora anterior"
                checked={data.studentRollCallCopyPreviousEnabled}
                disabled={saving}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-emerald-600"
                onChange={(e) =>
                  setData((previous) =>
                    previous
                      ? {
                          ...previous,
                          studentRollCallCopyPreviousEnabled: e.target.checked,
                        }
                      : previous,
                  )
                }
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-700">
                  Sugerir copiar la hora anterior
                </span>
                <span className="mt-1 block text-xs text-slate-500">
                  El docente puede usar la lista anterior del mismo grupo y día.
                  Debe revisarla y confirmarla.
                </span>
              </span>
            </label>
          </SettingsDetails>
          <SettingsDetails
            title="Marcas biométricas repetidas"
            description={`Agrupar marcas tomadas dentro de ${data.biometricDuplicateWindowMinutes} minutos`}
          >
            {numberField(
              'biometricDuplicateWindowMinutes',
              'Ventana de marcas repetidas (minutos)',
              0,
              120,
              'Se conserva la primera marca de entrada y la última de salida.',
            )}
          </SettingsDetails>
        </>
      )}
      {confirmReload && (
        <div
          role="alert"
          className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <p>Tenés cambios sin guardar. Al recargar se perderán.</p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onCancelReload}
              className="font-medium hover:underline"
            >
              Seguir editando
            </button>
            <button
              type="button"
              onClick={onDiscardReload}
              className="font-medium text-red-700 hover:underline"
            >
              Descartar cambios y recargar
            </button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <button
          type="button"
          onClick={onReload}
          disabled={saving}
          className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-emerald-700 disabled:opacity-50"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          Recargar
        </button>
        <div className="flex w-full flex-wrap items-center justify-end gap-3 sm:w-auto">
          {dirty && (
            <span className="text-xs text-amber-700">Cambios sin guardar</span>
          )}
          <button
            type="submit"
            disabled={saving}
            className="btn-primary inline-flex w-full items-center justify-center gap-2 disabled:opacity-60 sm:w-auto"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Save className="h-4 w-4" aria-hidden />
            )}
            {saving ? 'Guardando…' : 'Guardar configuración'}
          </button>
        </div>
      </div>
    </form>
  )
}
