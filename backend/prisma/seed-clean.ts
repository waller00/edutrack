/**
 * Borra datos operativos y vuelve a cargar catálogo académico DGES + admin.
 *
 *   npm run seed:clean
 */
import 'dotenv/config'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prisma } from '../src/db/prisma.js'

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

async function wipeOperationalData() {
  console.log('[seed:clean] Borrando datos operativos…')
  await prisma.attendanceIncident.deleteMany()
  await prisma.biometricPunch.deleteMany()
  await prisma.attendance.deleteMany()
  await prisma.medicalLeave.deleteMany()
  await prisma.substitution.deleteMany()
  await prisma.event.updateMany({ data: { parentEventId: null } })
  await prisma.event.deleteMany()
  await prisma.studentTuitionMonth.deleteMany()
  await prisma.studentTuitionYear.deleteMany()
  await prisma.studentEnrollment.deleteMany()
  await prisma.student.deleteMany()
  await prisma.subjectCourseAssignment.deleteMany()
  await prisma.subject.deleteMany()
  await prisma.courseOrientation.deleteMany()
  await prisma.courseOffering.deleteMany()
  await prisma.orientation.deleteMany()
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
  await (prisma as any).teacherProfile?.deleteMany?.()
  await prisma.user.deleteMany()
  await prisma.schoolYear.deleteMany()
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL no está definida')

  await wipeOperationalData()
  await prisma.$disconnect()

  console.log('[seed:clean] Recargando seed principal (catálogo + admin)…')
  const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const r = spawnSync(cmd, ['tsx', 'prisma/seed.ts'], {
    cwd: backendRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  })
  if (r.status !== 0 && r.status != null) process.exit(r.status)
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
