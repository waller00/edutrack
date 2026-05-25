import argon2 from 'argon2'
import { randomBytes } from 'crypto'
import { prisma } from '../db/prisma.js'
import { ensureBuiltinOrgRoles } from '../identity/org-role-seed.js'
import { upsertCanonicalProfilePermissions } from '../identity/profile-permissions-repository.js'
import { processBiometricIngest } from './biometric-ingest-core.js'

export function isAdminTestingToolsEnabled() {
  const flag = String(process.env.ALLOW_ADMIN_TESTING_TOOLS ?? '').trim().toLowerCase()
  if (flag === '1' || flag === 'true' || flag === 'yes') return true
  if (flag === '0' || flag === 'false' || flag === 'no') return false
  return process.env.NODE_ENV !== 'production'
}

function buildValidCi(baseNumber: number) {
  const base7 = String(Math.abs(baseNumber) % 9_999_999).padStart(7, '0')
  const weights = [2, 9, 8, 7, 6, 3, 4]
  const sum = base7.split('').reduce((acc, digit, index) => acc + Number(digit) * weights[index], 0)
  const checkDigit = (10 - (sum % 10)) % 10
  return `${base7}${checkDigit}`
}

/** Borra eventos, asistencias, biométrico, académico operativo, etc. Conserva usuarios, roles y permisos. */
export async function wipeOperationalTestingData() {
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
  await prisma.livenessSession.deleteMany()
  await prisma.auditLog.deleteMany()
  await prisma.inAppNotification.deleteMany()
}

/** Igual que `seed:clean`: un solo admin y ciclo vacío. */
export async function resetDatabaseToSingleAdmin(opts?: {
  adminUsername?: string
  adminPassword?: string
  adminEmail?: string
}) {
  const adminUsername = (opts?.adminUsername || process.env.CLEAN_ADMIN_USERNAME || 'admin').toLowerCase()
  const adminPassword = opts?.adminPassword || process.env.CLEAN_ADMIN_PASSWORD || `tmp-${randomBytes(12).toString('base64url')}`
  const adminEmail = opts?.adminEmail || process.env.CLEAN_ADMIN_EMAIL || 'admin@edutrack.local'

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

  await ensureBuiltinOrgRoles()
  await upsertCanonicalProfilePermissions(prisma)

  await prisma.systemSettings.upsert({
    where: { id: 'default' },
    create: { id: 'default' },
    update: {},
  })

  const code = new Date().getUTCFullYear()
  const year = await prisma.schoolYear.upsert({
    where: { code },
    create: { code, label: `Ciclo lectivo ${code}`, status: 'ACTIVE' },
    update: { status: 'ACTIVE', label: `Ciclo lectivo ${code}` },
  })
  await prisma.schoolYear.updateMany({
    where: { NOT: { id: year.id }, status: 'ACTIVE' },
    data: { status: 'CLOSED' },
  })

  const adminRole = await prisma.orgRole.findUnique({ where: { code: 'ADMIN' } })
  if (!adminRole) throw new Error('Falta OrgRole ADMIN')

  const passwordHash = await argon2.hash(adminPassword, { type: argon2.argon2id })
  const now = new Date()
  const admin = await prisma.user.create({
    data: {
      username: adminUsername,
      email: adminEmail,
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

  return { admin, schoolYear: year, password: adminPassword }
}

function testDeviceUserIdForUser(userId: string) {
  const compact = userId.replace(/-/g, '').slice(0, 8)
  return `T${compact}`.slice(0, 20)
}

export async function ensureBiometricMappingForTesting(userId: string, deviceId: string) {
  const existing = await prisma.biometricUserMapping.findFirst({
    where: { deviceId, userId, isActive: true },
    select: { id: true, deviceUserId: true },
  })
  if (existing) return existing

  const deviceUserId = testDeviceUserIdForUser(userId)
  return prisma.biometricUserMapping.create({
    data: {
      deviceId,
      userId,
      deviceUserId,
      isActive: true,
    },
    select: { id: true, deviceUserId: true },
  })
}

export async function simulateAdmsPunchForUser(params: {
  userId: string
  deviceId: string
  punchType: 'CHECK_IN' | 'CHECK_OUT'
  occurredAt?: Date
}) {
  const device = await prisma.biometricDevice.findFirst({
    where: { id: params.deviceId, isActive: true },
    select: { id: true, code: true },
  })
  if (!device) {
    throw new Error('DEVICE_NOT_FOUND')
  }

  const user = await prisma.user.findFirst({
    where: { id: params.userId, isActive: true, isApproved: true },
    select: { id: true },
  })
  if (!user) {
    throw new Error('USER_NOT_FOUND')
  }

  const mapping = await ensureBiometricMappingForTesting(params.userId, device.id)
  const occurredAt = params.occurredAt ?? new Date()
  const externalId = `admin-test-${device.code}-${mapping.deviceUserId}-${occurredAt.getTime()}`

  const result = await processBiometricIngest({
    deviceDbId: device.id,
    deviceCode: device.code,
    deviceUserId: mapping.deviceUserId,
    occurredAt,
    externalId,
    punchType: params.punchType,
    payload: {
      source: 'admin-testing-panel',
      punchType: params.punchType,
      userId: params.userId,
    },
  })

  return { result, device, mapping, occurredAt }
}

export async function getAdminTestingContext() {
  const [devices, users] = await Promise.all([
    prisma.biometricDevice.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        admsSerial: true,
      },
    }),
    prisma.user.findMany({
      where: { isActive: true, isApproved: true },
      orderBy: [{ orgRole: { sortOrder: 'asc' } }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        email: true,
        username: true,
        orgRole: { select: { code: true } },
        biometricMappings: {
          where: { isActive: true },
          select: {
            id: true,
            deviceUserId: true,
            deviceId: true,
            device: { select: { code: true, name: true } },
          },
        },
      },
    }),
  ])

  return {
    enabled: isAdminTestingToolsEnabled(),
    devices,
    users: users.map((u) => ({
      id: u.id,
      label: u.name || u.username || u.email,
      email: u.email,
      username: u.username,
      role: u.orgRole.code,
      mappings: u.biometricMappings,
    })),
  }
}
