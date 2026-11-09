/**
 * Cuentas de prueba por perfil: N por cada perfil del sistema (por defecto 3), listas para entrar
 * con usuario y contraseña. Sirven para probar qué ve cada perfil: el menú, la Guía y las pantallas.
 *
 *   cd backend && npx tsx scripts/provision-role-test-accounts.ts --dry-run   # muestra qué haría
 *   cd backend && npx tsx scripts/provision-role-test-accounts.ts
 *   cd backend && npx tsx scripts/provision-role-test-accounts.ts --roles=DIRECCION,SECRETARIA --count=2
 *
 * - Usuario `<perfil><n>` (direccion1, adscripto2, secretaria3, docente1, personal2) y correo
 *   `<usuario>@pruebas.liceo.test`: el dominio `.test` está reservado, así que no sale ningún correo.
 * - La cuenta nace aprobada, activa, con el correo verificado y con todos sus datos (nombre, cédula
 *   válida, nacimiento): no pasa por «Completar perfil».
 * - Contraseña: `TEST_ACCOUNTS_PASSWORD` para todas, o una al azar por cuenta. Se imprime una sola
 *   vez, al final; nunca va al repositorio (es público).
 * - Idempotente: si la cuenta de prueba ya existe, le vuelve a poner el perfil y la contraseña. Un
 *   usuario con ese nombre que no es de prueba (otro correo) no se toca.
 * - Administración no se crea: nace sólo del bootstrap.
 * - Una recarga de datos de prueba (`seed-liceo-basico`) las borra, salvo que vayan en SEED_KEEP_EMAILS.
 */
import 'dotenv/config'
import crypto from 'node:crypto'
import { prisma } from '../src/db/prisma.js'
import {
  createKeycloakUser,
  freeKeycloakUsernameIfOrphan,
  getKeycloakUserIdByEmail,
  resetKeycloakPassword,
  syncKeycloakUserIdentity,
} from '../src/auth/keycloak.js'
import { isAppKeycloakAccount, linkKeycloakAccount } from '../src/auth/keycloak-provisioning.js'
import { isStrongPassword } from '../src/auth/password-policy.js'
import { computeCICheckDigit } from '../src/identity/uruguay-ci.js'

const DRY_RUN = process.argv.includes('--dry-run')
const DOMAIN = 'pruebas.liceo.test'
const BIRTHDATE = new Date('1990-01-01T12:00:00.000Z')

/** Perfil → cómo se llaman sus cuentas de prueba. ADMIN no está a propósito. */
const ROLE_ACCOUNTS: Record<string, { slug: string; label: string }> = {
  DIRECCION: { slug: 'direccion', label: 'Dirección' },
  ADSCRIPTO: { slug: 'adscripto', label: 'Adscripción' },
  SECRETARIA: { slug: 'secretaria', label: 'Secretaría' },
  TEACHER: { slug: 'docente', label: 'Docente' },
  STAFF: { slug: 'personal', label: 'Personal' },
}

function argValue(name: string): string | undefined {
  const arg = process.argv.find((value) => value.startsWith(`--${name}=`))
  return arg?.slice(name.length + 3)
}

const COUNT = Math.max(1, Math.min(10, Number(argValue('count') ?? 3) || 3))
const ROLES = (argValue('roles') ?? Object.keys(ROLE_ACCOUNTS).join(','))
  .split(',')
  .map((code) => code.trim().toUpperCase())
  .filter(Boolean)

/** Sin 0/O, 1/l/I: se dicta y se copia sin confundirse. */
const LOWER = 'abcdefghijkmnpqrstuvwxyz'
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const DIGITS = '23456789'

function pick(chars: string): string {
  return chars[crypto.randomInt(chars.length)]
}

/** 3 grupos de 4 (≈ 70 bits), siempre con mayúscula, minúscula y número (política del realm). */
function randomPassword(): string {
  const all = LOWER + UPPER + DIGITS
  for (;;) {
    const groups = Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => pick(all)).join(''))
    const candidate = groups.join('-')
    if (isStrongPassword(candidate)) return candidate
  }
}

const SHARED_PASSWORD = process.env.TEST_ACCOUNTS_PASSWORD?.trim() || null
if (SHARED_PASSWORD && !isStrongPassword(SHARED_PASSWORD)) {
  console.error('TEST_ACCOUNTS_PASSWORD no cumple la política: 8 a 64 caracteres, con mayúscula, minúscula y número.')
  process.exit(1)
}

/** Una cédula válida que nadie tiene, a partir de un rango que no usan los datos de prueba. */
async function freeNationalId(taken: Set<string>): Promise<string> {
  for (let base = 6_500_000; base < 6_600_000; base += 1) {
    const base7 = String(base).padStart(7, '0')
    const ci = `${base7}${computeCICheckDigit(base7)}`
    if (taken.has(ci)) continue
    taken.add(ci)
    if (!(await prisma.user.findFirst({ where: { nationalId: ci }, select: { id: true } }))) return ci
  }
  throw new Error('No quedan cédulas libres en el rango de prueba')
}

type Planned = { role: string; label: string; username: string; email: string; firstName: string; lastName: string }

function plannedAccounts(): Planned[] {
  return ROLES.flatMap((role) => {
    const meta = ROLE_ACCOUNTS[role]
    if (!meta) {
      console.warn(`[cuentas] ${role}: no es un perfil con cuentas de prueba (ADMIN nace del bootstrap)`)
      return []
    }
    return Array.from({ length: COUNT }, (_, index) => {
      const username = `${meta.slug}${index + 1}`
      return {
        role,
        label: meta.label,
        username,
        email: `${username}@${DOMAIN}`,
        firstName: 'Prueba',
        lastName: `${meta.label} ${index + 1}`,
      }
    })
  })
}

/** La cuenta de acceso: se crea con su contraseña, o se le vuelve a poner si ya existía. */
async function ensureAccess(account: Planned, userId: string, linkedKcId: string | null, password: string) {
  const kcId = linkedKcId ?? (await getKeycloakUserIdByEmail(account.email))
  if (kcId) {
    await syncKeycloakUserIdentity({
      kcId,
      email: account.email,
      username: account.username,
      firstName: account.firstName,
      lastName: account.lastName,
      emailVerified: true,
    })
    await resetKeycloakPassword(kcId, password)
    await linkKeycloakAccount(userId, kcId)
    return
  }
  await freeKeycloakUsernameIfOrphan(
    account.username,
    async (mail) => Boolean(await prisma.user.findUnique({ where: { email: mail }, select: { id: true } })),
    isAppKeycloakAccount,
  )
  const created = await createKeycloakUser(
    {
      email: account.email,
      username: account.username,
      firstName: account.firstName,
      lastName: account.lastName,
      password,
      role: account.role,
      emailVerified: true,
    },
    { isAppAccount: isAppKeycloakAccount },
  )
  await linkKeycloakAccount(userId, created)
}

async function provision(account: Planned, roleId: string, takenCis: Set<string>): Promise<string | null> {
  const existing = await prisma.user.findFirst({
    where: { OR: [{ username: account.username }, { email: account.email }] },
    select: { id: true, email: true, keycloakId: true, approvedAt: true, emailVerifiedAt: true },
  })
  if (existing && existing.email.toLowerCase() !== account.email) {
    console.warn(`[cuentas] ${account.username}: ya lo usa ${existing.email}, que no es de prueba; no se toca`)
    return null
  }
  if (DRY_RUN) {
    console.log(`[cuentas] ${existing ? 'actualizaría' : 'crearía'} ${account.username} (${account.label})`)
    return null
  }

  const now = new Date()
  const profile = {
    firstName: account.firstName,
    lastName: account.lastName,
    name: `${account.firstName} ${account.lastName}`,
    roleId,
    isActive: true,
    isApproved: true,
  }
  const userId = existing
    ? (
        await prisma.user.update({
          where: { id: existing.id },
          data: { ...profile, approvedAt: existing.approvedAt ?? now, emailVerifiedAt: existing.emailVerifiedAt ?? now, lockUntil: null },
          select: { id: true },
        })
      ).id
    : (
        await prisma.user.create({
          data: {
            ...profile,
            email: account.email,
            username: account.username,
            nationalId: await freeNationalId(takenCis),
            birthdate: BIRTHDATE,
            approvedAt: now,
            emailVerifiedAt: now,
          },
          select: { id: true },
        })
      ).id

  if (account.role === 'TEACHER') {
    // Como el seed: el docente tiene su ficha, que es lo que lo ofrece al asignar clases.
    await prisma.teacherProfile.upsert({
      where: { userId },
      create: { userId, displayName: profile.name, notes: 'Cuenta de prueba' },
      update: { isActive: true },
    })
  }

  const password = SHARED_PASSWORD ?? randomPassword()
  await ensureAccess(account, userId, existing?.keycloakId ?? null, password)
  return password
}

async function main() {
  const accounts = plannedAccounts()
  const roles = await prisma.orgRole.findMany({
    where: { code: { in: [...new Set(accounts.map((a) => a.role))] }, active: true },
    select: { id: true, code: true },
  })
  const roleIds = new Map(roles.map((role) => [role.code, role.id]))
  const takenCis = new Set<string>()
  const ready: Array<Planned & { password: string }> = []

  for (const account of accounts) {
    const roleId = roleIds.get(account.role)
    if (!roleId) {
      console.warn(`[cuentas] ${account.role}: el perfil no existe o está inactivo (¿falta el deploy?)`)
      continue
    }
    try {
      const password = await provision(account, roleId, takenCis)
      if (password) ready.push({ ...account, password })
    } catch (error) {
      console.error(`[cuentas] ${account.username}: no se pudo crear el acceso`, error)
    }
  }

  if (DRY_RUN || ready.length === 0) return
  console.log('\nCuentas de prueba (la contraseña se muestra sólo ahora):\n')
  console.log(['Perfil'.padEnd(12), 'Usuario'.padEnd(14), 'Contraseña'].join(' '))
  for (const row of ready) console.log([row.label.padEnd(12), row.username.padEnd(14), row.password].join(' '))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
