import { blockingSections, canFinalize, currentStates, pendingAgeDays, statusOf, type Section, type Status } from './endorsement.js'

/**
 * Cómo se muestra el visado de un período de libreta.
 *
 * Lo usan la grilla de supervisión (`/admin/gradebook/endorsements`) y la sección Visados del
 * docente (`/gradebook/:id/endorsements`): las dos tienen que contar lo mismo, así que la forma
 * vive acá y no en una de las rutas.
 */

/** Lo que hace falta traer de un `GradeBookPeriod` para armar su fila de visado. */
export const ENDORSEMENT_ROW_INCLUDE = {
  endorsements: { orderBy: { occurredAt: 'asc' as const } },
  period: { select: { id: true, code: true, name: true, sortOrder: true } },
  gradeBook: {
    include: {
      subject: { select: { id: true, name: true } },
      teacher: { select: { id: true, name: true } },
      courseOffering: { include: { course: { select: { name: true } } } },
      courseOrientation: { include: { orientation: { select: { name: true } } } },
    },
  },
}

const SECTIONS: readonly Section[] = ['GRADES', 'CLOSURE', 'JUDGEMENTS', 'PLANNING', 'GROUP_REPORT', 'ALL']

type EndorsementDetail = {
  section: Section
  status: Status
  occurredAt: Date
  observations: string | null
  actorRoleCode: string
}

/**
 * ¿El período volvió a cerrarse después de la observación viva más reciente?
 *
 * Una observación sólo se registra sobre un período cerrado, así que un `closedAt` posterior
 * significa que se reabrió y se volvió a cerrar: el docente corrigió y adscripción tiene que
 * revisar antes de darlo por corregido.
 */
export function reclosedAfterObservation(params: {
  periodStatus: string
  closedAt: Date | null
  observedAt: readonly Date[]
}): boolean {
  if (params.periodStatus !== 'CLOSED' || !params.closedAt || params.observedAt.length === 0) return false
  const lastObservation = Math.max(...params.observedAt.map((date) => date.getTime()))
  return params.closedAt.getTime() > lastObservation
}

/**
 * Lo que dice el visado de un período: el estado de cada sección, el general, lo observado y si se
 * volvió a cerrar después de la observación. Es lo que necesitan el docente y su Inicio; la fila
 * entera de la grilla (`serializeEndorsementRow`) le suma la libreta.
 */
export function reviewSummary(row: {
  status: string
  closedAt: Date | null
  endorsements: readonly unknown[]
}) {
  // Las filas vienen de un include de Prisma: se fija el genérico a mano para no perder
  // `observations` y `actorRoleCode`.
  const states = currentStates<EndorsementDetail>(row.endorsements as EndorsementDetail[])
  const sections = SECTIONS.map((section) => {
    const current = states.get(section)
    return {
      section,
      status: statusOf(states, section),
      occurredAt: current?.occurredAt ?? null,
      observations: current?.observations ?? null,
      actorRoleCode: current?.actorRoleCode ?? null,
    }
  })
  const blocking = blockingSections(states)
  return {
    states,
    sections,
    overallStatus: statusOf(states, 'ALL'),
    blockingSections: blocking,
    reclosedAfterObservation: reclosedAfterObservation({
      periodStatus: row.status,
      closedAt: row.closedAt ?? null,
      observedAt: blocking.map((section) => states.get(section)!.occurredAt),
    }),
  }
}

export function serializeEndorsementRow(row: any, now: Date) {
  const { states, sections, overallStatus, blockingSections: blocking, reclosedAfterObservation: reclosed } = reviewSummary(row)
  const lastChange = row.endorsements.at(-1)?.occurredAt ?? row.closedAt ?? row.updatedAt

  return {
    gradeBookPeriodId: row.id,
    gradeBookId: row.gradeBookId,
    periodStatus: row.status,
    closedAt: row.closedAt,
    closedLate: row.closedLate,
    period: row.period,
    subject: row.gradeBook.subject,
    teacher: row.gradeBook.teacher,
    courseName: row.gradeBook.courseOffering.course.name,
    orientationName: row.gradeBook.courseOrientation?.orientation.name ?? null,
    sections,
    overallStatus,
    lastChangeAt: lastChange,
    /** Antigüedad del pendiente, para priorizar en la grilla (§5.9). */
    pendingAgeDays: overallStatus === 'ENDORSED' ? null : pendingAgeDays(lastChange, now),
    blockingSections: blocking,
    canFinalize: canFinalize(states),
    reclosedAfterObservation: reclosed,
  }
}

export type EndorsementRowView = ReturnType<typeof serializeEndorsementRow>
