import type { BiometricPunchProcessStatus } from '@prisma/client'
import { prisma } from '../../db/prisma.js'
import { resolveYmdRangeFromPayload, ymdBoundsUtc } from './date-range.js'
import { resolveUserIdsFromSearch, userDisplayName } from './helpers.js'
import type { LlmIntentPayload, QueryAssistantTableResult } from './schemas.js'

const STATUS_LABEL: Record<BiometricPunchProcessStatus, string> = {
  PENDING: 'Pendiente',
  PROCESSED: 'Procesada',
  FAILED: 'Fallida',
  DUPLICATE: 'Duplicada',
  LINK_CAPTURED: 'Capturada para vinculación',
}

export async function executeBiometricIssuesSummary(
  payload: LlmIntentPayload,
): Promise<QueryAssistantTableResult> {
  const range = resolveYmdRangeFromPayload(payload.params)
  if (!range) {
    return {
      intent: 'BIOMETRIC_ISSUES_SUMMARY',
      summary: 'Indicá un mes o rango para marcas biométricas con problemas.',
      columns: [],
      rows: [],
    }
  }
  const { start, end } = ymdBoundsUtc(range.from, range.to)
  const userIds = await resolveUserIdsFromSearch(payload.params.userSearch)
  if (userIds !== null && userIds.length === 0) {
    return {
      intent: 'BIOMETRIC_ISSUES_SUMMARY',
      summary: 'No encontré usuarios que coincidan con la búsqueda.',
      columns: [],
      rows: [],
    }
  }

  const scope = payload.params.biometricIssueScope ?? 'BOTH'
  const statuses: BiometricPunchProcessStatus[] =
    scope === 'FAILED' ? ['FAILED'] : scope === 'PENDING' ? ['PENDING'] : ['FAILED', 'PENDING']

  const punches = await prisma.biometricPunch.findMany({
    where: {
      occurredAt: { gte: start, lte: end },
      processStatus: { in: statuses },
      ...(userIds ? { userId: { in: userIds } } : {}),
    },
    orderBy: { occurredAt: 'desc' },
    take: 400,
    include: {
      device: { select: { code: true, name: true } },
      user: { select: { id: true, name: true, firstName: true, lastName: true, username: true, orgRole: { select: { code: true } } } },
    },
  })

  return {
    intent: 'BIOMETRIC_ISSUES_SUMMARY',
    summary:
      payload.reply ||
      `Marcas ${scope === 'BOTH' ? 'fallidas o pendientes' : STATUS_LABEL[statuses[0]!].toLowerCase()} entre ${range.from} y ${range.to}.`,
    columns: [
      { key: 'ocurrido', label: 'Marca' },
      { key: 'estado', label: 'Procesamiento' },
      { key: 'dispositivo', label: 'Dispositivo' },
      { key: 'persona', label: 'Persona' },
      { key: 'rol', label: 'Rol' },
      { key: 'error', label: 'Error' },
    ],
    rows: punches.map((p) => ({
      ocurrido: p.occurredAt.toISOString().slice(0, 19).replace('T', ' '),
      estado: STATUS_LABEL[p.processStatus],
      dispositivo: p.device ? `${p.device.code} · ${p.device.name}` : p.deviceId.slice(0, 8),
      persona: p.user ? userDisplayName(p.user) : `deviceUser ${p.deviceUserId}`,
      rol: p.user?.orgRole?.code ?? '—',
      error: p.processError ? (p.processError.length > 80 ? `${p.processError.slice(0, 77)}…` : p.processError) : '—',
    })),
  }
}
