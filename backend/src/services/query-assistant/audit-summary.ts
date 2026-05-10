import { AuditAction } from '@prisma/client'
import { prisma } from '../../prisma.js'
import { AUDIT_ACTION_LABELS } from '../audit-log.js'
import { resolveYmdRangeFromPayload, ymdBoundsUtc, ymdRangeForCalendarMonth } from './date-range.js'
import type { LlmIntentPayload, QueryAssistantTableResult } from './schemas.js'

function actionsMatchingKeyword(kw: string): AuditAction[] {
  const k = kw.trim().toLowerCase()
  if (!k) return Object.values(AuditAction)
  return (Object.keys(AUDIT_ACTION_LABELS) as AuditAction[]).filter(
    (code) => code.toLowerCase().includes(k) || AUDIT_ACTION_LABELS[code].toLowerCase().includes(k),
  )
}

export async function executeAuditLogSummary(
  payload: LlmIntentPayload,
): Promise<QueryAssistantTableResult> {
  let range = resolveYmdRangeFromPayload(payload.params)
  if (!range) {
    const now = new Date()
    range = ymdRangeForCalendarMonth(now.getUTCFullYear(), now.getUTCMonth() + 1)
  }
  const { start, end } = ymdBoundsUtc(range.from, range.to)
  const kw = payload.params.auditActionKeyword?.trim()
  const actions = kw ? actionsMatchingKeyword(kw) : Object.values(AuditAction)
  if (actions.length === 0) {
    return {
      intent: 'AUDIT_LOG_SUMMARY',
      summary: `No hay acciones de auditoría que coincidan con «${kw}».`,
      columns: [],
      rows: [],
    }
  }

  const logs = await prisma.auditLog.findMany({
    where: {
      occurredAt: { gte: start, lte: end },
      action: { in: actions },
    },
    orderBy: { occurredAt: 'desc' },
    take: 250,
    include: {
      actor: { select: { id: true, name: true, firstName: true, lastName: true, email: true } },
    },
  })

  return {
    intent: 'AUDIT_LOG_SUMMARY',
    summary:
      payload.reply ||
      `Registros de auditoría entre ${range.from} y ${range.to}${kw ? ` (filtro: ${kw})` : ''}.`,
    columns: [
      { key: 'cuando', label: 'Fecha' },
      { key: 'accion', label: 'Acción' },
      { key: 'actor', label: 'Actor' },
      { key: 'ip', label: 'IP' },
      { key: 'fuente', label: 'Fuente' },
    ],
    rows: logs.map((l) => ({
      cuando: l.occurredAt.toISOString().slice(0, 19).replace('T', ' '),
      accion: AUDIT_ACTION_LABELS[l.action] ?? l.action,
      actor: l.actor ? l.actor.name || l.actor.email : '—',
      ip: l.actorIp ?? '—',
      fuente: l.source,
    })),
  }
}
