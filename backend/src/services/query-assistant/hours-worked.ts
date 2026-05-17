import { prisma } from '../../db/prisma.js'
import { getPlannedInstances } from '../analytics/planInstances.js'
import { resolveAttendanceAndJustification } from '../analytics/resolveInstances.js'
import { resolveYmdRangeFromPayload } from './date-range.js'
import { resolveUserIdsFromSearch, userDisplayName } from './helpers.js'
import type { LlmIntentPayload, QueryAssistantTableResult } from './schemas.js'

export async function executeHoursWorkedSummary(
  payload: LlmIntentPayload,
): Promise<QueryAssistantTableResult> {
  const range = resolveYmdRangeFromPayload(payload.params)
  if (!range) {
    return {
      intent: 'HOURS_WORKED_SUMMARY',
      summary: payload.reply || 'Indicá el mes y el año (ej.: octubre 2025) o un rango dateFrom/dateTo.',
      columns: [],
      rows: [],
    }
  }

  const { from, to } = range
  const userIds = await resolveUserIdsFromSearch(payload.params.userSearch)

  if (userIds !== null && userIds.length === 0) {
    return {
      intent: 'HOURS_WORKED_SUMMARY',
      summary: 'No encontré usuarios que coincidan con el nombre o texto indicado.',
      columns: [],
      rows: [],
    }
  }

  const planned = await getPlannedInstances({
    from,
    to,
    ...(userIds ? { userIds } : {}),
  })
  const resolved = await resolveAttendanceAndJustification({ plannedInstances: planned })

  const minutesByUser = new Map<string, number>()
  for (const row of resolved) {
    const uid = row.planned.userIdRequired
    if (!uid) continue
    const prev = minutesByUser.get(uid) ?? 0
    minutesByUser.set(uid, prev + (row.durationMinutes ?? 0))
  }

  const ids = Array.from(minutesByUser.keys())
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, firstName: true, lastName: true, username: true, orgRole: { select: { code: true } } },
  })

  const rows: Record<string, string | number | null>[] = [...minutesByUser.entries()]
    .map(([userId, minutes]) => {
      const u = users.find((x) => x.id === userId)
      const hours = Math.round((minutes / 60) * 100) / 100
      return {
        nombre: u ? userDisplayName(u) : userId,
        rol: u?.orgRole?.code ?? '—',
        horas: hours,
        minutos: Math.round(minutes),
      }
    })
    .sort((a, b) => Number(b.horas) - Number(a.horas))

  return {
    intent: 'HOURS_WORKED_SUMMARY',
    summary:
      payload.reply ||
      `Horas registradas (entrada/salida sobre eventos asignados) entre ${from} y ${to}.`,
    columns: [
      { key: 'nombre', label: 'Persona' },
      { key: 'rol', label: 'Rol' },
      { key: 'horas', label: 'Horas' },
      { key: 'minutos', label: 'Minutos totales' },
    ],
    rows,
  }
}
