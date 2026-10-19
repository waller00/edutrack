'use client'

import RoleGuard from '@/components/auth/RoleGuard'
import { RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api/client'
import { useAuth } from '@/contexts/AuthContext'
import { hasPermission } from '@/lib/auth/permissions'
import MyAttendanceMarkingPanel from './MyAttendanceMarkingPanel'
import AttendanceHeatmap from '@/components/admin/AttendanceHeatmap'
import SettingsDetails from '@/components/admin/settings/SettingsDetails'
import DateRangePicker from '@/components/forms/DateRangePicker'
import {
  getTodayYmdInUruguay,
  formatTimeInUruguay,
} from '@/lib/forms/datetime-uy'
import { ymdToDmy } from '@/lib/forms/date-mask'
import type {
  AttendanceSummaryResponse,
  AttendanceSummaryPerson,
} from '@/lib/attendance/summary'
import {
  getDefaultAttendanceStartDate,
  getAttendanceTypeStyle,
  getAttendanceTypeLabel,
  getAttendanceStatusStyle,
  getAttendanceStatusLabelForType,
  type MyAttendanceType,
  type MyAttendanceStatus,
} from '@/lib/attendance/my-attendance-display'
import {
  PersonalLoading,
  PersonalError,
  PersonalPagination,
} from './PersonalPageUi'
import ModuleHeader from '@/components/common/ModuleHeader'

type AttendanceRecord = {
  id: string
  type: MyAttendanceType
  status: MyAttendanceStatus
  date: string
  time: string
  notes?: string
  event?: { id: string; title: string; type: string }
}

const ABSENCE_STATUSES = new Set([
  'ABSENT',
  'ABSENT_NOT_JUSTIFIED',
  'ABSENT_JUSTIFIED',
  'SUBSTITUTED',
  'MEDICAL_LEAVE',
  'JUSTIFIED_ABSENCE',
])
const isAbsence = (record: AttendanceRecord) =>
  ABSENCE_STATUSES.has(record.status)
const recordTypeLabel = (record: AttendanceRecord) =>
  isAbsence(record) ? 'Falta' : getAttendanceTypeLabel(record.type)

function getAttendanceRowStatusLabel(attendance: AttendanceRecord) {
  if (
    attendance.status === 'LATE' &&
    attendance.notes?.toLowerCase().includes('llegada muy tarde')
  ) {
    return 'Llegada muy tarde'
  }
  return getAttendanceStatusLabelForType(attendance.type, attendance.status)
}

export default function MyAttendancePage(
  _props: { role?: 'TEACHER' | 'STAFF' } = {},
) {
  return (
    <RoleGuard permission="attendance.read">
      <AttendanceContent />
    </RoleGuard>
  )
}

function AttendanceContent() {
  const { me } = useAuth()
  const userId = me?.id
  const [attendances, setAttendances] = useState<AttendanceRecord[]>([])
  const [summary, setSummary] = useState<AttendanceSummaryPerson | null>(null)
  const [summaryError, setSummaryError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [startDate, setStartDate] = useState(getDefaultAttendanceStartDate())
  const [endDate, setEndDate] = useState(getTodayYmdInUruguay())
  const [refresh, setRefresh] = useState(0)
  const [view, setView] = useState('history')
  const [type, setType] = useState('')
  const [page, setPage] = useState(1)
  const canMark =
    hasPermission(me, 'attendance.create') && hasPermission(me, 'events.read')
  const rangeError =
    startDate && endDate && startDate > endDate
      ? 'La fecha de fin debe ser posterior al inicio.'
      : null
  useEffect(() => {
    if (!userId || rangeError) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setSummary(null)
    setSummaryError(false)
    const params = new URLSearchParams({ includeAbsences: 'true' })
    if (startDate) params.set('startDate', startDate)
    if (endDate) params.set('endDate', endDate)
    const summaryParams = new URLSearchParams({
      userId,
      to: endDate || getTodayYmdInUruguay(),
    })
    if (startDate) summaryParams.set('from', startDate)
    async function load() {
      const [records, result] = await Promise.allSettled([
        api<AttendanceRecord[]>(`/attendance/my-attendances?${params}`),
        api<AttendanceSummaryResponse>(`/attendance/summary?${summaryParams}`),
      ])
      if (cancelled) return
      if (records.status === 'fulfilled')
        setAttendances(Array.isArray(records.value) ? records.value : [])
      else {
        setAttendances([])
        setError('No se pudieron cargar tus asistencias.')
      }
      if (result.status === 'fulfilled')
        setSummary(result.value?.person ?? null)
      else setSummaryError(true)
      setLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [userId, startDate, endDate, refresh, rangeError])
  const visible = attendances.filter(
    (record) =>
      !type ||
      (type === 'absences'
        ? isAbsence(record)
        : record.type === type && !isAbsence(record)),
  )
  const safePage = Math.min(page, Math.max(1, Math.ceil(visible.length / 20)))
  const activeView = view === 'marking' && !canMark ? 'history' : view
  return (
    <main className="responsive-page max-w-6xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <ModuleHeader id="my-attendance" />
        <button
          type="button"
          onClick={() => setRefresh((value) => value + 1)}
          className="btn-secondary inline-flex items-center gap-2 text-sm"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          Actualizar
        </button>
      </div>
      <div className="grid items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-[minmax(0,24rem)_1fr]">
        <DateRangePicker
          startDate={startDate}
          endDate={endDate}
          onChange={(range) => {
            setStartDate(range.startDate)
            setEndDate(range.endDate)
            setPage(1)
          }}
        />
        <p className="text-xs text-slate-500">
          {loading
            ? 'Consultando el período…'
            : `Total: ${attendances.length} registros`}
        </p>
      </div>
      <div
        role="group"
        aria-label="Vistas de mis asistencias"
        className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1"
      >
        {[
          ['history', 'Historial'],
          ['summary', 'Resumen'],
          ...(canMark ? [['marking', 'Marcar asistencia']] : []),
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={activeView === id}
            onClick={() => setView(id)}
            className={`min-h-10 flex-1 rounded-lg px-3 py-2 text-sm ${activeView === id ? 'bg-emerald-50 font-medium text-emerald-700' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {rangeError ? (
        <p role="alert" className="text-sm text-red-700">
          {rangeError}
        </p>
      ) : activeView === 'marking' && userId ? (
        <MyAttendanceMarkingPanel
          userId={userId}
          onMarked={() => setRefresh((value) => value + 1)}
        />
      ) : loading ? (
        <PersonalLoading />
      ) : error ? (
        <PersonalError
          message={error}
          retry={() => setRefresh((value) => value + 1)}
        />
      ) : activeView === 'summary' ? (
        <>
          {summaryError ? (
            <PersonalError
              message="No se pudo cargar el resumen."
              retry={() => setRefresh((value) => value + 1)}
            />
          ) : summary ? (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[
                  [
                    'Asistencia',
                    `${summary.stats.pctAsistencia}%`,
                    'text-emerald-600',
                  ],
                  [
                    'Puntualidad',
                    `${summary.stats.pctPuntualidad}%`,
                    'text-emerald-600',
                  ],
                  ['Llegadas tarde', summary.stats.tarde, 'text-amber-600'],
                  [
                    'Faltas sin justificar',
                    summary.stats.ausenteNoJustificado,
                    'text-red-600',
                  ],
                ].map(([label, value, color]) => (
                  <article
                    key={label}
                    className="rounded-xl border border-slate-200 bg-white p-4"
                  >
                    <h2 className="text-xs text-slate-500">{label}</h2>
                    <p className={`mt-2 text-2xl font-bold ${color}`}>
                      {value}
                    </p>
                  </article>
                ))}
              </div>
              <SettingsDetails
                title="Mapa de asistencia"
                description="Consultá la distribución de tus asistencias por día."
              >
                <AttendanceHeatmap
                  rows={summary.rows}
                  from={
                    startDate ||
                    `${(endDate || getTodayYmdInUruguay()).slice(0, 4)}-01-01`
                  }
                  to={endDate || getTodayYmdInUruguay()}
                />
              </SettingsDetails>
            </>
          ) : (
            <p className="rounded-xl border bg-white p-6 text-sm text-slate-500">
              No hay datos de resumen para este período.
            </p>
          )}
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">
              Registros de Asistencia
            </h2>
            <label className="flex items-center gap-2 text-sm text-slate-500">
              Ver
              <select
                aria-label="Tipo de registro"
                value={type}
                onChange={(event) => {
                  setType(event.target.value)
                  setPage(1)
                }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2"
              >
                <option value="">Todos</option>
                <option value="CHECK_IN">Entradas</option>
                <option value="CHECK_OUT">Salidas</option>
                <option value="absences">Faltas</option>
              </select>
            </label>
          </div>
          {visible.length === 0 ? (
            <p className="rounded-xl border bg-white p-6 text-sm text-slate-500">
              No hay registros de asistencia
            </p>
          ) : (
            <ul className="space-y-3">
              {visible
                .slice((safePage - 1) * 20, safePage * 20)
                .map((record) => (
                  <li
                    key={record.id}
                    className="space-y-3 rounded-xl border border-slate-200 bg-white p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-slate-900">
                          {ymdToDmy(record.date.slice(0, 10))} ·{' '}
                          {formatTimeInUruguay(record.time)}
                        </p>
                        {record.event?.title && (
                          <p className="mt-1 text-xs text-slate-500">
                            {record.event.title}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span
                          className={`rounded-full px-2 py-1 text-xs ${isAbsence(record) ? getAttendanceStatusStyle(record.status) : getAttendanceTypeStyle(record.type)}`}
                        >
                          {recordTypeLabel(record)}
                        </span>
                        {getAttendanceRowStatusLabel(record) !==
                          recordTypeLabel(record) && (
                          <span
                            className={`rounded-full px-2 py-1 text-xs ${getAttendanceStatusStyle(record.status)}`}
                          >
                            {getAttendanceRowStatusLabel(record)}
                          </span>
                        )}
                      </div>
                    </div>
                    {record.notes && (
                      <SettingsDetails title="Notas del registro">
                        <p className="text-sm text-slate-600">{record.notes}</p>
                      </SettingsDetails>
                    )}
                  </li>
                ))}
            </ul>
          )}
          <PersonalPagination
            page={safePage}
            total={visible.length}
            onPage={setPage}
          />
        </>
      )}
    </main>
  )
}
