import { prisma } from '../db/prisma.js'

const CODE_RE = /^[A-Z][A-Z0-9_]*$/

export function normalizeOrgRoleCode(raw: string) {
  return raw.trim().toUpperCase().replace(/\s+/g, '_')
}

export function validateOrgRoleCode(code: string) {
  if (!CODE_RE.test(code)) {
    throw new Error('INVALID_ROLE_CODE')
  }
}

export async function resolveRoleIdByCode(codeNorm: string) {
  const r = await prisma.orgRole.findFirst({ where: { code: codeNorm, active: true } })
  return r?.id ?? null
}

export async function getOrgRoleIdByCodeOrThrow(codeNorm: string): Promise<string> {
  const id = await resolveRoleIdByCode(codeNorm)
  if (!id) throw new Error(`ROLE_NOT_FOUND:${codeNorm}`)
  return id
}

/** Usuarios públicos siguen esperando campo `role` (código del rol). */
export function userWithRoleCode<U extends Record<string, unknown>>(u: U & { orgRole?: { code: string } | null }) {
  const { orgRole, ...rest } = u
  return { ...rest, role: orgRole?.code ?? '' }
}
