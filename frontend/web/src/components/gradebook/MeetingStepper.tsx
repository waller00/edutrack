import { MEETING_STAGES, type MeetingStageId } from '@/lib/gradebook/meeting-stage'

/**
 * Las cuatro etapas de una reunión (Cargar → Cerrar → Revisión → Visada) con la actual marcada, y
 * debajo qué pasa y qué sigue. La misma línea la ven el docente y quien revisa.
 *
 * Cada etapa lleva símbolo y texto además del color: ✓ hecha, ● la actual, ○ pendiente (RNF 7.2).
 */
export default function MeetingStepper({ stage, hint }: { stage: MeetingStageId; hint: string }) {
  const current = MEETING_STAGES.findIndex((entry) => entry.id === stage)
  return (
    <div className="space-y-1.5">
      <ol aria-label="Etapas de la reunión" className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
        {MEETING_STAGES.map((entry, index) => {
          const done = index < current || (index === current && entry.id === 'ENDORSED')
          const isCurrent = index === current
          const symbol = done ? '✓' : isCurrent ? '●' : '○'
          return (
            <li key={entry.id} className="flex items-center gap-1.5" aria-current={isCurrent ? 'step' : undefined}>
              {index > 0 && (
                <span aria-hidden className="text-slate-300">
                  →
                </span>
              )}
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
                  isCurrent
                    ? 'bg-emerald-600 font-semibold text-white'
                    : done
                      ? 'bg-emerald-50 text-emerald-800'
                      : 'bg-slate-100 text-slate-500'
                }`}
              >
                <span aria-hidden>{symbol}</span>
                {entry.label}
                {!isCurrent && <span className="sr-only">{done ? ' (hecha)' : ' (pendiente)'}</span>}
              </span>
            </li>
          )
        })}
      </ol>
      <p className="text-sm text-slate-700">{hint}</p>
    </div>
  )
}
