'use client'

import { GradeDropsReport, LowGradesReport } from './ReportTabs'
import { ReportCardPeriodSelect, useReportCardPeriods } from './shared'

/**
 * Seguimiento de notas de Rendimiento académico: quiénes están en la banda de alerta y quiénes
 * bajaron respecto del boletín anterior. Las cifras del tablero ("En alerta", "En descenso") dicen
 * cuántos; esto dice quiénes. Un solo boletín para las dos listas.
 */
export default function GradeFollowUp() {
  const { periods, periodId, setPeriodId, error } = useReportCardPeriods()

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <ReportCardPeriodSelect periods={periods} value={periodId} onChange={setPeriodId} />
        <p className="pb-2 text-xs text-gray-500">Se mira la nota de reunión (R) de cada boletín.</p>
      </div>
      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <section aria-labelledby="followup-low" className="space-y-2">
        <h2 id="followup-low" className="text-sm font-semibold text-gray-900">
          Notas bajas por curso y materia
        </h2>
        <LowGradesReport periodId={periodId} />
      </section>

      <section aria-labelledby="followup-drops" className="space-y-2">
        <h2 id="followup-drops" className="text-sm font-semibold text-gray-900">
          Bajaron respecto del boletín anterior
        </h2>
        <GradeDropsReport periodId={periodId} />
      </section>
    </div>
  )
}
