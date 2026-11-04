'use client'

import Link from 'next/link'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { useLibreta } from '@/contexts/LibretaContext'
import { useIndicatorData } from '@/components/common/data-cache'
import StatTile from '@/components/common/StatTile'
import ScrollRegion from '@/components/common/ScrollRegion'
import { PartsList, SegmentedBar } from '@/components/charts/SegmentedBar'
import { gradeText, studentName } from '@/components/admin/student-reports/shared'
import { alertSummary, attendanceTiles, distributionParts, evolutionParts, type GroupIndicators } from '@/lib/gradebook/group-indicators'

const cardHref = (gradeBookId: string, studentId: string) => `/libreta/${gradeBookId}/evaluaciones?alumno=${encodeURIComponent(studentId)}`

function Block({ title, hint, children }: Readonly<{ title: string; hint?: string; children: React.ReactNode }>) {
  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <header>
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {hint && <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-slate-500">{hint}</p>}
      </header>
      {children}
    </section>
  )
}

function Attendance({ gradeBookId, data }: Readonly<{ gradeBookId: string; data: GroupIndicators['attendance'] }>) {
  return (
    <Block
      title="Faltas a tus clases"
      hint="Cada clase de esta materia con la lista pasada cuenta una vez por alumno. No son las faltas oficiales del liceo, que se cuentan por día."
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {attendanceTiles(data).map((tile) => (
          <StatTile key={tile.label} label={tile.label} value={tile.value} detail={tile.detail} />
        ))}
      </div>
      {data.students.length === 0 ? (
        <p className="text-sm text-slate-600">Nadie faltó ni llegó tarde a tus clases.</p>
      ) : (
        <ScrollRegion label="Faltas a tus clases, por alumno" className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {['Alumno', 'Clases', 'Sin justificar', 'Justificadas', 'Tarde'].map((head) => (
                  <th key={head} scope="col" className="px-3 py-2 text-left font-medium">
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.students.map((row) => (
                <tr key={row.studentId}>
                  <th scope="row" className="px-3 py-1.5 text-left font-medium">
                    <Link href={cardHref(gradeBookId, row.studentId)} className="text-emerald-700 hover:underline">
                      {studentName(row)}
                    </Link>
                  </th>
                  <td className="px-3 py-1.5 tabular-nums">{row.classes}</td>
                  <td className="px-3 py-1.5 tabular-nums">{row.absent}</td>
                  <td className="px-3 py-1.5 tabular-nums">{row.justified}</td>
                  <td className="px-3 py-1.5 tabular-nums">{row.late}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}
    </Block>
  )
}

function Grades({ gradeBookId, data }: Readonly<{ gradeBookId: string; data: GroupIndicators['grades'] }>) {
  if (!data.reference) {
    return (
      <Block title="Rendimiento (R) del boletín">
        <p className="text-sm text-slate-600">Todavía no cargaste ninguna R de boletín.</p>
      </Block>
    )
  }
  const parts = distributionParts(data)
  return (
    <Block title={`Rendimiento (R) en ${data.reference.name}`} hint={alertSummary(data) ?? undefined}>
      <SegmentedBar parts={parts} label={`Notas de ${data.reference.name}`} />
      <PartsList parts={parts} unit="notas" />
      {data.students.length > 0 && (
        <ul className="space-y-1 text-sm" aria-label="Con la R en alerta">
          {data.students.map((row) => (
            <li key={row.studentId} className="flex flex-wrap items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-700" aria-hidden />
              <Link href={cardHref(gradeBookId, row.studentId)} className="font-medium text-emerald-700 hover:underline">
                {studentName(row)}
              </Link>
              <span className="tabular-nums text-slate-700">
                {gradeText(row.valueHundredths)}
                {row.levelLabel ? ` · ${row.levelLabel}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Block>
  )
}

function Evolution({ gradeBookId, data }: Readonly<{ gradeBookId: string; data: GroupIndicators['evolution'] }>) {
  if (!data) {
    return (
      <Block title="Cómo cambió respecto del boletín anterior">
        <p className="text-sm text-slate-600">Hace falta la R de dos boletines para comparar.</p>
      </Block>
    )
  }
  const parts = evolutionParts(data)
  return (
    <Block
      title={`De ${data.from.name} a ${data.to.name}`}
      hint={`Los ${data.compared} alumnos con la R de los dos boletines.`}
    >
      <SegmentedBar parts={parts} label={`Cambio de ${data.from.name} a ${data.to.name}`} />
      <PartsList parts={parts} unit="alumnos" />
      {data.students.length > 0 && (
        <ul className="space-y-1 text-sm" aria-label="Bajaron">
          {data.students.map((row) => (
            <li key={row.studentId} className="flex flex-wrap items-center gap-2">
              <Link href={cardHref(gradeBookId, row.studentId)} className="font-medium text-emerald-700 hover:underline">
                {studentName(row)}
              </Link>
              <span className="tabular-nums text-slate-700">
                {gradeText(row.fromHundredths)} → {gradeText(row.toHundredths)} <span className="text-xs text-amber-800">(bajó)</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Block>
  )
}

/**
 * Cómo viene el grupo en esta materia, para su docente. Es sólo de esta libreta: ni notas de otras
 * materias ni los umbrales de 18 y 25 faltas, que son del liceo y los sigue administración.
 */
export default function SeguimientoSection() {
  const { gradeBookId } = useLibreta()
  const indicators = useIndicatorData<GroupIndicators>(`/gradebook/${gradeBookId}/indicators`)
  if (!indicators.data) {
    return indicators.error ? (
      <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
        No se pudo calcular el seguimiento. {indicators.error}{' '}
        <button type="button" onClick={indicators.retry} className="font-semibold underline">
          Reintentar
        </button>
      </p>
    ) : (
      <p role="status" className="flex items-center gap-2 py-6 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Calculando el seguimiento…
      </p>
    )
  }
  const data = indicators.data
  return (
    <div className="space-y-5">
      <Attendance gradeBookId={gradeBookId} data={data.attendance} />
      <div className="grid gap-5 xl:grid-cols-2">
        <Grades gradeBookId={gradeBookId} data={data.grades} />
        <Evolution gradeBookId={gradeBookId} data={data.evolution} />
      </div>
    </div>
  )
}
