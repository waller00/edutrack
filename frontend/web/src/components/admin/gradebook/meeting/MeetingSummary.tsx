import StatTile from '@/components/common/StatTile'
import { formatCount, formatShare } from '@/lib/format/percent'
import { subjectsText, type JudgementState, type MeetingTally } from '@/lib/gradebook/meeting-board'

function judgementDetail(judgements: JudgementState): string {
  if (!judgements) return 'Cargando los juicios…'
  return judgements.group ? 'El juicio general del grupo está escrito.' : 'Falta el juicio general del grupo.'
}

/**
 * Cómo va la reunión, arriba de la matriz: qué libretas todavía no cerraron (se nombran con su
 * docente, para decirlo en voz alta) y cuánto lleva decidido la reunión. Cada número con su base.
 */
export default function MeetingSummary({
  tally,
  judgements,
  alertSubjectsThreshold,
}: Readonly<{
  tally: MeetingTally
  judgements: JudgementState
  alertSubjectsThreshold: number | null
}>) {
  const allClosed = tally.subjectsClosed === tally.subjects
  const judged = tally.withJudgement != null && tally.withJudgement === tally.students && tally.students > 0
  return (
    <div data-tour="reunion.summary" className="grid gap-3 sm:grid-cols-3">
      <StatTile
        label="Libretas cerradas"
        value={`${formatCount(tally.subjectsClosed)} de ${formatCount(tally.subjects)}`}
        tone={allClosed ? 'good' : 'warning'}
        toneText={allClosed ? 'Todas' : 'Faltan'}
        detail={allClosed ? 'Todas las materias cerraron esta reunión.' : `Sin cerrar: ${subjectsText(tally.openSubjects)}.`}
      />
      <StatTile
        label="Juicios"
        value={tally.withJudgement == null ? '…' : `${formatCount(tally.withJudgement)} de ${formatCount(tally.students)}`}
        tone={judged ? 'good' : 'neutral'}
        toneText="Todos"
        detail={`La reunión decide el juicio de cada alumno, que va a su boletín. ${judgementDetail(judgements)}`}
      />
      <StatTile
        label="En alerta"
        value={formatCount(tally.atRisk)}
        tone={tally.atRisk > 0 ? 'warning' : 'neutral'}
        detail={
          alertSubjectsThreshold == null
            ? 'La regla de alerta está apagada.'
            : `${formatShare(tally.atRisk, tally.students)} con ${alertSubjectsThreshold} o más materias en el tramo de alerta.`
        }
      />
    </div>
  )
}
