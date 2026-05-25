import { prisma } from '../../db/prisma.js'
import { resolveYmdRangeFromPayload, ymdBoundsUtc } from './date-range.js'
import { resolveUserIdsFromSearch, userDisplayName } from './helpers.js'
import type { LlmIntentPayload, QueryAssistantTableResult } from './schemas.js'
import { relatedEventSchoolYearWhere, schoolYearSummarySuffix, type QueryAssistantScope } from './scope.js'

export async function executeAttendanceLateSummary(
  payload: LlmIntentPayload,
  scope?: QueryAssistantScope,
): Promise<QueryAssistantTableResult> {
  const range = resolveYmdRangeFromPayload(payload.params)
  if (!range) {
    return {
      intent: 'ATTENDANCE_LATE_SUMMARY',
      summary: 'Indicá un mes o rango para contar marcas de llegada tarde.',
      columns: [],
      rows: [],
    }
  }
  const { start, end } = ymdBoundsUtc(range.from, range.to)
  const userIds = await resolveUserIdsFromSearch(payload.params.userSearch)
  if (userIds !== null && userIds.length === 0) {
    return {
      intent: 'ATTENDANCE_LATE_SUMMARY',
      summary: 'No encontré usuarios que coincidan con la búsqueda.',
      columns: [],
      rows: [],
    }
  }

  const marks = await prisma.attendance.findMany({
    where: {
      status: 'LATE',
      type: 'CHECK_IN',
      date: { gte: start, lte: end },
      ...(userIds ? { userId: { in: userIds } } : {}),
      ...relatedEventSchoolYearWhere(scope),
    },
    select: { userId: true },
  })

  const counts = new Map<string, number>()
  for (const m of marks) {
    counts.set(m.userId, (counts.get(m.userId) ?? 0) + 1)
  }

  const ids = [...counts.keys()]
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, firstName: true, lastName: true, username: true, orgRole: { select: { code: true } } },
  })

  const rows: Record<string, string | number | null>[] = [...counts.entries()]
    .map(([uid, n]) => {
      const u = users.find((x) => x.id === uid)
      return {
        persona: u ? userDisplayName(u) : uid,
        rol: u?.orgRole?.code ?? '—',
        tardanzas: n,
      }
    })
    .sort((a, b) => Number(b.tardanzas) - Number(a.tardanzas))

  return {
    intent: 'ATTENDANCE_LATE_SUMMARY',
    summary:
      payload.reply ||
      `Entradas registradas como tardías entre ${range.from} y ${range.to}${schoolYearSummarySuffix(scope)} (${marks.length} marcas).`,
    columns: [
      { key: 'persona', label: 'Persona' },
      { key: 'rol', label: 'Rol' },
      { key: 'tardanzas', label: 'Tardanzas' },
    ],
    rows,
  }
}
