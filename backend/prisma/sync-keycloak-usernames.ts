/**
 * Sincroniza identidad básica Postgres -> Keycloak sin tocar contraseñas.
 * Útil para producción cuando Keycloak quedó con username=email.
 *
 *   npm run sync:keycloak:usernames
 */
import 'dotenv/config'
import { prisma } from '../src/db/prisma.js'

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

async function findUserId(token: string, query: { email?: string; username?: string }): Promise<string | null> {
  const params = new URLSearchParams({ exact: 'true' })
  if (query.email) params.set('email', query.email)
  if (query.username) params.set('username', query.username)
  const res = await fetch(`${adminBaseUrl()}/admin/realms/${adminRealm()}/users?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
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

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL no definida')
  const token = await getAdminToken()
  const users = await prisma.user.findMany({
    where: { isActive: true, email: { not: '' } },
    select: {
      email: true,
      username: true,
      firstName: true,
      lastName: true,
      orgRole: { select: { code: true } },
    },
    orderBy: [{ orgRole: { code: 'asc' } }, { email: 'asc' }],
  })

  let updated = 0
  let skipped = 0

  for (const user of users) {
    const email = user.email?.trim()
    const username = user.username?.trim()
    const role = user.orgRole?.code
    if (!email || !username || !role || role === 'POSTMAN_ROLE') {
      skipped += 1
      continue
    }
    const kcId =
      (await findUserId(token, { email })) ||
      (await findUserId(token, { username }))
    if (!kcId) {
      skipped += 1
      console.warn(`[sync-kc-usernames] omitido: no existe en Keycloak ${email} (${username})`)
      continue
    }

    const res = await fetch(`${adminBaseUrl()}/admin/realms/${adminRealm()}/users/${kcId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        email,
        username,
        firstName: user.firstName ?? undefined,
        lastName: user.lastName ?? undefined,
        enabled: true,
      }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`update user ${email} ${res.status}: ${detail}`)
    }
    await assignRealmRole(token, kcId, role)
    updated += 1
    console.log(`[sync-kc-usernames] actualizado: ${username} <${email}> (${role})`)
  }

  console.log(`[sync-kc-usernames] Listo — actualizados: ${updated}, omitidos: ${skipped}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
