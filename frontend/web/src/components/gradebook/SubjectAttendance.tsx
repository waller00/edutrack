import { hasRollCalls, markCountParts, type MarkCounts } from '@/lib/gradebook/subject-attendance'

/**
 * Las inasistencias del alumno en la asignatura, en palabras: «2 sin justificar · 1 llegada tarde».
 * Sin listas pasadas no se muestra nada.
 */
function MarkCountsText({ counts }: { counts: MarkCounts }) {
  const parts = markCountParts(counts)
  if (parts.length === 0) return <span>ninguna</span>
  return (
    <>
      {parts.map((part, index) => (
        <span key={part.label}>
          {index > 0 && <span aria-hidden> · </span>}
          <span className="font-semibold tabular-nums text-slate-900">{part.count}</span> {part.label}
        </span>
      ))}
    </>
  )
}

/** El total del año, arriba de la carta. */
export function SubjectAttendanceTotal({ subjectName, counts }: { subjectName: string; counts: MarkCounts | null | undefined }) {
  if (!hasRollCalls(counts)) return null
  return (
    <p className="mt-2 inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">
      <span className="font-semibold text-slate-700">Inasistencias del año en {subjectName}:</span>{' '}
      <span>
        <MarkCountsText counts={counts} />
      </span>
    </p>
  )
}

/** Las del período, al pie de su bloque. */
export function PeriodAttendance({ counts }: { counts: MarkCounts | null | undefined }) {
  if (!hasRollCalls(counts)) return null
  return (
    <p className="border-t border-slate-100 px-2 py-1.5 text-left text-slate-600">
      <span className="font-semibold text-slate-700">Inasistencias:</span> <MarkCountsText counts={counts} />
    </p>
  )
}
