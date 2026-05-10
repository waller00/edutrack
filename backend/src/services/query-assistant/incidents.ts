import type { AttendanceIncidentStatus, AttendanceIncidentType } from '@prisma/client'
import { prisma } from '../../prisma.js'
import { resolveYmdRangeFromPayload, ymdBoundsUtc } from './date-range.js'
import { resolveUserIdsFromSearch, userDisplayName } from './helpers.js'
import type { LlmIntentPayload, QueryAssistantTableResult } from './schemas.js'

const TYPE_LABEL: Record<AttendanceIncidentType, string> = {
  LATE_ARRIVAL: 'Llegada tarde',
  TEACHER_NO_SHOW: 'Ausencia docente',
  EARLY_EXIT: 'Salida anticipada',
}

const STATUS_LABEL: Record<AttendanceIncidentStatus, string> = {
  OPEN: 'Abierta',
  ACKNOWLEDGED: 'Reconocida',
  RESOLVED: 'Resuelta',
}

export async function executeAttendanceIncidentsSummary(
  payload: LlmIntentPayload,
): Promise<QueryAssistantTableResult> {
  const range = resolveYmdRangeFromPayload(payload.params)
  if (!range) {
    return {
      intent: 'ATTENDANCE_INCIDENTS_SUMMARY',
      summary: 'Indicá un mes (o rango de fechas) para listar incidencias de asistencia.',
      columns: [],
      rows: [],
    }
  }
  const { start, end } = ymdBoundsUtc(range.from, range.to)
  const userIds = await resolveUserIdsFromSearch(payload.params.userSearch)
  if (userIds !== null && userIds.length === 0) {
    return {
      intent: 'ATTENDANCE_INCIDENTS_SUMMARY',
      summary: 'No encontré usuarios que coincidan con la búsqueda.',
      columns: [],
      rows: [],
    }
  }

  const openOnly = payload.params.incidentStatusScope === 'OPEN_ONLY'
  const tscope = payload.params.incidentTypeScope ?? 'ALL'
  const typeFilter: AttendanceIncidentType | undefined =
    tscope === 'ALL' ? undefined : (tscope as AttendanceIncidentType)

  const rows = await prisma.attendanceIncident.findMany({
    where: {
      detectedAt: { gte: start, lte: end },
      ...(openOnly ? { status: 'OPEN' as const } : {}),
      ...(typeFilter ? { type: typeFilter } : {}),
      ...(userIds ? { userId: { in: userIds } } : {}),
    },
    orderBy: { detectedAt: 'desc' },
    take: 500,
    include: {
      user: { select: { id: true, name: true, firstName: true, lastName: true, username: true, orgRole: { select: { code: true } } } },
    },
  })

  return {
    intent: 'ATTENDANCE_INCIDENTS_SUMMARY',
    summary:
      payload.reply ||
      `Incidencias entre ${range.from} y ${range.to}${openOnly ? ' (solo abiertas)' : ''}.`,
    columns: [
      { key: 'fecha', label: 'Detectada' },
      { key: 'tipo', label: 'Tipo' },
      { key: 'estado', label: 'Estado' },
      { key: 'persona', label: 'Persona' },
      { key: 'rol', label: 'Rol' },
      { key: 'titulo', label: 'Título' },
    ],
    rows: rows.map((r) => ({
      fecha: r.detectedAt.toISOString().slice(0, 16).replace('T', ' '),
      tipo: TYPE_LABEL[r.type],
      estado: STATUS_LABEL[r.status],
      persona: userDisplayName(r.user),
      rol: r.user.orgRole?.code ?? '—',
      titulo: r.title,
    })),
  }
}
