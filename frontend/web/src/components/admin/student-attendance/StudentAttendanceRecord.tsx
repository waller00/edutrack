'use client'

import { useState } from 'react'
import { Plus, UserRound } from 'lucide-react'
import { useOptionalAuth } from '@/contexts/AuthContext'
import { hasPermission } from '@/lib/auth/permissions'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { withSchoolYear } from '@/lib/admin/school-year-query'
import { api } from '@/lib/api/client'
import { formatYmdDisplay } from '@/lib/libreta/absence-day'
import { formatValidationErrorFromApi } from '@/lib/api/validation-message'
import { useReport } from '@/components/admin/student-reports/shared'
import ScrollRegion from '@/components/common/ScrollRegion'
import { RangeForm, RangeRow, type RangeStudent, type JustificationRange } from './JustificationRangesPanel'

type Entry = { entryId: string; status: string; ymd: string; subject: string | null; title: string | null; note: string | null }
type Record = {
  student: RangeStudent
  entries: Entry[]
  byDay: boolean
  overall: { absent: number; absentJustified: number; late: number; absenceUnits: number }
}
const STATUS: { [key: string]: { label: string; color: string } } = {
  PRESENT: { label: 'Presente', color: 'bg-emerald-50 text-emerald-800' },
  LATE: { label: 'Llegada tarde', color: 'bg-amber-50 text-amber-900' },
  ABSENT: { label: 'Falta sin justificar', color: 'bg-red-50 text-red-800' },
  ABSENT_JUSTIFIED: { label: 'Falta justificada', color: 'bg-sky-50 text-sky-800' },
}

export default function StudentAttendanceRecord({ studentId, student, initiallyAdding }: { studentId: string; student: RangeStudent | null; initiallyAdding: boolean }) {
  const canJustify = hasPermission(useOptionalAuth()?.me, 'student-attendance.justify', 'all')
  const year = useOptionalAdminSchoolYear()?.schoolYearScopedQuery ?? ''
  const [refresh, setRefresh] = useState(0)
  const [tab, setTab] = useState<'historial' | 'licencias'>('historial')
  const [adding, setAdding] = useState(initiallyAdding)
  const [initialDate, setInitialDate] = useState<string | undefined>()
  const [message, setMessage] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [revoking, setRevoking] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [onlyAbsences, setOnlyAbsences] = useState(false)
  const invalidDates = Boolean(from && to && from > to)
  const query = new URLSearchParams({ refresh: String(refresh) })
  if (from) query.set('from', from)
  if (to) query.set('to', to)
  const { data, loading, error } = useReport<Record>(invalidDates ? null : withSchoolYear(`/admin/student-attendance/students/${encodeURIComponent(studentId)}?${query}`, year))
  const ranges = useReport<{ data: JustificationRange[] }>(canJustify ? withSchoolYear(`/admin/student-attendance/justification-ranges?studentId=${encodeURIComponent(studentId)}&refresh=${refresh}`, year) : null)
  const person = data?.student ?? student
  const entries = (data?.entries ?? []).filter((entry) => !onlyAbsences || entry.status === 'ABSENT' || entry.status === 'ABSENT_JUSTIFIED').slice().reverse()

  async function revoke(id: string) {
    if (revoking) return
    setRevoking(true); setActionError(null)
    try {
      await api(`/admin/student-attendance/justification-ranges/${id}/revoke`, { method: 'POST' })
      setMessage('Licencia o justificativo revocado. Las faltas que ya justificó no cambian.')
      setRefresh((value) => value + 1)
    } catch (err) { setActionError(formatValidationErrorFromApi(err)) }
    finally { setRevoking(false) }
  }

  return (
    <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3"><span className="rounded-xl bg-emerald-50 p-3 text-emerald-700"><UserRound className="h-6 w-6" aria-hidden /></span><div><p className="text-xs font-medium uppercase tracking-wide text-slate-500">Ficha de asistencia</p><h2 className="mt-1 text-xl font-semibold text-slate-900">{person ? `${person.lastName}, ${person.firstName}` : 'Cargando estudiante…'}</h2><p className="mt-1 text-sm text-slate-500">{[student?.courseName, person?.documentId ? `Documento: ${person.documentId}` : null].filter(Boolean).join(' · ')}</p></div></div>
        {canJustify && person && !adding && <button type="button" onClick={() => { setInitialDate(undefined); setAdding(true) }} className="btn-primary inline-flex items-center gap-2 text-sm"><Plus className="h-4 w-4" aria-hidden />Agregar licencia o justificativo</button>}
      </header>
      {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}
      {actionError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{actionError}</p>}
      {adding && canJustify && person && <section aria-label="Agregar licencia o justificativo" className="rounded-xl border border-emerald-200 bg-emerald-50/30 p-4">
        <h3 className="mb-3 font-semibold text-slate-900">Agregar licencia o justificativo para {person.firstName}</h3>
        <RangeForm key={`${studentId}:${initialDate ?? 'new'}`} student={person} initialDate={initialDate} onCancel={() => setAdding(false)} onSaved={(text) => { setMessage(text); setAdding(false); setRefresh((value) => value + 1) }} />
      </section>}
      <div role="tablist" aria-label="Ficha del estudiante" className="flex flex-wrap gap-1 border-b border-slate-200">
        {(['historial', ...(canJustify ? ['licencias'] : [])] as Array<'historial' | 'licencias'>).map((value) => <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`border-b-2 px-3 py-2 text-sm font-medium ${tab === value ? 'border-emerald-600 text-emerald-800' : 'border-transparent text-slate-600'}`}>{value === 'historial' ? 'Historial de asistencia' : 'Licencias y justificativos'}</button>)}
      </div>
      {tab === 'historial' ? <div role="tabpanel" aria-label="Historial de asistencia" className="space-y-4">
        <div className="flex flex-wrap items-end gap-3"><label className="text-sm text-slate-600">Desde<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="input-field mt-1 block text-sm" /></label><label className="text-sm text-slate-600">Hasta<input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="input-field mt-1 block text-sm" /></label><label className="flex items-center gap-2 py-2 text-sm text-slate-600"><input type="checkbox" checked={onlyAbsences} onChange={(event) => setOnlyAbsences(event.target.checked)} />Sólo faltas</label></div>
        {invalidDates && <p role="alert" className="text-sm text-red-700">La fecha desde no puede ser posterior a la hasta.</p>}
        {loading && <p role="status" className="text-sm text-slate-500">Cargando asistencia…</p>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {!loading && !error && data && !invalidDates && <>
          <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">En el período: <strong>{data.overall.absent}</strong> clases con falta sin justificar · <strong>{data.overall.absentJustified}</strong> justificadas · <strong>{data.overall.late}</strong> llegadas tarde{data.byDay && <> · <strong>{data.overall.absenceUnits.toLocaleString('es-UY')}</strong> faltas computadas por día</>}</p>
          {entries.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">{onlyAbsences ? 'No tiene faltas en el período seleccionado.' : 'No hay marcas de asistencia en el período seleccionado.'}</p> : <ScrollRegion label="Historial de asistencia del estudiante" className="overflow-x-auto rounded-lg border border-slate-200"><table className="block w-full text-left text-sm sm:table"><thead className="hidden bg-slate-50 text-xs uppercase text-slate-500 sm:table-header-group"><tr>{['Fecha', 'Clase / asignatura', 'Estado', 'Acción'].map((label) => <th key={label} className="px-3 py-3">{label}</th>)}</tr></thead><tbody className="block divide-y divide-slate-100 sm:table-row-group">{entries.map((entry) => {
            const status = STATUS[entry.status] ?? { label: entry.status, color: 'bg-slate-50 text-slate-600' }
            return <tr key={entry.entryId} className="block py-2 sm:table-row sm:py-0">
              <td className="block whitespace-nowrap px-3 py-1 text-xs font-medium text-slate-500 sm:table-cell sm:py-3 sm:text-sm">{formatYmdDisplay(entry.ymd)}</td>
              <td className="block px-3 py-1 sm:table-cell sm:py-3">{entry.subject || entry.title || 'Clase'}{entry.note && <p className="mt-1 text-xs text-slate-500">{entry.note}</p>}</td>
              <td className="block px-3 py-1 sm:table-cell sm:py-3"><span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${status.color}`}>{status.label}</span></td>
              <td className="block px-3 py-1 sm:table-cell sm:py-3">{entry.status === 'ABSENT' && canJustify && <button type="button" onClick={() => { setInitialDate(entry.ymd); setAdding(true) }} className="py-1 font-medium text-emerald-700 hover:underline" aria-label={`Justificar falta del ${formatYmdDisplay(entry.ymd)}`}>Justificar falta</button>}</td>
            </tr>
          })}</tbody></table></ScrollRegion>}
          <p className="text-xs text-slate-500">Sólo se muestran las clases con lista registrada. Las clases sin lista no generan faltas.</p>
        </>}
      </div> : <div role="tabpanel" aria-label="Licencias y justificativos" className="space-y-3">
        <p className="text-sm text-slate-500">Períodos cargados para este estudiante en el ciclo seleccionado.</p>
        {ranges.loading && <p role="status" className="text-sm text-slate-500">Cargando licencias y justificativos…</p>}
        {ranges.error && <p role="alert" className="text-sm text-red-700">{ranges.error}</p>}
        {!ranges.loading && !ranges.error && (ranges.data?.data.length ? <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200" aria-busy={revoking}>{ranges.data.data.map((range) => <RangeRow key={range.id} range={range} onRevoke={revoking ? undefined : (id) => void revoke(id)} />)}</ul> : <p className="py-6 text-center text-sm text-slate-500">Todavía no tiene licencias ni justificativos cargados.</p>)}
      </div>}
    </section>
  )
}
