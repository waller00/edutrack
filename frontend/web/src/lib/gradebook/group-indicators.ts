import { ORDINAL_COLORS, SERIES_COLORS, type Part } from '@/lib/admin/student-indicators'
import { formatCount, formatRatio } from '@/lib/format/percent'

/**
 * El seguimiento de un grupo en la materia de una libreta (`GET /gradebook/:id/indicators`): sus
 * faltas a las clases del docente, las R en alerta del boletín y quiénes bajaron. Sólo esta libreta:
 * nunca notas de otras materias, ni umbrales de 18 y 25 faltas.
 */

type Student = { studentId: string; lastName: string; firstName: string }

export type GroupIndicators = {
  rosterSize: number
  attendance: {
    classesWithRollCall: number
    marks: number
    absent: number
    justified: number
    late: number
    students: (Student & { classes: number; absent: number; justified: number; late: number })[]
  }
  grades: {
    reference: { periodId: string; name: string; closed: boolean } | null
    graded: number
    alert: number
    distribution: { levelId: string; label: string; isAlert: boolean; count: number }[]
    students: (Student & { valueHundredths: number; levelLabel: string | null; isAlert: boolean })[]
  }
  evolution: {
    from: { periodId: string; name: string }
    to: { periodId: string; name: string }
    compared: number
    improved: number
    same: number
    declined: number
    students: (Student & { fromHundredths: number; toHundredths: number })[]
  } | null
}

export type GroupTile = { label: string; value: string; detail: string }

/** Los números de la asistencia, cada uno con su base: las marcas son alumno × clase. */
export function attendanceTiles(attendance: GroupIndicators['attendance']): GroupTile[] {
  const present = attendance.marks - attendance.absent - attendance.justified
  return [
    {
      label: 'Asistencia a tus clases',
      value: formatRatio(present, attendance.marks),
      detail: `${formatCount(present)} de ${formatCount(attendance.marks)} marcas, en ${formatCount(attendance.classesWithRollCall)} clases con lista.`,
    },
    {
      label: 'Faltas sin justificar',
      value: formatCount(attendance.absent),
      detail: `De ${formatCount(attendance.marks)} marcas (${formatRatio(attendance.absent, attendance.marks)}).`,
    },
    {
      label: 'Justificadas',
      value: formatCount(attendance.justified),
      detail: `De ${formatCount(attendance.absent + attendance.justified)} faltas a tus clases.`,
    },
    {
      label: 'Llegadas tarde',
      value: formatCount(attendance.late),
      detail: `De ${formatCount(attendance.marks)} marcas. Llegar tarde es que vino.`,
    },
  ]
}

/** Las notas del boletín por tramo de la escala, de la más baja a la más alta. */
export function distributionParts(grades: GroupIndicators['grades']): Part[] {
  const ramp = (index: number) => ORDINAL_COLORS[Math.min(index, ORDINAL_COLORS.length - 1)]
  return grades.distribution.map((bucket, index) => ({
    key: bucket.levelId,
    label: bucket.label,
    value: bucket.count,
    color: ramp(index),
    alert: bucket.isAlert,
  }))
}

export function evolutionParts(evolution: NonNullable<GroupIndicators['evolution']>): Part[] {
  return [
    { key: 'improved', label: 'Subieron', value: evolution.improved, color: SERIES_COLORS[0] },
    { key: 'same', label: 'Igual', value: evolution.same, color: SERIES_COLORS[2] },
    { key: 'declined', label: 'Bajaron', value: evolution.declined, color: SERIES_COLORS[1] },
  ]
}

/** «4 de 30 con la R en alerta en 2.ª Entrega (todavía sin cerrar).» */
export function alertSummary(grades: GroupIndicators['grades']): string | null {
  if (!grades.reference) return null
  const pending = grades.reference.closed ? '' : ' (todavía sin cerrar)'
  return `${formatCount(grades.alert)} de ${formatCount(grades.graded)} con la R en alerta en ${grades.reference.name}${pending}.`
}

/** Para «Mi día»: una línea por grupo con lo esencial. */
export function groupLine(indicators: Pick<GroupIndicators, 'attendance' | 'grades' | 'evolution'>): string[] {
  const parts: string[] = []
  const { attendance, grades, evolution } = indicators
  if (attendance.marks > 0) {
    parts.push(`asistencia ${formatRatio(attendance.marks - attendance.absent - attendance.justified, attendance.marks)}`)
  }
  if (grades.reference) parts.push(`${formatCount(grades.alert)} de ${formatCount(grades.graded)} con R en alerta`)
  if (evolution && evolution.declined > 0) parts.push(`${formatCount(evolution.declined)} ${evolution.declined === 1 ? 'bajó' : 'bajaron'}`)
  return parts
}
