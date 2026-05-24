/**
 * Base limpia: roles + permisos + un admin (admin / admin123).
 * Sin eventos, asistencias, cursos, estudiantes ni otros datos operativos.
 *
 * Compatible con imagen Docker (solo `dist/` + `prisma/`). En desarrollo local sin
 * build previo delega en `tsx prisma/seed-clean.ts`.
 *
 *   cd backend
 *   npm run seed:clean
 *
 * En testing (contenedor auth):
 *   docker compose -f docker-compose.cloud.yml -f docker-compose.override.yml exec auth npm run seed:clean
 */
import 'dotenv/config'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import argon2 from 'argon2'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const distMarker = join(root, 'dist', 'db', 'prisma.js')

const ADMIN_USERNAME = (process.env.CLEAN_ADMIN_USERNAME || 'admin').toLowerCase()
const ADMIN_PASSWORD = process.env.CLEAN_ADMIN_PASSWORD || 'admin123'
const ADMIN_EMAIL = process.env.CLEAN_ADMIN_EMAIL || 'admin@edutrack.local'

function buildValidCi(baseNumber) {
  const base7 = String(Math.abs(baseNumber) % 9_999_999).padStart(7, '0')
  const weights = [2, 9, 8, 7, 6, 3, 4]
  const sum = base7.split('').reduce((acc, digit, index) => acc + Number(digit) * weights[index], 0)
  const checkDigit = (10 - (sum % 10)) % 10
  return `${base7}${checkDigit}`
}

async function wipeOperationalData(prisma) {
  console.log('[seed:clean] Borrando datos operativos…')
  await prisma.attendanceIncident.deleteMany()
  await prisma.biometricPunch.deleteMany()
  await prisma.attendance.deleteMany()
  await prisma.medicalLeave.deleteMany()
  await prisma.event.updateMany({ data: { parentEventId: null } })
  await prisma.event.deleteMany()
  await prisma.studentTuitionMonth.deleteMany()
  await prisma.studentTuitionYear.deleteMany()
  await prisma.studentEnrollment.deleteMany()
  await prisma.student.deleteMany()
  await prisma.subject.deleteMany()
  await prisma.courseOffering.deleteMany()
  await prisma.course.deleteMany()
  await prisma.nonWorkingDay.deleteMany()
  await prisma.biometricLinkRequest.deleteMany()
  await prisma.biometricUserMapping.deleteMany()
  await prisma.biometricDevice.deleteMany()
  await prisma.webPushSubscription.deleteMany()
  await prisma.refreshToken.deleteMany()
  await prisma.passwordReset.deleteMany()
  await prisma.emailVerification.deleteMany()
  await prisma.twoFactorBackupCode.deleteMany()
  await prisma.livenessSession.deleteMany()
  await prisma.auditLog.deleteMany()
  await prisma.inAppNotification.deleteMany()
  await prisma.user.deleteMany()
  await prisma.schoolYear.deleteMany()
}

async function ensureSystemSettings(prisma) {
  await prisma.systemSettings.upsert({
    where: { id: 'default' },
    create: { id: 'default' },
    update: {},
  })
}

async function ensureActiveSchoolYear(prisma) {
  const code = new Date().getUTCFullYear()
  const year = await prisma.schoolYear.upsert({
    where: { code },
    create: {
      code,
      label: `Ciclo lectivo ${code}`,
      status: 'ACTIVE',
    },
    update: { status: 'ACTIVE', label: `Ciclo lectivo ${code}` },
  })
  await prisma.schoolYear.updateMany({
    where: { NOT: { id: year.id }, status: 'ACTIVE' },
    data: { status: 'CLOSED' },
  })
  return year
}

async function createAdminUser(prisma) {
  const adminRole = await prisma.orgRole.findUnique({ where: { code: 'ADMIN' } })
  if (!adminRole) throw new Error('Falta OrgRole ADMIN')

  const passwordHash = await argon2.hash(ADMIN_PASSWORD, { type: argon2.argon2id })
  const now = new Date()

  return prisma.user.create({
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
      passwordHash,
      emailVerifiedAt: now,
      isApproved: true,
      approvedAt: now,
      isActive: true,
      failedLoginAttempts: 0,
      lockUntil: null,
      twoFactorEnabled: false,
    },
  })
}

async function runCleanSeed() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL no está definida')
  }

  const { prisma } = await import('../dist/db/prisma.js')
  const { ensureBuiltinOrgRoles } = await import('../dist/identity/org-role-seed.js')
  const { upsertCanonicalProfilePermissions } = await import('../dist/identity/profile-permissions-repository.js')

  try {
    await wipeOperationalData(prisma)

    console.log('[seed:clean] Roles builtin…')
    await ensureBuiltinOrgRoles()

    console.log('[seed:clean] Matriz de permisos…')
    await upsertCanonicalProfilePermissions(prisma)

    console.log('[seed:clean] Configuración del sistema…')
    await ensureSystemSettings(prisma)

    console.log('[seed:clean] Ciclo lectivo activo (vacío)…')
    const year = await ensureActiveSchoolYear(prisma)

    console.log('[seed:clean] Usuario administrador…')
    const admin = await createAdminUser(prisma)

    console.log('')
    console.log('✅ Base limpia lista.')
    console.log(`   Usuario: ${admin.username}`)
    console.log(`   Email:   ${admin.email}`)
    console.log(`   Clave:   ${ADMIN_PASSWORD}`)
    console.log(`   Ciclo:   ${year.code} (${year.label})`)
    console.log('   Sin eventos, asistencias, cursos ni estudiantes.')
  } finally {
    await prisma.$disconnect()
  }
}

function runLocalWithTsx() {
  const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const shell = process.platform === 'win32'
  const r = spawnSync(cmd, ['tsx', join(__dirname, 'seed-clean.ts')], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    shell,
  })
  process.exit(r.status ?? 1)
}

if (!existsSync(distMarker)) {
  runLocalWithTsx()
} else {
  runCleanSeed().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
