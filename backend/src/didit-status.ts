import type { LivenessSessionStatus } from '@prisma/client'

const MAP: Record<string, LivenessSessionStatus> = {
  'not started': 'PENDING',
  pending: 'PENDING',
  'in progress': 'IN_PROGRESS',
  'in review': 'IN_PROGRESS',
  approved: 'APPROVED',
  declined: 'DECLINED',
  abandoned: 'ABANDONED',
  expired: 'EXPIRED',
}

export function diditStringToLivenessStatus(raw: string | undefined | null): LivenessSessionStatus {
  if (!raw) return 'PENDING'
  const n = String(raw).trim().toLowerCase()
  return MAP[n] || 'PENDING'
}
