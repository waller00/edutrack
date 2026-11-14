'use client'

import { useId, type KeyboardEvent } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { useOptionalAuth } from '@/contexts/AuthContext'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { withSchoolYear } from '@/lib/admin/school-year-query'
import {
  indicatorAccess,
  indicatorPaths,
  indicatorReportPath,
  nextQuery,
  resolveSection,
  visibleSections,
  type IndicatorSection,
  type IndicatorSectionId,
} from '@/lib/admin/student-indicators-sections'
import { STUDENT_INDICATORS_PATH } from '@/lib/admin/legacy-reports'
import { lastClosedMeeting, REPORT_CARD_PERIODS_PATH, type ReportCardPeriod } from '@/lib/gradebook/report-card-periods'
import { todayYmdUruguay } from '@/lib/libreta/absence-day'
import { ReportCardPeriodSelect } from '@/components/admin/student-reports/shared'
import ReportDownloadMenu from '@/components/common/ReportDownloadMenu'
import { IndicatorDataProvider, useIndicatorData, useIndicatorRefresh } from './indicator-data'
import type { IndicatorContext } from './parts'
import SummarySection from './SummarySection'
import PerformanceSection from './PerformanceSection'
import SubjectsSection from './SubjectsSection'
import AttendanceSection from './AttendanceSection'
import TrajectorySection from './TrajectorySection'
import RiskSection from './RiskSection'

const CONTENT: Record<IndicatorSectionId, (props: { ctx: IndicatorContext }) => React.ReactElement> = {
  resumen: SummarySection,
  rendimiento: PerformanceSection,
  materias: SubjectsSection,
  asistencia: AttendanceSection,
  trayectoria: TrajectorySection,
  riesgo: RiskSection,
}

/**
 * Indicadores de estudiantes: notas, asistencia, materias y APE, promoción y egreso, y quién
 * necesita atención, en una sola pantalla. Cada número dice de cuántos sale.
 *
 * La sección, el boletín y las listas viven en la URL (`?seccion=`, `?boletin=`, `?lista=`,
 * `?motivo=`): los avisos abren directo en lo que corresponde. El ciclo es el del selector del menú.
 */
export default function StudentIndicators() {
  return (
    <IndicatorDataProvider>
      <Indicators />
    </IndicatorDataProvider>
  )
}

/** Los boletines del ciclo: el de la URL si es de este ciclo; si no, el último que ya pasó. */
function useReferencePeriod(query: string, yearReady: boolean, requested: string | null) {
  const periods = useIndicatorData<{ data: ReportCardPeriod[] }>(yearReady ? withSchoolYear(REPORT_CARD_PERIODS_PATH, query) : null)
  const list = periods.data?.data ?? []
  const period = list.find((p) => p.id === requested) ?? lastClosedMeeting(list, todayYmdUruguay())
  // Sin boletines (o sin poder leerlos) igual se muestra lo que no depende de ellos.
  return { periods: list, period, ready: Boolean(periods.data) || Boolean(periods.error) }
}

/** El ciclo que se muestra, en palabras: con "Todos los ciclos" en el menú se ve igual uno solo. */
function yearText(schoolYear: ReturnType<typeof useOptionalAdminSchoolYear>): string {
  const id = schoolYear?.selectedId ?? schoolYear?.activeId
  const label = schoolYear?.years.find((year) => year.id === id)?.label ?? 'Ciclo activo'
  return schoolYear?.allYears ? `${label} · los indicadores se ven de un ciclo a la vez` : label
}

function FilterBar({
  section,
  reference,
  yearLabel,
  query,
  periodsReady,
  onPeriod,
}: Readonly<{
  section: IndicatorSection
  reference: ReturnType<typeof useReferencePeriod>
  yearLabel: string
  query: string
  periodsReady: boolean
  onPeriod: (id: string) => void
}>) {
  const { refresh } = useIndicatorRefresh()
  const showPeriod = section.usesReportCard
  return (
    <div data-tour="student-indicators.filters" className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
      {showPeriod && <ReportCardPeriodSelect periods={reference.periods} value={reference.period?.id ?? ''} onChange={onPeriod} />}
      <p className="pb-2 text-xs text-slate-600">
        {yearLabel}
        {showPeriod && reference.period ? ` · notas (R) de ${reference.period.name}` : ''}
      </p>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={refresh}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Actualizar
        </button>
        <ReportDownloadMenu
          tour="student-indicators.report"
          disabled={!periodsReady}
          note="Todas las secciones que ves, con el ciclo y el boletín elegidos."
          pathFor={(format) => indicatorReportPath({ query, period: reference.period }, format)}
          fallbackName={(format) => `Indicadores de estudiantes.${format}`}
        />
      </div>
    </div>
  )
}

function Indicators() {
  const me = useOptionalAuth()?.me ?? null
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname() ?? STUDENT_INDICATORS_PATH
  const schoolYear = useOptionalAdminSchoolYear()
  const access = indicatorAccess(me)
  const sections = visibleSections(access)
  const section = resolveSection(params?.get('seccion'), sections)
  const query = schoolYear?.schoolYearScopedQuery ?? ''
  const yearReady = !schoolYear?.loading
  const reference = useReferencePeriod(query, yearReady, params?.get('boletin') ?? null)

  if (!section) return null

  const current = params?.toString() ?? ''
  const setParams = (changes: Record<string, string | null>) => router.replace(`${pathname}?${nextQuery(current, changes)}`, { scroll: false })
  const periodsReady = yearReady && reference.ready
  const ctx: IndicatorContext = {
    access,
    query,
    period: reference.period,
    periodsReady,
    schoolYearIds: (schoolYear?.years ?? []).map((year) => year.id).join(','),
    paths: indicatorPaths({ query, yearReady, periodsReady, period: reference.period }),
    // Otra sección o lista: las de la sección anterior no siguen.
    sectionHref: (changes) => `${pathname}?${nextQuery(current, { lista: null, motivo: null, ...changes })}`,
  }
  const Content = CONTENT[section.id]

  return (
    <div className="space-y-5">
      <SectionTabs sections={sections} active={section} onChange={(id) => setParams({ seccion: id, lista: null, motivo: null })} />
      <FilterBar
        section={section}
        reference={reference}
        yearLabel={yearText(schoolYear)}
        query={query}
        periodsReady={periodsReady}
        onPeriod={(id) => setParams({ boletin: id })}
      />
      <div role="tabpanel" id="student-indicators-panel" aria-label={section.label}>
        <Content ctx={ctx} />
      </div>
    </div>
  )
}

/** Pestañas con flechas, Inicio y Fin, como pide el patrón de pestañas accesibles. */
function SectionTabs({
  sections,
  active,
  onChange,
}: Readonly<{ sections: readonly IndicatorSection[]; active: IndicatorSection; onChange: (id: IndicatorSectionId) => void }>) {
  const baseId = useId()
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const current = sections.findIndex((s) => s.id === active.id)
    const moves: Record<string, number> = { ArrowRight: current + 1, ArrowLeft: current - 1, Home: 0, End: sections.length - 1 }
    if (!(event.key in moves)) return
    event.preventDefault()
    const next = sections[(moves[event.key] + sections.length) % sections.length]
    onChange(next.id)
    document.getElementById(`${baseId}-${next.id}`)?.focus()
  }
  if (sections.length < 2) return null
  return (
    <div
      role="tablist"
      aria-label="Indicadores de estudiantes"
      data-tour="student-indicators.sections"
      className="flex flex-wrap gap-1 border-b border-slate-200"
    >
      {sections.map((s) => (
        <button
          key={s.id}
          id={`${baseId}-${s.id}`}
          type="button"
          role="tab"
          aria-selected={s.id === active.id}
          aria-controls="student-indicators-panel"
          tabIndex={s.id === active.id ? 0 : -1}
          onClick={() => onChange(s.id)}
          onKeyDown={onKeyDown}
          className={`-mb-px min-h-11 border-b-2 px-3 text-sm font-medium ${
            s.id === active.id ? 'border-emerald-600 text-emerald-800' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  )
}
