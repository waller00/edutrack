import type { Prisma } from '@prisma/client'
import { prisma } from '../../db/prisma.js'
import { userDisplayName } from './helpers.js'
import type { LlmIntentPayload, QueryAssistantTableResult } from './schemas.js'

export async function executeUsersAdminSnapshot(
  payload: LlmIntentPayload,
): Promise<QueryAssistantTableResult> {
  const scope = payload.params.userAdminScope ?? 'ACTIVE_RECENT'
  const now = new Date()
  const in90 = new Date(now)
  in90.setUTCDate(in90.getUTCDate() + 90)

  let where: Prisma.UserWhereInput
  let title = ''

  switch (scope) {
    case 'PENDING_APPROVAL':
      where = { isApproved: false }
      title = 'Usuarios pendientes de aprobación'
      break
    case 'INACTIVE':
      where = { isActive: false }
      title = 'Cuentas inactivas'
      break
    case 'DOC_EXPIRING_90D':
      where = {
        nationalIdDocumentExpiresAt: { not: null, gte: now, lte: in90 },
        isActive: true,
      }
      title = 'CI/documento con vencimiento en los próximos 90 días'
      break
    case 'LOCKED':
      where = { lockUntil: { gt: now } }
      title = 'Cuentas con bloqueo temporal activo'
      break
    case 'ACTIVE_RECENT':
    default:
      where = { isApproved: true, isActive: true }
      title = 'Usuarios activos recientes (últimos registros)'
      break
  }

  const users = await prisma.user.findMany({
    where,
    orderBy: scope === 'ACTIVE_RECENT' ? { createdAt: 'desc' } : { updatedAt: 'desc' },
    take: scope === 'ACTIVE_RECENT' ? 100 : 200,
    select: {
      id: true,
      email: true,
      name: true,
      firstName: true,
      lastName: true,
      username: true,
      isApproved: true,
      isActive: true,
      lockUntil: true,
      nationalIdDocumentExpiresAt: true,
      createdAt: true,
      orgRole: { select: { code: true, label: true } },
    },
  })

  return {
    intent: 'USERS_ADMIN_SNAPSHOT',
    summary: payload.reply || title,
    columns: [
      { key: 'persona', label: 'Persona' },
      { key: 'email', label: 'Email' },
      { key: 'rol', label: 'Rol' },
      { key: 'aprobado', label: 'Aprobado' },
      { key: 'activo', label: 'Activo' },
      { key: 'doc_vence', label: 'Doc. vence' },
      { key: 'bloqueo', label: 'Bloqueo hasta' },
      { key: 'alta', label: 'Alta' },
    ],
    rows: users.map((u) => ({
      persona: userDisplayName(u),
      email: u.email,
      rol: u.orgRole?.code ?? '—',
      aprobado: u.isApproved ? 'Sí' : 'No',
      activo: u.isActive ? 'Sí' : 'No',
      doc_vence: u.nationalIdDocumentExpiresAt ? u.nationalIdDocumentExpiresAt.toISOString().slice(0, 10) : '—',
      bloqueo: u.lockUntil && u.lockUntil > now ? u.lockUntil.toISOString().slice(0, 16).replace('T', ' ') : '—',
      alta: u.createdAt.toISOString().slice(0, 10),
    })),
  }
}
