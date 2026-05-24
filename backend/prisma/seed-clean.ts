/**
 * Desarrollo local sin `dist/` compilado. Docker y CI usan `seed-clean.mjs`.
 *
 *   npm run seed:clean   → node prisma/seed-clean.mjs (tsx si no hay dist)
 */
import 'dotenv/config'
import argon2 from 'argon2'
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

async function wipeOperationalData() {
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

async function ensureSystemSettings() {
  await prisma.systemSettings.upsert({
    where: { id: 'default' },
    create: { id: 'default' },
    update: {},
  })
}

async function ensureActiveSchoolYear() {
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

async function createAdminUser() {
  const adminRole = await prisma.orgRole.findUnique({ where: { code: 'ADMIN' } })
  if (!adminRole) throw new Error('Falta OrgRole ADMIN')

  const passwordHash = await argon2.hash(ADMIN_PASSWORD, { type: argon2.argon2id })
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

  return user
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL no está definida')
  }

  await wipeOperationalData()

  console.log('[seed:clean] Roles builtin…')
  await ensureBuiltinOrgRoles()

  console.log('[seed:clean] Matriz de permisos…')
  await upsertCanonicalProfilePermissions(prisma)

  console.log('[seed:clean] Configuración del sistema…')
  await ensureSystemSettings()

  console.log('[seed:clean] Ciclo lectivo activo (vacío)…')
  const year = await ensureActiveSchoolYear()

  console.log('[seed:clean] Usuario administrador…')
  const admin = await createAdminUser()

  console.log('')
  console.log('✅ Base limpia lista.')
  console.log(`   Usuario: ${admin.username}`)
  console.log(`   Email:   ${admin.email}`)
  console.log(`   Clave:   ${ADMIN_PASSWORD}`)
  console.log(`   Ciclo:   ${year.code} (${year.label})`)
  console.log('   Sin eventos, asistencias, cursos ni estudiantes.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
