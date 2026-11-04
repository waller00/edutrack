'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { BookX, CalendarX, Search } from 'lucide-react'
import { filterRisk, parseMotive, riskReasons, type RiskMotive, type RiskResponse, type RiskRow } from '@/lib/admin/student-indicators'
import { formatShare } from '@/lib/format/percent'
import { useIndicatorData } from './indicator-data'
import { EmptyNote, LoadState, Panel, StudentName, Table, type IndicatorContext } from './parts'

const MOTIVES: { id: RiskMotive; label: string }[] = [
  { id: '', label: 'Todos los motivos' },
  { id: 'notas', label: 'Por notas' },
  { id: 'faltas', label: 'Por faltas' },
  { id: 'ambos', label: 'Por notas y faltas' },
]

/** Cada motivo con su icono y su texto: el color nunca es lo único que lo dice (RNF 7.2). */
export function ReasonChips({ row }: Readonly<{ row: RiskRow }>) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {riskReasons(row).map((reason) => {
        const Icon = reason.family === 'NOTAS' ? BookX : CalendarX
        return (
          <li
            key={reason.reason}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${
              reason.family === 'NOTAS' ? 'bg-sky-50 text-sky-900' : 'bg-amber-50 text-amber-900'
            }`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {reason.text}
          </li>
        )
      })}
    </ul>
  )
}

/** Qué boletín se usó para las notas de cada nivel, en una frase. */
function referenceText(risk: RiskResponse): string {
  const names = risk.references.flatMap((ref) => (ref.period ? [ref.period.name] : []))
  if (names.length === 0) return 'Todavía no hay boletines con notas: por ahora sólo cuentan las faltas y las materias de años anteriores.'
  const rule = risk.threshold === null ? 'la regla de asignaturas en alerta está apagada' : `desde ${risk.threshold} materias bajas`
  return `Notas de ${names.join(' y ')} (${rule}), como en la reunión de profesores.`
}

export function RiskTable({ rows, query, limit }: Readonly<{ rows: readonly RiskRow[]; query: string; limit: number }>) {
  return (
    <Table head={['Estudiante', 'Curso', 'Por qué']} minWidth={560}>
      {rows.slice(0, limit).map((row) => (
        <tr key={row.studentId}>
          <td className="px-3 py-3 align-top">
            <StudentName student={row} query={query} />
          </td>
          <td className="px-3 py-3 align-top">{row.courseName}</td>
          <td className="px-3 py-3">
            <ReasonChips row={row} />
          </td>
        </tr>
      ))}
    </Table>
  )
}

/**
 * Quién necesita atención: una sola lista con los motivos de cada estudiante, por notas (materias
 * bajas en el boletín, materias de años anteriores) y por faltas (18 o más, faltas seguidas que
 * siguen). Primero quienes tienen las dos cosas.
 */
export default function RiskSection({ ctx }: Readonly<{ ctx: IndicatorContext }>) {
  const risk = useIndicatorData<RiskResponse>(ctx.paths.risk)
  const params = useSearchParams()
  const router = useRouter()
  const motive = parseMotive(params?.get('motivo'))
  const [filters, setFilters] = useState({ search: '', course: '' })
  const [limit, setLimit] = useState(20)

  if (!risk.data) return <LoadState state={risk} what="quién necesita atención" />
  const data = risk.data
  const courses = [...new Set(data.rows.map((row) => row.courseName))].sort((a, b) => a.localeCompare(b, 'es'))
  const rows = filterRisk(data.rows, { ...filters, motive })
  const update = (next: Partial<typeof filters>) => {
    setFilters({ ...filters, ...next })
    setLimit(20)
  }

  return (
    <Panel
      tour="student-indicators.risk"
      title="Quién necesita atención"
      description={`${referenceText(data)} Faltas: desde las 18 del año, contadas como en el boletín, o 3 o más días seguidos que siguen. Es para saber a quién llamar o citar: no decide promociones ni sanciones.`}
    >
      <p className="text-sm text-slate-700">
        {formatShare(data.counts.students, data.enrolled)} estudiantes del ciclo · {data.counts.grades} por notas · {data.counts.absences} por
        faltas · {data.counts.both} por las dos
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 sm:min-w-48">
          <span className="mb-1.5 block text-xs font-medium text-slate-500">Buscar estudiante o curso</span>
          <span className="relative block">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" aria-hidden />
            <input
              type="search"
              value={filters.search}
              onChange={(e) => update({ search: e.target.value })}
              className="min-h-10 w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm"
              placeholder="Nombre, apellido o curso"
            />
          </span>
        </label>
        <label className="w-full sm:w-48">
          <span className="mb-1.5 block text-xs font-medium text-slate-500">Curso</span>
          <select value={filters.course} onChange={(e) => update({ course: e.target.value })} className="select-field w-full">
            <option value="">Todos los cursos</option>
            {courses.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <label className="w-full sm:w-52">
          <span className="mb-1.5 block text-xs font-medium text-slate-500">Motivo</span>
          <select
            value={motive}
            onChange={(e) => {
              setLimit(20)
              router.replace(ctx.sectionHref({ seccion: 'riesgo', ...(e.target.value ? { motivo: e.target.value } : {}) }), { scroll: false })
            }}
            className="select-field w-full"
          >
            {MOTIVES.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {rows.length === 0 ? (
        <EmptyNote>{data.rows.length === 0 ? 'Nadie necesita atención por ahora.' : 'Nadie con estos filtros.'}</EmptyNote>
      ) : (
        <>
          <p aria-live="polite" className="text-xs text-slate-500">
            Mostrando {Math.min(limit, rows.length)} de {rows.length} estudiantes
          </p>
          <RiskTable rows={rows} query={ctx.query} limit={limit} />
          {limit < rows.length && (
            <button
              type="button"
              onClick={() => setLimit((n) => n + 20)}
              className="min-h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600"
            >
              Mostrar 20 más
            </button>
          )}
        </>
      )}
    </Panel>
  )
}
