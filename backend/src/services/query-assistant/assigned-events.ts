import type { EventStatus, EventType } from '@prisma/client'
import { prisma } from '../../prisma.js'
import { resolveYmdRangeFromPayload, ymdBoundsUtc } from './date-range.js'
import { resolveUserIdsFromSearch, userDisplayName } from './helpers.js'
import type { LlmIntentPayload, QueryAssistantTableResult } from './schemas.js'

const TYPE_LABEL: Record<EventType, string> = {
  JORNADA_LABORAL: 'Jornada',
  REUNION: 'Reunión',
  CLASE: 'Clase',
  EVENTO: 'Evento',
  CAPACITACION: 'Capacitación',
  CITA_MEDICA: 'Cita médica',
}

const STATUS_LABEL: Record<EventStatus, string> = {
  SCHEDULED: 'Programado',
  IN_PROGRESS: 'En curso',
  COMPLETED: 'Completado',
  CANCELLED: 'Cancelado',
  EXPIRED: 'Vencido',
}

function minutesBetween(start: Date, end: Date | null): number | null {
  if (!end) return null
  const m = Math.round((end.getTime() - start.getTime()) / 60000)
  return m >= 0 ? m : null
}

export async function executeAssignedEventsSummary(
  payload: LlmIntentPayload,
): Promise<QueryAssistantTableResult> {
  const range = resolveYmdRangeFromPayload(payload.params)
  if (!range) {
    return {
      intent: 'ASSIGNED_EVENTS_SUMMARY',
      summary: 'Indicá un mes o rango para eventos asignados a personal.',
      columns: [],
      rows: [],
    }
  }
  const { start, end } = ymdBoundsUtc(range.from, range.to)
  const userIds = await resolveUserIdsFromSearch(payload.params.userSearch)
  if (userIds !== null && userIds.length === 0) {
    return {
      intent: 'ASSIGNED_EVENTS_SUMMARY',
      summary: 'No encontré usuarios que coincidan con la búsqueda.',
      columns: [],
      rows: [],
    }
  }

  const events = await prisma.event.findMany({
    where: {
      assignedUserId: { not: null },
      startDate: { gte: start, lte: end },
      ...(userIds ? { assignedUserId: { in: userIds } } : {}),
    },
    orderBy: { startDate: 'asc' },
    take: 800,
    include: {
      assignedUser: {
        select: { id: true, name: true, firstName: true, lastName: true, username: true, orgRole: { select: { code: true } } },
      },
    },
  })

  type Agg = { count: number; minutesPlanned: number }
  const byUser = new Map<string, Agg>()
  for (const e of events) {
    const uid = e.assignedUserId!
    const cur = byUser.get(uid) ?? { count: 0, minutesPlanned: 0 }
    cur.count += 1
    const st = e.startTime
    const en = e.endTime
    const mins = st && en ? minutesBetween(st, en) : null
    if (mins != null) cur.minutesPlanned += mins
    byUser.set(uid, cur)
  }

  const uids = [...byUser.keys()]
  const users = await prisma.user.findMany({
    where: { id: { in: uids } },
    select: { id: true, name: true, firstName: true, lastName: true, username: true, orgRole: { select: { code: true } } },
  })

  const detailRows: Record<string, string | number | null>[] = events.slice(0, 200).map((e) => ({
    inicio: e.startDate.toISOString().slice(0, 16).replace('T', ' '),
    tipo: TYPE_LABEL[e.type],
    estado: STATUS_LABEL[e.status],
    titulo: e.title.length > 60 ? `${e.title.slice(0, 57)}…` : e.title,
    asignado: e.assignedUser ? userDisplayName(e.assignedUser) : '—',
    rol: e.assignedUser?.orgRole?.code ?? '—',
  }))

  const aggRows: Record<string, string | number | null>[] = [...byUser.entries()]
    .map(([uid, agg]) => {
      const u = users.find((x) => x.id === uid)
      return {
        persona: u ? userDisplayName(u) : uid,
        rol: u?.orgRole?.code ?? '—',
        eventos: agg.count,
        minutos_planificados: agg.minutesPlanned,
      }
    })
    .sort((a, b) => Number(b.eventos) - Number(a.eventos))

  const useDetail = payload.params.userSearch?.trim()
  return {
    intent: 'ASSIGNED_EVENTS_SUMMARY',
    summary:
      payload.reply ||
      (useDetail
        ? `Eventos asignados entre ${range.from} y ${range.to} (detalle, hasta 200 filas).`
        : `Resumen de eventos asignados por persona entre ${range.from} y ${range.to}.`),
    columns: useDetail
      ? [
          { key: 'inicio', label: 'Inicio' },
          { key: 'tipo', label: 'Tipo' },
          { key: 'estado', label: 'Estado' },
          { key: 'titulo', label: 'Título' },
          { key: 'asignado', label: 'Asignado a' },
          { key: 'rol', label: 'Rol' },
        ]
      : [
          { key: 'persona', label: 'Persona' },
          { key: 'rol', label: 'Rol' },
          { key: 'eventos', label: 'Eventos' },
          { key: 'minutos_planificados', label: 'Min. planif. (horario)' },
        ],
    rows: useDetail ? detailRows : aggRows,
  }
}
