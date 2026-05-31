/**
 * Sincroniza usuarios activos de Postgres con el realm Keycloak (demo local).
 * Idempotente: crea si falta o actualiza contraseña y rol.
 *
 *   npx tsx prisma/sync-keycloak-users.ts
 */
import 'dotenv/config'
import { prisma } from '../src/db/prisma.js'

const PASSWORD_BY_ROLE: Record<string, string> = {
  ADMIN: process.env.CLEAN_ADMIN_PASSWORD || 'admin123',
  TEACHER: 'docente123',
  STAFF: 'funcionario123',
}

function adminBaseUrl(): string {
  return (process.env.KEYCLOAK_ADMIN_BASE_URL || 'http://keycloak:8080').replace(/\/$/, '')
}

function adminRealm(): string {
  return process.env.KEYCLOAK_ADMIN_REALM || 'edutrack'
}

async function getAdminToken(): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: 'admin-cli',
    username: process.env.KEYCLOAK_ADMIN_USER || 'admin',
    password: process.env.KEYCLOAK_ADMIN_PASSWORD || 'admin',
  })
  const res = await fetch(`${adminBaseUrl()}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`Keycloak admin token error ${res.status}`)
  const json = (await res.json()) as { access_token: string }
  return json.access_token
}

async function findUserId(token: string, email: string): Promise<string | null> {
  const res = await fetch(
    `${adminBaseUrl()}/admin/realms/${adminRealm()}/users?email=${encodeURIComponent(email)}&exact=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) return null
  const users = (await res.json()) as { id?: string }[]
  return users[0]?.id ?? null
}

async function assignRealmRole(token: string, kcUserId: string, roleName: string): Promise<void> {
  const roleRes = await fetch(
    `${adminBaseUrl()}/admin/realms/${adminRealm()}/roles/${encodeURIComponent(roleName)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!roleRes.ok) return
  const role = (await roleRes.json()) as { id: string; name: string }
  await fetch(`${adminBaseUrl()}/admin/realms/${adminRealm()}/users/${kcUserId}/role-mappings/realm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify([{ id: role.id, name: role.name }]),
  })
}

async function setPassword(token: string, kcUserId: string, password: string): Promise<void> {
  const res = await fetch(
    `${adminBaseUrl()}/admin/realms/${adminRealm()}/users/${kcUserId}/reset-password`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ type: 'password', value: password, temporary: false }),
    },
  )
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`reset-password ${res.status}: ${detail}`)
  }
}

async function ensureKeycloakUser(
  token: string,
  input: {
    email: string
    firstName?: string | null
    lastName?: string | null
    role: string
    password: string
  },
): Promise<'created' | 'updated'> {
  let kcId = await findUserId(token, input.email)
  if (!kcId) {
    const createRes = await fetch(`${adminBaseUrl()}/admin/realms/${adminRealm()}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        email: input.email,
        username: input.email,
        firstName: input.firstName ?? undefined,
        lastName: input.lastName ?? undefined,
        enabled: true,
        emailVerified: true,
      }),
    })
    if (createRes.status !== 201) {
      const detail = await createRes.text().catch(() => '')
      throw new Error(`create user ${input.email} ${createRes.status}: ${detail}`)
    }
    const location = createRes.headers.get('location') || ''
    kcId = location.split('/').pop() || ''
    if (!kcId) throw new Error(`sin id Keycloak para ${input.email}`)
    await setPassword(token, kcId, input.password)
    await assignRealmRole(token, kcId, input.role)
    return 'created'
  }
  await setPassword(token, kcId, input.password)
  await assignRealmRole(token, kcId, input.role)
  return 'updated'
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL no definida')
  const token = await getAdminToken()
  const users = await prisma.user.findMany({
    where: { isActive: true, email: { not: '' } },
    select: {
      email: true,
      firstName: true,
      lastName: true,
      orgRole: { select: { code: true } },
    },
    orderBy: [{ orgRole: { code: 'asc' } }, { email: 'asc' }],
  })

  let created = 0
  let updated = 0
  let skipped = 0

  for (const user of users) {
    const email = user.email?.trim()
    const role = user.orgRole?.code
    if (!email || !role || role === 'POSTMAN_ROLE') {
      skipped += 1
      continue
    }
    const password = PASSWORD_BY_ROLE[role]
    if (!password) {
      skipped += 1
      continue
    }
    const result = await ensureKeycloakUser(token, {
      email,
      firstName: user.firstName,
      lastName: user.lastName,
      role,
      password,
    })
    if (result === 'created') created += 1
    else updated += 1
    console.log(`[sync-kc] ${result}: ${email} (${role})`)
  }

  console.log(`[sync-kc] Listo — creados: ${created}, actualizados: ${updated}, omitidos: ${skipped}`)
  console.log('[sync-kc] Credenciales: admin/admin123, docentes/docente123, staff/funcionario123')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
