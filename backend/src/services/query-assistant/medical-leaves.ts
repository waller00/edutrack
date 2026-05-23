import type { MedicalLeaveStatus, MedicalLeaveType } from '@prisma/client'
import { prisma } from '../../db/prisma.js'
import { resolveYmdRangeFromPayload, ymdBoundsUtc } from './date-range.js'
import { resolveUserIdsFromSearch, userDisplayName } from './helpers.js'
import type { LlmIntentPayload, QueryAssistantTableResult } from './schemas.js'

const TYPE_LABEL: Record<MedicalLeaveType, string> = {
  MEDICAL_LEAVE: 'Licencia médica',
  WORK_LEAVE: 'Permiso laboral',
  OTHER: 'Otro',
}

const STATUS_LABEL: Record<MedicalLeaveStatus, string> = {
  ACTIVE: 'Activa',
  INACTIVE: 'Inactiva',
}

export async function executeMedicalLeavesSummary(
  payload: LlmIntentPayload,
): Promise<QueryAssistantTableResult> {
  const range = resolveYmdRangeFromPayload(payload.params)
  if (!range) {
    return {
      intent: 'MEDICAL_LEAVES_SUMMARY',
      summary: 'Indicá un mes o rango para licencias que se solapen con esas fechas.',
      columns: [],
      rows: [],
    }
  }
  const { start, end } = ymdBoundsUtc(range.from, range.to)
  const userIds = await resolveUserIdsFromSearch(payload.params.userSearch)
  if (userIds !== null && userIds.length === 0) {
    return {
      intent: 'MEDICAL_LEAVES_SUMMARY',
      summary: 'No encontré usuarios que coincidan con la búsqueda.',
      columns: [],
      rows: [],
    }
  }

  const leaveScope = payload.params.leaveStatusScope ?? 'ALL'
  const statusFilter =
    leaveScope === 'ACTIVE_ONLY' ? ({ status: 'ACTIVE' as const } as const) : leaveScope === 'INACTIVE_ONLY' ? ({ status: 'INACTIVE' as const } as const) : {}

  const leaves = await prisma.medicalLeave.findMany({
    where: {
      AND: [{ startDate: { lte: end } }, { endDate: { gte: start } }],
      ...statusFilter,
      ...(userIds ? { userId: { in: userIds } } : {}),
    },
    orderBy: { startDate: 'desc' },
    take: 300,
    include: {
      user: { select: { id: true, name: true, firstName: true, lastName: true, username: true, orgRole: { select: { code: true } } } },
    },
  })

  return {
    intent: 'MEDICAL_LEAVES_SUMMARY',
    summary:
      payload.reply ||
      `Licencias con período que cruza ${range.from} – ${range.to}${
        leaveScope === 'ACTIVE_ONLY' ? ' (solo activas/vigentes).' : leaveScope === 'INACTIVE_ONLY' ? ' (solo inactivas).' : '.'
      }`,
    columns: [
      { key: 'desde', label: 'Desde' },
      { key: 'hasta', label: 'Hasta' },
      { key: 'tipo', label: 'Tipo' },
      { key: 'estado', label: 'Estado' },
      { key: 'persona', label: 'Persona' },
      { key: 'rol', label: 'Rol' },
      { key: 'motivo', label: 'Motivo' },
    ],
    rows: leaves.map((l) => ({
      desde: l.startDate.toISOString().slice(0, 10),
      hasta: l.endDate.toISOString().slice(0, 10),
      tipo: TYPE_LABEL[l.type],
      estado: STATUS_LABEL[l.status],
      persona: userDisplayName(l.user),
      rol: l.user.orgRole?.code ?? '—',
      motivo: l.reason.length > 120 ? `${l.reason.slice(0, 117)}…` : l.reason,
    })),
  }
}
