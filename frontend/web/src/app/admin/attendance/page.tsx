'use client'
import PaginationControls from '@/components/common/PaginationControls'
import { useOptionalAuth } from '@/contexts/AuthContext'
import { hasPermission } from '@/lib/auth/permissions'
import RoleGuard from '@/components/auth/RoleGuard'
import AttendanceFilters from '@/components/admin/AttendanceFilters'
import AttendanceExportMenu from '@/components/admin/AttendanceExportMenu'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api/client'
import { apiBaseUrl } from '@/lib/api/base-url'
import {
  type AdminAttendanceListFilters,
  ADMIN_ATTENDANCE_LEGEND,
  buildAdminAttendanceAllQueryString,
  getAdminAttendanceDefaultStartDate,
  getAdminAttendanceLegendLabel,
  getAdminAttendancePlannedTimeLabel,
  getAdminAttendanceStatusLabel,
  getAdminAttendanceStatusStyle,
  getAdminAttendanceTypeLabel,
  getAdminAttendanceTypeStyle,
} from '@/lib/admin/attendance-display'
import { formatDateInUruguay, formatTimeInUruguay, getTodayYmdInUruguay } from '@/lib/forms/datetime-uy'
import { getAdminFlashMessageClass } from '@/lib/admin/ui-helpers'
import AdminIncidentsPanel from '@/components/admin/AdminIncidentsPanel'
import AttendanceJustifyModal from '@/components/admin/AttendanceJustifyModal'
import PersonAttendanceDrawer from '@/components/admin/PersonAttendanceDrawer'
import { withSchoolYear } from '@/lib/admin/school-year-query'
import {
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  ClipboardList,
  RefreshCw,
  X,
  Trash2,
} from 'lucide-react'
import StatusDistribution, { type DistributionItem } from '@/components/charts/StatusDistribution'
import ScrollRegion from '@/components/common/ScrollRegion'
import ModuleHeader from '@/components/common/ModuleHeader'

type NovedadesFormat = 'XLSX' | 'CSV'

function getAttendanceRowStatusLabel(attendance: AttendanceRecord) {
  if (attendance.type === 'CHECK_OUT' && attendance.status === 'PRESENT') {
    return 'Salida'
  }
  if (attendance.status === 'ABSENT_NOT_JUSTIFIED' && isExpectedAbsence(attendance)) {
    return 'Ausencia prevista sin justificar'
  }
  if (attendance.status === 'LATE' && attendance.notes?.toLowerCase().includes('llegada muy tarde')) {
    return 'Llegada muy tarde'
  }
  return getAdminAttendanceStatusLabel(attendance.status)
}

function isExpectedAbsence(attendance: Pick<AttendanceRecord, 'notes' | 'status'>): boolean {
  return (
    attendance.status === 'SUBSTITUTED' ||
    (attendance.status === 'ABSENT_NOT_JUSTIFIED' &&
      (Boolean(attendance.notes?.toLowerCase().startsWith('ausencia esperada')) ||
        Boolean(attendance.notes?.toLowerCase().startsWith('ausencia prevista'))))
  )
}

type AttendanceRecord = {
  id: string
  type: 'CHECK_IN' | 'CHECK_OUT' | 'INCIDENT'
  status:
    | 'PRESENT'
    | 'LATE'
    | 'ABSENT_NOT_JUSTIFIED'
    | 'ABSENT_JUSTIFIED'
    | 'EXIT'
    | 'EARLY_EXIT'
    | 'JUSTIFIED'
    | 'SUBSTITUTED'
  date: string
  time: string
  notes?: string
  title?: string
  description?: string
  user: {
    id: string
    name: string
    email: string
    role: string
  }
  event?: {
    id: string
    title: string
    type: string
    startTime?: string
    endTime?: string
  }
}

type AttendanceStats = {
  totalAttendances: number
  presentCount: number
  absentCount: number
  lateCount: number
  medicalLeaveCount: number
  exitCount: number
  earlyExitCount: number
  expectedAbsenceCount?: number
  attendanceRate: number
  lateRate: number
  absenceRate: number
  exitRate: number
  earlyExitRate: number
}

function formatRate(value: unknown): string {
  const rate = Number(value ?? 0)
  return `${Number.isFinite(rate) ? rate : 0}%`
}

type User = {
  id: string
  name: string
  email: string
  role: string
  username?: string
}

type AttendanceStatusOption = AttendanceRecord['status']
type AttendanceTypeOption = Exclude<AttendanceRecord['type'], 'INCIDENT'>

type DisplayAttendanceRecord = AttendanceRecord & {
  isDerived?: boolean
  derivedFromId?: string
}

type AttendancePairRow = {
  key: string
  user: AttendanceRecord['user']
  event?: AttendanceRecord['event']
  eventSummary?: {
    title: string
    type: string
  }
  dateTime: string
  checkIn?: DisplayAttendanceRecord
  checkOut?: DisplayAttendanceRecord
  incident?: AttendanceRecord
}

type AttendanceGroup = {
  user: AttendanceRecord['user']
  attendances: AttendanceRecord[]
}

function isIncidentRow(attendance: AttendanceRecord): boolean {
  return attendance.type === 'INCIDENT' || attendance.id.startsWith('incident:')
}

function isVirtualAbsenceRow(attendance: AttendanceRecord): boolean {
  return attendance.id.startsWith('absence:')
}

function isDerivedAttendanceRow(attendance: DisplayAttendanceRecord | undefined): boolean {
  return Boolean(attendance?.isDerived || attendance?.id.startsWith('derived-checkout:'))
}

function getAttendanceDayGroupKey(attendance: AttendanceRecord): string {
  const dateKey = attendance.date ? attendance.date.slice(0, 10) : attendance.time.slice(0, 10)
  return `${attendance.user.id}:${dateKey}`
}

function getAttendanceEventKey(attendance: AttendanceRecord): string {
  return attendance.event?.id ?? `no-event:${attendance.id}`
}

function summarizeRowEvent(row: Pick<AttendancePairRow, 'checkIn' | 'checkOut' | 'incident' | 'event'>) {
  const incidentEvent = row.incident?.event
  if (incidentEvent) return { title: incidentEvent.title, type: incidentEvent.type }

  const first = row.event ?? row.checkIn?.event ?? row.checkOut?.event

  if (!first) return undefined

  return {
    title: first.title,
    type: first.type,
  }
}

function getPlannedWindowMs(event: AttendanceRecord['event'] | undefined) {
  if (!event?.startTime || !event.endTime) return null
  const start = new Date(event.startTime).getTime()
  const end = new Date(event.endTime).getTime()
  if (Number.isNaN(start) || Number.isNaN(end)) return null
  return { start, end }
}

function checkOutCoversRow(checkOut: AttendanceRecord, row: AttendancePairRow): boolean {
  if (!row.checkIn || row.checkOut || !row.event) return false

  const checkInTime = new Date(row.checkIn.time).getTime()
  const checkOutTime = new Date(checkOut.time).getTime()
  if (Number.isNaN(checkInTime) || Number.isNaN(checkOutTime) || checkOutTime < checkInTime) return false

  const planned = getPlannedWindowMs(row.event)
  if (!planned) return false

  return checkInTime <= planned.end && checkOutTime >= planned.start
}

function deriveCheckOutForRow(checkOut: AttendanceRecord, row: AttendancePairRow): DisplayAttendanceRecord {
  // Salida "esperada": esta clase quedó cubierta por la permanencia continua del día, pero la
  // salida real pertenece a la última clase del tramo. Para no pisar horas entre clases, la fila
  // muestra su propio fin planificado (no la salida real del día) y se marca como salida normal.
  const plannedEndIso = row.event?.endTime ?? checkOut.time

  return {
    ...checkOut,
    id: `derived-checkout:${row.key}:${checkOut.id}`,
    event: row.event,
    time: plannedEndIso,
    status: 'EXIT',
    isDerived: true,
    derivedFromId: checkOut.id,
  }
}

function applyCheckOutToRow(row: AttendancePairRow, checkOut: DisplayAttendanceRecord) {
  row.checkOut = checkOut
  row.dateTime = checkOut.time
  row.event = row.event ?? row.checkIn?.event ?? checkOut.event
  row.eventSummary = summarizeRowEvent(row)
}

function projectCheckOutToCoveredRows(dayRows: AttendancePairRow[], sourceCheckOut: AttendanceRecord, assignedRow: AttendancePairRow | null) {
  for (const row of dayRows) {
    if (row === assignedRow) continue
    if (!checkOutCoversRow(sourceCheckOut, row)) continue
    applyCheckOutToRow(row, deriveCheckOutForRow(sourceCheckOut, row))
  }
}

function buildAttendancePairRows(attendances: AttendanceRecord[]): AttendancePairRow[] {
  const groups = new Map<string, AttendanceGroup>()
  const incidentRows: AttendancePairRow[] = []

  for (const attendance of attendances) {
    if (isIncidentRow(attendance)) {
      incidentRows.push({
        key: attendance.id,
        user: attendance.user,
        event: attendance.event,
        eventSummary: summarizeRowEvent({ incident: attendance }),
        dateTime: attendance.time,
        incident: attendance,
      })
      continue
    }

    const key = getAttendanceDayGroupKey(attendance)
    const group = groups.get(key) ?? {
      user: attendance.user,
      attendances: [],
    }
    group.attendances.push(attendance)
    groups.set(key, group)
  }

  const rows = [...incidentRows]
  for (const [key, group] of groups) {
    const dayRows: AttendancePairRow[] = []
    const ordered = [...group.attendances].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())

    for (const attendance of ordered) {
      if (attendance.type === 'CHECK_IN') {
        const row: AttendancePairRow = {
          key: `${key}:event:${getAttendanceEventKey(attendance)}:in:${attendance.id}`,
          user: group.user,
          event: attendance.event,
          eventSummary: summarizeRowEvent({ checkIn: attendance }),
          dateTime: attendance.time,
          checkIn: attendance,
        }
        dayRows.push(row)
        continue
      }

      const attendanceTime = new Date(attendance.time).getTime()
      const sameEventRow = dayRows.find((row) => {
        if (!row.checkIn || row.checkOut) return false
        if (!row.event?.id || row.event.id !== attendance.event?.id) return false
        return new Date(row.checkIn.time).getTime() <= attendanceTime
      })

      if (sameEventRow) {
        applyCheckOutToRow(sameEventRow, attendance)
        projectCheckOutToCoveredRows(dayRows, attendance, sameEventRow)
        continue
      }

      const row: AttendancePairRow = {
        key: `${key}:out:${attendance.id}`,
        user: group.user,
        event: attendance.event,
        eventSummary: summarizeRowEvent({ checkOut: attendance }),
        dateTime: attendance.time,
        checkOut: attendance,
      }
      dayRows.push(row)
      projectCheckOutToCoveredRows(dayRows, attendance, row)
    }

    rows.push(...dayRows)
  }

  return rows.sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime())
}

function getSelectableIdsForRows(rows: AttendancePairRow[]): string[] {
  return rows.flatMap((row) =>
    [row.checkIn, row.checkOut]
      .filter((attendance): attendance is DisplayAttendanceRecord => Boolean(attendance))
      .filter((attendance) => !isDerivedAttendanceRow(attendance))
      .filter((attendance) => !attendance.id.startsWith('incident:'))
      .map((attendance) => attendance.id),
  )
}

function renderAttendanceMark(
  attendance: DisplayAttendanceRecord | undefined,
  fallback: string,
  onEdit: ((attendance: AttendanceRecord) => void) | undefined,
) {
  if (!attendance) {
    return <span className="text-sm text-gray-400">{fallback}</span>
  }

  return (
    <div className="space-y-2">
      <div>
        <div className="font-semibold tabular-nums text-slate-900">{formatTimeInUruguay(attendance.time)}</div>
        {attendance.event && (
          <div className="text-xs text-gray-500">
            Planificado: {getAdminAttendancePlannedTimeLabel(attendance)}
          </div>
        )}
      </div>
      <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${getAdminAttendanceStatusStyle(attendance.status)}`}>
        {getAttendanceRowStatusLabel(attendance)}
      </span>
      {isDerivedAttendanceRow(attendance) || !onEdit ? null : (
        <div>
          <button type="button" onClick={() => onEdit(attendance)} className="rounded text-xs font-medium text-emerald-700 hover:underline">
            Editar
          </button>
        </div>
      )}
    </div>
  )
}

function renderEventSummary(row: AttendancePairRow, expanded: boolean, onToggle: () => void) {
  if (!row.eventSummary) {
    return <span className="text-gray-400">Sin evento</span>
  }

  const entryEvent = row.checkIn?.event
  const exitEvent = row.checkOut?.event
  const hasLinkedEvents = Boolean(entryEvent || exitEvent)
  const hasProjectedExit = isDerivedAttendanceRow(row.checkOut)

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex items-start gap-2">
        {hasLinkedEvents ? (
          <button
            type="button"
            onClick={onToggle}
            className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-slate-200 text-slate-500 hover:bg-slate-50"
            aria-label={expanded ? 'Ocultar detalle de eventos' : 'Mostrar detalle de eventos'}
            aria-expanded={expanded}
          >
            {expanded ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
          </button>
        ) : null}
        <div className="min-w-0">
          <div className="break-words font-medium">{row.eventSummary.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
            <span>{getEventTypeLabel(row.eventSummary.type)}</span>
            {hasProjectedExit ? (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 ring-1 ring-emerald-100">
                Permanencia correlacionada
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {expanded && hasLinkedEvents ? (
        <div className="space-y-1.5 rounded-lg border border-slate-100 bg-slate-50/80 p-2 text-xs text-slate-700">
          {entryEvent ? (
            <div className="flex items-start gap-2">
              <span className="mt-0.5 rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800">Entrada</span>
              <div className="min-w-0">
                <div className="font-medium text-slate-800">{entryEvent.title}</div>
                <div className="text-slate-500">Planificado: {getAdminAttendancePlannedTimeLabel(row.checkIn!)}</div>
              </div>
            </div>
          ) : null}
          {exitEvent ? (
            <div className="flex items-start gap-2">
              <span className="mt-0.5 rounded bg-sky-100 px-1.5 py-0.5 font-medium text-sky-800">Salida</span>
              <div className="min-w-0">
                <div className="font-medium text-slate-800">{exitEvent.title}</div>
                <div className="text-slate-500">Planificado: {getAdminAttendancePlannedTimeLabel(row.checkOut!)}</div>
              </div>
            </div>
          ) : null}
          {hasProjectedExit ? (
            <div className="pt-1 text-[11px] text-slate-500">Salida esperada: cubierta por la permanencia continua del día (la salida real se imputa a la última clase del tramo).</div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function renderUserCell(user: AttendanceRecord['user'], onUserClick: (user: AttendanceRecord['user']) => void) {
  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => onUserClick(user)}
        className="break-words text-left font-medium text-emerald-700 hover:underline"
      >
        {user.name}
      </button>
      <div className="mt-1 text-xs text-slate-500">{{ ADMIN: 'Administración', TEACHER: 'Docente', STAFF: 'Personal', STUDENT: 'Estudiante' }[user.role] || user.role}</div>
    </div>
  )
}

function getEventTypeLabel(type: string) {
  return { CLASE: 'Clase', REUNION: 'Reunión', JORNADA_LABORAL: 'Jornada laboral' }[type] || type
}

function renderRowNotes(row: AttendancePairRow) {
  const notes = row.incident
    ? row.incident.notes || row.incident.description
    : [row.checkIn?.notes, row.checkOut?.notes].filter(Boolean).join(' / ')
  if (!notes) return null
  return (
    <details className="mt-2 text-xs">
      <summary className="w-fit cursor-pointer rounded text-slate-500 hover:text-emerald-700">Ver notas</summary>
      <p className="mt-2 max-w-sm whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-2.5 leading-relaxed text-slate-600">{notes}</p>
    </details>
  )
}

function renderAttendancesTable(
  attendances: AttendanceRecord[],
  selectedAttendanceIds: string[],
  onToggleSelectAll: () => void,
  onToggleSelect: (id: string) => void,
  expandedRowKeys: string[],
  onToggleExpandedRow: (key: string) => void,
  onEdit: ((attendance: AttendanceRecord) => void) | undefined,
  allSelected: boolean,
  onUserClick: (user: AttendanceRecord['user']) => void,
  canSelect: boolean,
) {
  if (attendances.length === 0) {
    return <div className="p-4 text-center text-gray-500 sm:p-6">No hay registros de asistencia</div>
  }

  const rows = buildAttendancePairRows(attendances)

  return (
    <ScrollRegion label="Tabla de asistencias" className="hidden overflow-x-auto sm:block">
      <table className="w-full min-w-[820px] text-left">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              {canSelect && <input
                type="checkbox"
                checked={allSelected}
                onChange={onToggleSelectAll}
                aria-label="Seleccionar todas las asistencias"
              />}
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Persona</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fecha</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Entrada</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Salida</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Evento</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {rows.map((row) => {
            const ids = [row.checkIn, row.checkOut]
              .filter((attendance): attendance is DisplayAttendanceRecord => Boolean(attendance))
              .filter((attendance) => !isDerivedAttendanceRow(attendance))
              .map((attendance) => attendance.id)
            const selected = ids.length > 0 && ids.every((id) => selectedAttendanceIds.includes(id))
            const primaryAttendance = row.incident ?? row.checkIn ?? row.checkOut
            const selectable = ids.length > 0 && ids.every((id) => !id.startsWith('incident:'))

            if (!primaryAttendance) return null

            return (
              <tr key={row.key} className={selected ? 'bg-emerald-50/60' : row.incident ? 'bg-red-50/20' : 'hover:bg-slate-50/60'}>
                <td className="px-4 py-4 whitespace-nowrap text-sm">
                  {!selectable ? (
                    <span className="text-xs text-gray-400">—</span>
                  ) : (
                    canSelect && <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => {
                        const idsToToggle = selected
                          ? ids.filter((id) => selectedAttendanceIds.includes(id))
                          : ids.filter((id) => !selectedAttendanceIds.includes(id))
                        idsToToggle.forEach(onToggleSelect)
                      }}
                      aria-label={`Seleccionar asistencia de ${row.user.name}`}
                    />
                  )}
                </td>
                <td className="px-4 py-4 text-sm">{renderUserCell(row.user, onUserClick)}</td>
                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                  {formatDateInUruguay(primaryAttendance.time)}
                </td>
                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                  {row.incident ? (
                    <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${getAdminAttendanceTypeStyle('INCIDENT')}`}>
                      {getAdminAttendanceTypeLabel('INCIDENT')}
                    </span>
                  ) : renderAttendanceMark(row.checkIn, 'Sin entrada', onEdit)}
                </td>
                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                  {row.incident ? (
                    <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${getAdminAttendanceStatusStyle(row.incident.status)}`}>
                      {getAttendanceRowStatusLabel(row.incident)}
                    </span>
                  ) : renderAttendanceMark(row.checkOut, 'Sin salida', onEdit)}
                </td>
                <td className="px-4 py-4 text-sm text-gray-900">
                  {renderEventSummary(row, expandedRowKeys.includes(row.key), () => onToggleExpandedRow(row.key))}
                  {renderRowNotes(row)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </ScrollRegion>
  )
}

function renderAttendanceCards(
  attendances: AttendanceRecord[],
  onEdit: ((attendance: AttendanceRecord) => void) | undefined,
  onUserClick: (user: AttendanceRecord['user']) => void,
  selection?: { ids: string[]; onToggle: (id: string) => void },
) {
  if (attendances.length === 0) {
    return <div className="p-4 text-center text-gray-500 sm:hidden">No hay registros de asistencia</div>
  }

  const rows = buildAttendancePairRows(attendances)

  return (
    <div className="space-y-3 p-3 sm:hidden">
      {rows.map((row) => {
        const primaryAttendance = row.incident ?? row.checkIn ?? row.checkOut
        if (!primaryAttendance) return null
        const ids = getSelectableIdsForRows([row])
        const selected = ids.length > 0 && ids.every(id => selection?.ids.includes(id))
        return (
          <div key={row.key} className={`rounded-xl border p-4 ${selected ? 'border-emerald-200 bg-emerald-50/40' : row.incident ? 'border-red-200 bg-red-50/40' : 'border-slate-200'}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-start gap-3">
                {selection && ids.length > 0 && <input type="checkbox" checked={selected}
                  aria-label={`Seleccionar registro de ${row.user.name}`}
                  className="mt-1 h-4 w-4 shrink-0 accent-emerald-600"
                  onChange={() => ids.filter(id => selected ? selection.ids.includes(id) : !selection.ids.includes(id)).forEach(selection.onToggle)} />}
                {renderUserCell(row.user, onUserClick)}
              </div>
              <span className="shrink-0 text-xs text-gray-500">{formatDateInUruguay(primaryAttendance.time)}</span>
            </div>
            <div className="mt-2 text-sm text-gray-700">
              <span className="font-medium">{row.eventSummary?.title ?? 'Sin evento'}</span>
              {row.eventSummary?.type ? <span className="ml-1 text-xs text-gray-500">({getEventTypeLabel(row.eventSummary.type)})</span> : null}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3">
              <div>
                <div className="text-[11px] uppercase text-gray-400">Entrada</div>
                {row.incident ? (
                  <span className={`mt-1 inline-flex rounded-full px-2 py-1 text-xs font-medium ${getAdminAttendanceTypeStyle('INCIDENT')}`}>
                    {getAdminAttendanceTypeLabel('INCIDENT')}
                  </span>
                ) : (
                  renderAttendanceMark(row.checkIn, 'Sin entrada', onEdit)
                )}
              </div>
              <div>
                <div className="text-[11px] uppercase text-gray-400">Salida</div>
                {row.incident ? (
                  <span className={`mt-1 inline-flex rounded-full px-2 py-1 text-xs font-medium ${getAdminAttendanceStatusStyle(row.incident.status)}`}>
                    {getAttendanceRowStatusLabel(row.incident)}
                  </span>
                ) : (
                  renderAttendanceMark(row.checkOut, 'Sin salida', onEdit)
                )}
              </div>
            </div>
            {renderRowNotes(row)}
          </div>
        )
      })}
    </div>
  )
}

export default function AdminAttendance() {
  return <RoleGuard permission="attendance.read" permissionScope="all"><AdminAttendanceContent /></RoleGuard>
}

function AdminAttendanceContent() {
  const me = useOptionalAuth()?.me
  const canUpdate = hasPermission(me, 'attendance.update', 'all')
  const canDelete = hasPermission(me, 'attendance.delete', 'all')
  const canExport = hasPermission(me, 'exports.create', 'all')

  const [attendances, setAttendances] = useState<AttendanceRecord[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [editing, setEditing] = useState<AttendanceRecord | null>(null)
  const [filters, setFilters] = useState<AdminAttendanceListFilters>({
    startDate: '',
    endDate: '',
    userId: '',
    eventId: '',
    eventType: '',
    type: '',
    status: '',
    role: ''
  })
  const [userEvents, setUserEvents] = useState<NonNullable<AttendanceRecord['event']>[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [message, setMessage] = useState('')
  const [selectedAttendanceIds, setSelectedAttendanceIds] = useState<string[]>([])
  const [expandedAttendanceRows, setExpandedAttendanceRows] = useState<string[]>([])
  const [deletingSelected, setDeletingSelected] = useState(false)
  const [activeTab, setActiveTab] = useState<'attendance' | 'incidents'>('attendance')
  const [justifyTarget, setJustifyTarget] = useState<AttendanceRecord | null>(null)
  const [personDrawer, setPersonDrawer] = useState<{ userId: string; name: string } | null>(null)
  const [showLegend, setShowLegend] = useState(false)

  const [stats, setStats] = useState<AttendanceStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [novedadesExporting, setNovedadesExporting] = useState<'' | NovedadesFormat>('')
  const [reportExporting, setReportExporting] = useState<'' | 'excel' | 'pdf'>('')
  const attendanceRequest = useRef(0)
  const statsRequest = useRef(0)
  const eventsRequest = useRef(0)

  const syCtx = useOptionalAdminSchoolYear()
  const schoolYearQuery = syCtx?.schoolYearQuery ?? ''
  // Hasta que llega el ciclo no se pide nada: antes se pedía todo sin ciclo y otra vez al llegar.
  const schoolYearsLoading = syCtx?.loading ?? false
  const showingExitStats = filters.type === 'CHECK_OUT'
  const selectedUserName = users.find(user => user.id === filters.userId)?.name ?? ''

  function changeFilters(next: AdminAttendanceListFilters) {
    setPage(1)
    setSelectedAttendanceIds([])
    setFilters(next)
  }

  const loadAttendances = useCallback(async () => {
    const request = ++attendanceRequest.current
    if (schoolYearsLoading) return
    setLoading(true)
    setLoadError(false)
    try {
      const qs = buildAdminAttendanceAllQueryString(page, filters)
      const qsWithIncidents = qs ? `${qs}&includeIncidents=true` : 'includeIncidents=true'
      const url = withSchoolYear(`/attendance/all?${qsWithIncidents}`, schoolYearQuery)
      const data = await api<{
        total: number
        page: number
        pageSize: number
        data: AttendanceRecord[]
      }>(url)
      
      if (request !== attendanceRequest.current) return
      setAttendances(data.data)
      setTotal(data.total)
    } catch (error) {
      if (request !== attendanceRequest.current) return
      console.error('Error cargando asistencias:', error)
      setLoadError(true)
    } finally {
      if (request === attendanceRequest.current) setLoading(false)
    }
  }, [page, filters, schoolYearQuery, schoolYearsLoading])

  const loadStats = useCallback(async () => {
    const request = ++statsRequest.current
    if (schoolYearsLoading) return
    setStatsLoading(true)
    try {
      const params = new URLSearchParams()
      if (filters.startDate) params.set('startDate', filters.startDate)
      if (filters.endDate) params.set('endDate', filters.endDate)
      if (filters.userId) params.set('userId', filters.userId)
      if (filters.eventType) params.set('eventType', filters.eventType)
      if (filters.eventId) params.set('eventId', filters.eventId)
      if (filters.type) params.set('type', filters.type)
      if (filters.status) params.set('status', filters.status)
      if (filters.role) params.set('role', filters.role)
      params.set('includeIncidents', 'true')

      const qs = params.toString()
      const base = qs ? `/attendance/stats?${qs}` : '/attendance/stats'
      const url = withSchoolYear(base, schoolYearQuery)
      const data = await api<AttendanceStats>(url)
      if (request === statsRequest.current) setStats(data)
    } catch (error) {
      if (request !== statsRequest.current) return
      console.error('Error cargando métricas:', error)
      setStats(null)
    } finally {
      if (request === statsRequest.current) setStatsLoading(false)
    }
  }, [filters, schoolYearQuery, schoolYearsLoading])

  async function loadUsers() {
    try {
      const data = await api<{
        data: User[]
      }>('/admin/users?pageSize=100')
      setUsers(data.data)
    } catch (error) {
      console.error('Error cargando usuarios:', error)
    }
  }

  const loadUserEvents = useCallback(async (userId: string) => {
    const request = ++eventsRequest.current
    if (!userId) {
      setUserEvents([])
      return
    }
    
    try {
      const params = new URLSearchParams()
      if (filters.startDate) params.set('startDate', filters.startDate)
      if (filters.endDate) params.set('endDate', filters.endDate)
      
      const q = params.toString()
      const base = q ? `/reports/user-events/${userId}?${q}` : `/reports/user-events/${userId}`
      const url = withSchoolYear(base, schoolYearQuery)
      const data = await api<NonNullable<AttendanceRecord['event']>[]>(url)
      if (request === eventsRequest.current) setUserEvents(data)
    } catch (error) {
      if (request !== eventsRequest.current) return
      console.error('Error cargando eventos del usuario:', error)
      setUserEvents([])
    }
  }, [filters.startDate, filters.endDate, schoolYearQuery])

  useEffect(() => {
    void loadAttendances()
  }, [loadAttendances])

  useEffect(() => {
    void loadUsers()
  }, [])

  useEffect(() => {
    if (filters.userId) {
      setUserEvents([])
      loadUserEvents(filters.userId)
    } else {
      eventsRequest.current += 1
      setUserEvents([])
    }
  }, [filters.userId, loadUserEvents])

  useEffect(() => {
    void loadStats()
  }, [loadStats])

  useEffect(() => {
    setSelectedAttendanceIds([])
    setExpandedAttendanceRows([])
  }, [attendances])

  async function updateAttendance(id: string, status: string, notes?: string) {
    try {
      await api(`/attendance/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ status, notes })
      })
      
      setMessage('✅ Asistencia actualizada correctamente')
      await Promise.all([loadAttendances(), loadStats()])
      setEditing(null)
    } catch (error: any) {
      setMessage(`❌ Error: ${error.message || 'Error al actualizar asistencia'}`)
    }
  }

  async function openAttendanceEditor(attendance: AttendanceRecord) {
    if (!isVirtualAbsenceRow(attendance)) {
      setEditing(attendance)
      return
    }

    if (!attendance.event?.id) {
      setMessage('❌ Error: la ausencia no tiene evento asociado para editarla')
      return
    }

    try {
      const materialized = await api<AttendanceRecord>('/attendance/materialize-absence', {
        method: 'POST',
        body: JSON.stringify({
          userId: attendance.user.id,
          eventId: attendance.event.id,
          date: attendance.date.slice(0, 10),
          status: attendance.status,
          notes: attendance.notes,
        }),
      })
      setEditing(materialized)
      await loadAttendances()
      await loadStats()
    } catch (error: any) {
      setMessage(`❌ Error: ${error.message || 'Error al preparar la ausencia para edición'}`)
    }
  }

  async function deleteSelectedAttendances() {
    if (selectedAttendanceIds.length === 0) return
    const realAttendanceIds = selectedAttendanceIds.filter((id) =>
      !id.startsWith('absence:') && !id.startsWith('incident:') && !id.startsWith('derived-checkout:'),
    )
    const virtualAbsenceCount = selectedAttendanceIds.length - realAttendanceIds.length

    if (realAttendanceIds.length === 0) {
      setMessage('ℹ️ Las ausencias calculadas se pueden seleccionar, pero no eliminar hasta registrarlas como asistencia real.')
      return
    }

    const detail =
      virtualAbsenceCount > 0
        ? ` Se omitirán ${virtualAbsenceCount} ausencias calculadas sin registro real.`
        : ''
    if (!confirm(`¿Estás seguro de eliminar ${realAttendanceIds.length} asistencias seleccionadas?${detail}`)) return

    setDeletingSelected(true)
    setMessage('')
    try {
      await Promise.all(realAttendanceIds.map((id) => api(`/attendance/${id}`, { method: 'DELETE' })))
      const suffix =
        virtualAbsenceCount > 0 ? ` (${virtualAbsenceCount} ausencias calculadas omitidas)` : ''
      setMessage(`✅ Se eliminaron ${realAttendanceIds.length} asistencias seleccionadas${suffix}`)
      setSelectedAttendanceIds([])
      await loadAttendances()
    } catch (error: any) {
      setMessage(`❌ Error: ${error.message || 'Error al eliminar asistencias seleccionadas'}`)
    } finally {
      setDeletingSelected(false)
    }
  }

  function toggleAttendanceSelection(id: string) {
    if (id.startsWith('incident:')) return
    setSelectedAttendanceIds((prev) =>
      prev.includes(id) ? prev.filter((currentId) => currentId !== id) : [...prev, id],
    )
  }

  function toggleAllAttendancesSelection() {
    const selectableIds = getSelectableIdsForRows(buildAttendancePairRows(attendances))
    setSelectedAttendanceIds((prev) =>
      selectableIds.every((id) => prev.includes(id)) ? [] : selectableIds,
    )
  }

  function toggleExpandedAttendanceRow(key: string) {
    setExpandedAttendanceRows((prev) =>
      prev.includes(key) ? prev.filter((currentKey) => currentKey !== key) : [...prev, key],
    )
  }

  function openPersonDrawer(user: AttendanceRecord['user']) {
    setPersonDrawer({ userId: user.id, name: user.name })
  }

  async function exportReport(format: 'excel' | 'pdf') {
    if (reportExporting || novedadesExporting) return
    setReportExporting(format)
    try {
      const apiUrl = apiBaseUrl()
      const to = filters.endDate || getTodayYmdInUruguay()
      // Si no se eligió fecha de inicio, tomamos el 1 de enero del año de `to`
      // para cubrir el ciclo completo y que el reporte no quede vacío ni falle la validación.
      const from = filters.startDate || `${to.slice(0, 4)}-01-01`

      const sanitizePart = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_')
      const shortUuid = (id: string) => (id && id.length > 10 ? id.slice(-8) : id)
      const shortText = (s: string) => (s && s.length > 18 ? s.slice(0, 18) : s)

      const userNameForFilename = (() => {
        const raw = selectedUserName
        if (raw) return raw.startsWith('@') ? raw.slice(1) : raw
        if (!filters.userId) return null
        const u = users.find((x) => x.id === filters.userId)
        if (!u) return null
        return u.name || u.username || u.email || null
      })()

      const suffixParts: string[] = []
      if (filters.role) suffixParts.push(`role-${sanitizePart(filters.role)}`)
      if (filters.userId) {
        const part = userNameForFilename ? shortText(sanitizePart(userNameForFilename)) : shortUuid(filters.userId)
        suffixParts.push(`user-${part}`)
      }
      if (filters.eventType) suffixParts.push(`eventType-${sanitizePart(filters.eventType)}`)
      if (filters.eventId) suffixParts.push(`event-${shortUuid(filters.eventId)}`)
      if (filters.type) suffixParts.push(`type-${sanitizePart(filters.type)}`)
      if (filters.status) suffixParts.push(`status-${sanitizePart(filters.status)}`)
      const filterSuffix = suffixParts.length ? `__${suffixParts.join('__')}` : ''

      const payload = {
        reportKey: 'attendance_detail',
        format: format === 'excel' ? 'XLSX' : 'PDF',
        from,
        to,
        filters: {
          role: filters.role || undefined,
          userId: filters.userId || undefined,
          eventId: filters.eventId || undefined,
          eventType: filters.eventType || undefined,
          type: filters.type || undefined,
          status: filters.status || undefined,
          ...(syCtx?.allYears ? { allYears: true } : {}),
          ...(!syCtx?.allYears && (syCtx?.selectedId ?? syCtx?.activeId)
            ? { schoolYearId: syCtx.selectedId ?? syCtx.activeId }
            : {}),
        },
      }

      const res = await api<{ exportId: string }>(`/exports`, { method: 'POST', body: JSON.stringify(payload) })
      const exportId = res.exportId

      let exportDone = false
      for (let i = 0; i < 40; i++) {
        const st = await api<{ status: string; downloadUrl: string | null; errorMessage?: string }>(`/exports/${exportId}`)
        if (st.status === 'DONE') {
          exportDone = true
          break
        }
        if (st.status === 'FAILED') throw new Error(st.errorMessage || 'Error generando exportación')
        await new Promise((r) => setTimeout(r, 250))
      }
      if (!exportDone) throw new Error('La exportación tardó demasiado en generarse')

      const dl = await fetch(`${apiUrl}/exports/${exportId}/download`, { credentials: 'include' })
      if (!dl.ok) throw new Error(`Error descargando exportación: ${dl.status}`)

      const blob = await dl.blob()
      const url = globalThis.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download =
        format === 'excel'
          ? `EduTrack_Asistencia_Detallada_${from}_${to}${filterSuffix}.xlsx`
          : `EduTrack_Asistencia_Detallada_${from}_${to}${filterSuffix}.pdf`
      document.body.appendChild(a)
      a.click()
      globalThis.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      setMessage(`✅ Exportación ${format.toUpperCase()} generada correctamente`)
    } catch (error: any) {
      console.error('Error completo:', error)
      setMessage(`❌ Error: ${error.message || 'Error al exportar el reporte'}`)
    } finally {
      setReportExporting('')
    }
  }

  // El export de novedades sólo acepta estados del enum de la asistencia conciliada; el valor
  // especial "ABSENCES" (usado en pantalla para agrupar ausencias) no aplica al backend de exports.
  function toExportStatus(status: string): string | undefined {
    const allowed = [
      'PRESENT',
      'LATE',
      'ABSENT_NOT_JUSTIFIED',
      'ABSENT_JUSTIFIED',
      'EXIT',
      'EARLY_EXIT',
      'JUSTIFIED',
      'SUBSTITUTED',
    ]
    return allowed.includes(status) ? status : undefined
  }

  // Novedades de liquidación de sueldos: una fila por docente y concepto (CI, horas dictadas,
  // suplencias, faltas, licencias). Respeta exactamente los mismos filtros que la tabla en pantalla.
  async function exportNovedades(format: NovedadesFormat) {
    if (reportExporting || novedadesExporting) return
    setNovedadesExporting(format)
    try {
      const apiUrl = apiBaseUrl()
      const to = filters.endDate || getTodayYmdInUruguay()
      const from = filters.startDate || `${to.slice(0, 4)}-01-01`

      const payload = {
        reportKey: 'payroll_novedades',
        format,
        from,
        to,
        filters: {
          role: filters.role || undefined,
          userId: filters.userId || undefined,
          eventId: filters.eventId || undefined,
          eventType: filters.eventType || undefined,
          status: toExportStatus(filters.status),
          ...(syCtx?.allYears ? { allYears: true } : {}),
          ...(!syCtx?.allYears && (syCtx?.selectedId ?? syCtx?.activeId)
            ? { schoolYearId: syCtx.selectedId ?? syCtx.activeId }
            : {}),
        },
      }

      const res = await api<{ exportId: string }>(`/exports`, { method: 'POST', body: JSON.stringify(payload) })
      const exportId = res.exportId

      let exportDone = false
      for (let i = 0; i < 40; i++) {
        const st = await api<{ status: string; downloadUrl: string | null; errorMessage?: string }>(`/exports/${exportId}`)
        if (st.status === 'DONE') {
          exportDone = true
          break
        }
        if (st.status === 'FAILED') throw new Error(st.errorMessage || 'Error generando novedades')
        await new Promise((r) => setTimeout(r, 250))
      }
      if (!exportDone) throw new Error('La exportación tardó demasiado en generarse')

      const dl = await fetch(`${apiUrl}/exports/${exportId}/download`, { credentials: 'include' })
      if (!dl.ok) throw new Error(`Error descargando novedades: ${dl.status}`)

      const blob = await dl.blob()
      const url = globalThis.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `EduTrack_Novedades_Liquidacion_${from.slice(0, 7)}_${to.slice(0, 7)}.${format === 'XLSX' ? 'xlsx' : 'csv'}`
      document.body.appendChild(a)
      a.click()
      globalThis.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      setMessage(`✅ Novedades de liquidación (${format}) generadas correctamente`)
    } catch (error: any) {
      console.error('Error novedades:', error)
      setMessage(`❌ Error: ${error.message || 'Error al exportar novedades'}`)
    } finally {
      setNovedadesExporting('')
    }
  }

  return (
    <>
      <main className="responsive-page max-w-7xl space-y-5">
        <ModuleHeader
          id="staff-attendance"
          actions={
            <>
              {canExport && activeTab === 'attendance' && <AttendanceExportMenu pending={!!(reportExporting || novedadesExporting)} onAttendance={exportReport} onPayroll={exportNovedades} />}
            </>
          }
        />

        <div role="group" aria-label="Vistas de asistencia" className="grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-white p-1 sm:max-w-lg">
          {[
            { id: 'attendance' as const, label: 'Registros', description: 'Entradas, salidas y faltas', icon: ClipboardList },
            { id: 'incidents' as const, label: 'Incidencias', description: 'Ausencias por revisar', icon: AlertTriangle },
          ].map(({ id, label, description, icon: Icon }) => (
            <button key={id} type="button" aria-pressed={activeTab === id} aria-controls={`attendance-view-${id}`}
              onClick={() => setActiveTab(id)}
              className={`flex min-h-12 items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors ${activeTab === id ? 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-100' : 'text-slate-500 hover:bg-slate-50'}`}>
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span><span className="block text-sm font-semibold">{label}</span><span className="hidden text-xs sm:block">{description}</span></span>
            </button>
          ))}
        </div>

        {message && <div role="status" className={`flex items-start justify-between gap-3 rounded-xl p-3 text-sm ${getAdminFlashMessageClass(message)}`}>
          <span>{message}</span>
          <button type="button" onClick={() => setMessage('')} aria-label="Cerrar aviso" className="rounded p-1"><X className="h-4 w-4" aria-hidden /></button>
        </div>}

        <div id="attendance-view-attendance" hidden={activeTab !== 'attendance'} className="space-y-4">
          <AttendanceFilters filters={filters} users={users} events={userEvents} onChange={changeFilters} />

          <section aria-label="Resumen de asistencia" className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
              <h2 className="text-sm font-semibold text-slate-800">Resumen del período</h2>
              <p className="text-xs text-slate-500">Según los filtros seleccionados · incluye todas las páginas</p>
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-sm text-gray-500">{showingExitStats ? 'Tasa de salida' : 'Tasa de presencia'}</div>
                <div className="my-1 text-2xl font-semibold tabular-nums text-emerald-700">
                  {statsLoading || !stats ? '—' : formatRate(showingExitStats ? stats.exitRate : stats.attendanceRate)}
                </div>
                <div className="text-xs text-gray-500">
                  {showingExitStats
                    ? 'Salidas en el período elegido'
                    : 'Entradas registradas sobre el filtro completo'}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-sm text-gray-500">{showingExitStats ? 'Salidas' : 'Presentes'}</div>
                <div className="my-1 text-2xl font-semibold tabular-nums text-emerald-700">
                  {statsLoading || !stats ? '—' : showingExitStats ? stats.exitCount : stats.presentCount}
                </div>
                <div className="text-xs text-gray-500">{showingExitStats ? 'Salidas normales' : 'Entradas presentes'}</div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-sm text-gray-500">{showingExitStats ? 'Anticipadas' : 'Tarde'}</div>
                <div className="my-1 text-2xl font-semibold tabular-nums text-amber-700">
                  {statsLoading || !stats ? '—' : showingExitStats ? stats.earlyExitCount : stats.lateCount}
                </div>
                <div className="text-xs text-gray-500">
                  {statsLoading || !stats ? '' : `${formatRate(showingExitStats ? stats.earlyExitRate : stats.lateRate)} tasa`}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-sm text-gray-500">{showingExitStats ? 'Total salidas' : 'Ausentes'}</div>
                <div className="my-1 text-2xl font-semibold tabular-nums text-red-700">
                  {statsLoading || !stats ? '—' : showingExitStats ? stats.totalAttendances : stats.absentCount}
                </div>
                <div className="text-xs text-gray-500">
                  {statsLoading || !stats || showingExitStats
                    ? ''
                    : `Justificadas: ${stats.medicalLeaveCount} · Previstas: ${stats.expectedAbsenceCount ?? 0}`}
                </div>
              </div>
            </div>

            {/* Gráfico (simple) de distribución de estados */}
            <details className="rounded-xl border border-slate-200 bg-white">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline-emerald-600">Ver distribución de estados</summary>
              <div className="border-t border-slate-100 p-4 sm:p-6">
                <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="text-base font-semibold text-slate-900">Distribución de estados</h3>
                  <div className="text-sm text-gray-500">
                    {statsLoading
                      ? 'Cargando…'
                      : stats
                        ? `${showingExitStats ? 'Salidas' : 'Entradas'}: ${stats.totalAttendances}`
                        : ''}
                  </div>
                </div>
                {statsLoading || !stats ? (
                  <div className="text-sm text-gray-500">—</div>
                ) : (
                  (() => {
                    // Un contador ausente en la respuesta dibujaba las barras con NaN (y sin barra).
                    const items: DistributionItem[] = showingExitStats
                      ? [
                          { key: 'exit', label: 'Salida', count: stats.exitCount ?? 0, colorClass: 'bg-emerald-600' },
                          { key: 'early', label: 'Anticipada', count: stats.earlyExitCount ?? 0, colorClass: 'bg-amber-500' },
                        ]
                      : [
                          { key: 'present', label: 'Presente', count: stats.presentCount ?? 0, colorClass: 'bg-emerald-600' },
                          { key: 'late', label: 'Tarde', count: stats.lateCount ?? 0, colorClass: 'bg-amber-500' },
                          { key: 'absent', label: 'Ausente', count: stats.absentCount ?? 0, colorClass: 'bg-red-600' },
                        ]
                    return <StatusDistribution items={items} label="Distribución de estados" />
                  })()
                )}
              </div>
            </details>

          </section>

          {/* Tabla de asistencias */}
          <section aria-labelledby="attendance-records-title" className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex flex-col gap-3 border-b p-4 md:flex-row md:items-center md:justify-between sm:p-6">
              <div className="min-w-0">
                <h2 id="attendance-records-title" className="text-base font-semibold text-slate-900">Registros de asistencia</h2>
                <p className="mt-1 text-xs text-slate-500">Entrada y salida juntas por persona y actividad. Tocá un nombre para ver su detalle.</p>
              </div>
              <div className="flex shrink-0 items-center gap-4">
                <span aria-live="polite" className="text-xs tabular-nums text-slate-500">{loading ? 'Cargando…' : `${total} registros totales`}</span>
                <button type="button" disabled={loading} onClick={() => { void loadAttendances(); void loadStats() }} aria-label="Actualizar asistencias" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden /></button>
                <button
                  type="button"
                  onClick={() => setShowLegend((v) => !v)}
                  className="text-xs font-medium text-emerald-700 hover:underline"
                  aria-expanded={showLegend}
                >
                  {showLegend ? 'Ocultar leyenda' : 'Ver leyenda'}
                </button>
              </div>
            </div>
            {canDelete && selectedAttendanceIds.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-100 bg-emerald-50/60 px-4 py-3 sm:px-6">
              <span className="text-sm text-gray-500">
                {`${selectedAttendanceIds.length} seleccionadas`}
              </span>
              <button
                type="button"
                onClick={deleteSelectedAttendances}
                disabled={deletingSelected}
                className="inline-flex items-center gap-2 rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                {deletingSelected ? 'Eliminando...' : 'Eliminar seleccionadas'}
              </button>
              <button type="button" onClick={() => setSelectedAttendanceIds([])} className="text-xs font-medium text-slate-600 hover:underline">Cancelar selección</button>
            </div>}

            {showLegend ? (
              <div className="flex flex-wrap gap-x-4 gap-y-2 border-b bg-slate-50/60 px-4 py-3 sm:px-6">
                {ADMIN_ATTENDANCE_LEGEND.map((item) => (
                  <div key={item.label ?? item.status} className="flex items-center gap-1.5 text-xs text-gray-600">
                    <span className={`inline-flex rounded-full px-2 py-0.5 font-medium ${getAdminAttendanceStatusStyle(item.status)}`}>
                      {getAdminAttendanceLegendLabel(item)}
                    </span>
                    <span>{item.description}</span>
                  </div>
                ))}
              </div>
            ) : null}

            {loading ? (
              <div className="p-4 text-center text-gray-500 sm:p-6">Cargando...</div>
            ) : loadError ? (
              <div role="alert" className="space-y-3 p-8 text-center">
                <p className="text-sm text-red-700">No se pudieron cargar las asistencias.</p>
                <button type="button" onClick={() => void loadAttendances()} className="btn-secondary text-sm">Reintentar</button>
              </div>
            ) : attendances.length === 0 ? (
              <div className="flex flex-col items-center px-4 py-12 text-center">
                <ClipboardList className="mb-3 h-8 w-8 text-slate-300" aria-hidden />
                <p className="text-sm font-medium text-slate-800">No hay registros de asistencia</p>
                <p className="mt-1 max-w-sm text-sm text-slate-500">Probá con otro período o quitá filtros para ampliar la búsqueda.</p>
              </div>
            ) : (
              <>
                {renderAttendancesTable(
                  attendances,
                  selectedAttendanceIds,
                  toggleAllAttendancesSelection,
                  toggleAttendanceSelection,
                  expandedAttendanceRows,
                  toggleExpandedAttendanceRow,
                  canUpdate ? openAttendanceEditor : undefined,
                  (() => {
                    const selectableIds = getSelectableIdsForRows(buildAttendancePairRows(attendances))
                    return selectableIds.length > 0 && selectableIds.every((id) => selectedAttendanceIds.includes(id))
                  })(),
                  openPersonDrawer,
                  canDelete,
                )}
                {renderAttendanceCards(attendances, canUpdate ? openAttendanceEditor : undefined, openPersonDrawer, canDelete ? { ids: selectedAttendanceIds, onToggle: toggleAttendanceSelection } : undefined)}
              </>
            )}

            {!loadError && <PaginationControls page={page} total={total} onPageChange={setPage} />}
          </section>
        </div>

        <section id="attendance-view-incidents" hidden={activeTab !== 'incidents'} aria-labelledby="attendance-incidents-title" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
          <div>
            <h2 id="attendance-incidents-title" className="text-base font-semibold text-slate-900">Incidencias de asistencia</h2>
            <p className="mt-1 text-sm text-slate-500">Revisá las ausencias pendientes de justificación y resolvé cada caso.</p>
          </div>
          {activeTab === 'incidents' && <AdminIncidentsPanel onMessage={setMessage} />}
        </section>

        {canUpdate && justifyTarget ? (
          <AttendanceJustifyModal
            attendanceId={justifyTarget.id}
            teacherLabel={justifyTarget.user.name}
            onClose={() => setJustifyTarget(null)}
            onSaved={() => {
              setMessage('✅ Justificación registrada')
              void loadAttendances()
              void loadStats()
            }}
          />
        ) : null}

        {personDrawer ? (
          <PersonAttendanceDrawer
            userId={personDrawer.userId}
            userName={personDrawer.name}
            from={filters.startDate || getAdminAttendanceDefaultStartDate()}
            to={filters.endDate || getTodayYmdInUruguay()}
            schoolYearQuery={schoolYearQuery}
            onClose={() => setPersonDrawer(null)}
            onJustified={() => {
              void loadAttendances()
              void loadStats()
            }}
          />
        ) : null}

        {/* Modal de edición */}
        {canUpdate && editing && (
          <div className="responsive-modal">
            <div className="responsive-modal-panel max-w-md">
              <h3 className="text-lg font-semibold mb-4">Editar Asistencia</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
                  <select
                    value={editing.status}
                    onChange={(e) => setEditing({ ...editing, status: e.target.value as AttendanceStatusOption })}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    {editing.type === 'CHECK_IN' ? (
                      <>
                        <option value="PRESENT">Presente</option>
                        <option value="LATE">Tarde</option>
                        <option value="ABSENT_NOT_JUSTIFIED">Ausente (No Justificada)</option>
                        <option value="ABSENT_JUSTIFIED">Ausente (Justificada)</option>
                            <option value="SUBSTITUTED">Suplida (ausencia cubierta)</option>
                        <option value="JUSTIFIED">Justificado</option>
                      </>
                    ) : (
                      <>
                        <option value="EXIT">Salida</option>
                        <option value="EARLY_EXIT">Salida Anticipada</option>
                      </>
                    )}
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notas</label>
                  <textarea
                    value={editing.notes || ''}
                    onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    rows={3}
                  />
                </div>
              </div>
              
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <button
                  onClick={() => updateAttendance(editing.id, editing.status, editing.notes)}
                  className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
                >
                  Guardar
                </button>
                {(editing.status === 'ABSENT_NOT_JUSTIFIED' ||
                  editing.status === 'LATE' ||
                  editing.status === 'EARLY_EXIT') && (
                  <button
                    type="button"
                    onClick={() => {
                      setJustifyTarget(editing)
                      setEditing(null)
                    }}
                    className="px-4 py-2 border border-emerald-300 text-emerald-800 rounded hover:bg-emerald-50"
                  >
                    Justificar con auditoría
                  </button>
                )}
                <button
                  onClick={() => setEditing(null)}
                  className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  )
}
