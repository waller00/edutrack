import { prisma } from '../../db/prisma.js'
import { computeOpensAt } from './edit-window.js'
import { PERSON_SELECT, personRef } from './person.js'

/** Estado del pase de lista de una clase, tal como lo ve administración en el resumen del día. */
export type DayRollCall = {
  /** Serie a la que pertenece la sesión: con `ymd`, la ruta de la planilla. */
  eventId: string
  ymd: string
  status: 'PENDING' | 'TAKEN'
  takenAt: Date | null
  takenBy: string | null
  opensAt: Date
  endAt: Date
}

export type DayRollCallLookup = (occurrence: {
  eventId: string
  /** Una excepción puntual guarda su lista en la serie: la sesión nunca cuelga de un hijo. */
  parentEventId?: string | null
  startAt: Date | null | undefined
  endAt: Date | null | undefined
}) => DayRollCall | null

/**
 * Las listas de un día, en una sola consulta, para cruzarlas con las clases que se muestran.
 * Sin horario no hay cuándo abrir ni cuándo vence: esa clase no lleva estado.
 */
export async function loadDayRollCalls(ymd: string): Promise<DayRollCallLookup> {
  const sessions = await prisma.studentAttendanceSession.findMany({
    where: { occurrenceYmd: ymd },
    select: { eventId: true, status: true, takenAt: true, takenBy: { select: PERSON_SELECT } },
  })
  const byEvent = new Map(sessions.map((session) => [session.eventId, session]))

  return ({ eventId, parentEventId, startAt, endAt }) => {
    if (!startAt || !endAt) return null
    const seriesId = parentEventId ?? eventId
    const session = byEvent.get(seriesId)
    return {
      eventId: seriesId,
      ymd,
      status: session?.status === 'TAKEN' ? 'TAKEN' : 'PENDING',
      takenAt: session?.takenAt ?? null,
      takenBy: personRef(session?.takenBy)?.name ?? null,
      opensAt: computeOpensAt(new Date(startAt)),
      endAt: new Date(endAt),
    }
  }
}
