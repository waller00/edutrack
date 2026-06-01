/**
 * Usuario admin inicial + configuración mínima (sin datos operativos).
 */
import 'dotenv/config'
import { prisma } from '../src/db/prisma.js'
import { ensureBuiltinOrgRoles } from '../src/identity/org-role-seed.js'
import { upsertCanonicalProfilePermissions } from '../src/identity/profile-permissions-repository.js'

const ADMIN_USERNAME = (process.env.CLEAN_ADMIN_USERNAME || 'admin').toLowerCase()
const ADMIN_PASSWORD = process.env.CLEAN_ADMIN_PASSWORD || 'admin123'
const ADMIN_EMAIL = process.env.CLEAN_ADMIN_EMAIL || 'admin@edutrack.local'

function buildValidCi(baseNumber: number) {
  const base7 = String(Math.abs(baseNumber) % 9_999_999).padStart(7, '0')
  const weights = [2, 9, 8, 7, 6, 3, 4]
  const sum = base7.split('').reduce((acc, digit, index) => acc + Number(digit) * weights[index], 0)
  const checkDigit = (10 - (sum % 10)) % 10
  return `${base7}${checkDigit}`
}

async function ensureSystemSettings() {
  await prisma.systemSettings.upsert({
    where: { id: 'default' },
    create: { id: 'default' },
    update: {},
  })
}

export async function ensureBootstrapAdmin() {
  const adminRole = await prisma.orgRole.findUnique({ where: { code: 'ADMIN' } })
  if (!adminRole) throw new Error('Falta OrgRole ADMIN — ejecutá seed de roles primero')

  const existing = await prisma.user.findFirst({
    where: { OR: [{ username: ADMIN_USERNAME }, { email: ADMIN_EMAIL }] },
    select: { id: true, username: true },
  })
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        isActive: true,
        isApproved: true,
        approvedAt: new Date(),
        roleId: adminRole.id,
      },
    })
    console.log(`[seed:bootstrap] Admin ya existe (${existing.username}); estado verificado`)
    return existing
  }

  const now = new Date()
  const user = await prisma.user.create({
    data: {
      username: ADMIN_USERNAME,
      email: ADMIN_EMAIL,
      firstName: 'Admin',
      lastName: 'Principal',
      name: 'Admin Principal',
      phone: '+59899000001',
      nationalId: buildValidCi(1_234_567),
      birthdate: new Date('1986-02-14T00:00:00.000Z'),
      roleId: adminRole.id,
      emailVerifiedAt: now,
      isApproved: true,
      approvedAt: now,
      isActive: true,
      failedLoginAttempts: 0,
      lockUntil: null,
    },
  })
  try {
    const { createKeycloakUser } = await import('../src/auth/keycloak.js')
    await createKeycloakUser({
      email: ADMIN_EMAIL,
      username: ADMIN_USERNAME,
      firstName: 'Admin',
      lastName: 'Principal',
      password: ADMIN_PASSWORD,
      role: 'ADMIN',
      emailVerified: true,
    })
  } catch (e) {
    console.warn('[seed:bootstrap] Keycloak admin (opcional):', e)
  }
  console.log(`[seed:bootstrap] Admin creado: ${user.username} (login vía Keycloak; password seed: ${ADMIN_PASSWORD})`)
  return user
}

export async function runBootstrap() {
  await ensureBuiltinOrgRoles()
  await upsertCanonicalProfilePermissions(prisma)
  await ensureSystemSettings()
  await ensureBootstrapAdmin()
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL no está definida')
  await runBootstrap()
}

const isDirectRun = (process.argv[1] ?? '').includes('seed-bootstrap')
if (isDirectRun) {
  main()
    .catch((e) => {
      console.error(e)
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
