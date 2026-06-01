/**
 * Seed limpio para producción: roles/permisos + admin + catálogo académico.
 * No carga docentes ni datos demo.
 *
 *   npm run seed:production:clean
 */
import 'dotenv/config'
import { prisma } from '../src/db/prisma.js'
import { ensureBuiltinOrgRoles } from '../src/identity/org-role-seed.js'
import { upsertCanonicalProfilePermissions } from '../src/identity/profile-permissions-repository.js'
import { seedAcademicCatalog } from './seed-academic-catalog.js'
import { ensureBootstrapAdmin } from './seed-bootstrap.js'

async function wipeProductionData() {
  console.log('[seed:production:clean] Borrando datos anteriores...')
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
  await prisma.emailVerification.deleteMany()
  await prisma.livenessSession.deleteMany()
  await prisma.auditLog.deleteMany()
  await prisma.inAppNotification.deleteMany()
  await (prisma as any).teacherProfile?.deleteMany?.()
  await prisma.user.deleteMany()
  await prisma.schoolYear.deleteMany()
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL no está definida')

  await wipeProductionData()

  console.log('[seed:production:clean] Roles, permisos y configuración...')
  await ensureBuiltinOrgRoles()
  await upsertCanonicalProfilePermissions(prisma)
  await prisma.systemSettings.upsert({
    where: { id: 'default' },
    create: { id: 'default' },
    update: {},
  })

  console.log('[seed:production:clean] Admin inicial...')
  await ensureBootstrapAdmin()

  console.log('[seed:production:clean] Catálogo académico DGES...')
  await seedAcademicCatalog()

  console.log('')
  console.log('✅ Seed limpio de producción completado.')
  console.log('   Admin: CLEAN_ADMIN_USERNAME / CLEAN_ADMIN_PASSWORD')
  console.log('   No se cargaron docentes demo.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
