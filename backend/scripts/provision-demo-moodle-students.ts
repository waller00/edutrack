/**
 * Aprovisiona en Moodle las cuentas de los estudiantes del set de datos de demo.
 *
 * Pensado para el ciclo de demos: `npm run seed:demo` crea a los alumnos con `username` y email,
 * pero no los lleva a Moodle. Este script les crea la cuenta real (auth `manual`, idnumber
 * `et-student-<uuid>`), les fija una contraseña de demo conocida y los matricula en los cursos de
 * sus asignaturas.
 *
 * Correr DESPUÉS de `moodle:cleanup-orphans --apply`: la limpieza borra las cuentas Moodle de la
 * tanda anterior (mismos username/email, otros UUIDs) y libera esos datos para esta corrida.
 *
 * Es idempotente: si el alumno ya está mapeado o ya existe en Moodle por idnumber, se reusa.
 *
 * Uso:
 *   cd backend && npx tsx scripts/provision-demo-moodle-students.ts              # crea y matricula
 *   cd backend && npx tsx scripts/provision-demo-moodle-students.ts --dry-run    # solo lista
 *   cd backend && npx tsx scripts/provision-demo-moodle-students.ts --skip-enrol # sin matricular
 *
 * Requiere MOODLE_BASE_URL y MOODLE_WS_TOKEN en el entorno (igual que la sincronización).
 * La contraseña se puede cambiar con DEMO_MOODLE_STUDENT_PASSWORD.
 */
import 'dotenv/config'
import { prisma } from '../src/db/prisma.js'
import { isMoodleIntegrationEnabled } from '../src/integrations/moodle/client.js'
import {
  ensureStudentMoodleAccount,
  setStudentMoodlePassword,
} from '../src/integrations/moodle/student-users.js'
import { reconcileMoodle } from '../src/integrations/moodle/reconcile.js'

const DRY_RUN = process.argv.includes('--dry-run')
const SKIP_ENROL = process.argv.includes('--skip-enrol')

// Cumple la política por defecto de Moodle: 8+ caracteres, mayúscula, minúscula, dígito y símbolo.
const DEMO_PASSWORD = process.env.DEMO_MOODLE_STUDENT_PASSWORD || 'Estudiante123!'

type DemoStudent = {
  id: string
  firstName: string
  lastName: string
  email: string | null
  username: string | null
  moodleWelcomeSentAt: Date | null
}

/**
 * Alumnos con datos de cuenta completos. Sin `username` + `email`, `ensureStudentMoodleAccount`
 * crearía el espejo histórico `nologin` (no sirve para la demo: no se puede entrar con él).
 * Se incluyen los retirados/trasladados: es realista que hayan tenido cuenta.
 */
async function loadStudents(): Promise<DemoStudent[]> {
  return prisma.student.findMany({
    where: {
      username: { not: null },
      email: { not: null },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      username: true,
      moodleWelcomeSentAt: true,
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  })
}

async function loadMappedStudentIds(): Promise<Set<string>> {
  const rows = await prisma.moodleObjectMap.findMany({
    where: { objectType: 'STUDENT' },
    select: { localId: true },
  })
  return new Set(rows.map((r) => r.localId))
}

function reportPlan(students: DemoStudent[], mapped: Set<string>) {
  const nuevos = students.filter((s) => !mapped.has(s.id))
  console.log(`👥 Estudiantes con datos de cuenta completos: ${students.length}`)
  console.log(`   ya mapeados a Moodle: ${students.length - nuevos.length} | a crear: ${nuevos.length}`)
  for (const s of nuevos.slice(0, 10)) {
    console.log(`   + ${s.username} <${s.email}> — ${s.firstName} ${s.lastName}`)
  }
  if (nuevos.length > 10) console.log(`   … y ${nuevos.length - 10} más`)
}

/** Marca la bienvenida como enviada para que el outbox no mande mails a dominios de demo. */
async function markWelcomeSent(studentId: string): Promise<void> {
  await prisma.student.update({
    where: { id: studentId },
    data: { moodleWelcomeSentAt: new Date() },
  })
}

async function provisionAccounts(students: DemoStudent[]): Promise<{ creadas: number; reusadas: number; errores: number }> {
  const outcome = { creadas: 0, reusadas: 0, errores: 0 }
  const mappedBefore = await loadMappedStudentIds()

  let done = 0
  for (const s of students) {
    try {
      const { moodleId } = await ensureStudentMoodleAccount(s, { forceUpdate: true })
      await setStudentMoodlePassword(moodleId, DEMO_PASSWORD, { forceChange: false })
      if (!s.moodleWelcomeSentAt) await markWelcomeSent(s.id)
      if (mappedBefore.has(s.id)) outcome.reusadas += 1
      else outcome.creadas += 1
    } catch (e) {
      outcome.errores += 1
      console.error(`   ⚠️  ${s.username}: ${e instanceof Error ? e.message : e}`)
    }
    done += 1
    if (done % 10 === 0) console.log(`   … ${done}/${students.length}`)
  }
  return outcome
}

async function enrolStudents() {
  console.log('\n📚 Matriculando en los cursos de sus asignaturas (reconciliación completa)…')
  const summary = await reconcileMoodle({ syncStudents: true })
  console.log(
    `   cursos: ${summary.courses} | docentes: ${summary.teacherEnrolments} | ` +
      `suplentes: ${summary.substituteEnrolments} | estudiantes: ${summary.studentEnrolments} | ` +
      `errores: ${summary.errors}`,
  )
  return summary
}

async function main() {
  if (!isMoodleIntegrationEnabled()) {
    console.error('❌ Moodle no está configurado (faltan MOODLE_BASE_URL / MOODLE_WS_TOKEN). Aborto.')
    process.exitCode = 1
    return
  }

  console.log(`\n🎓 Cuentas Moodle de estudiantes de demo — modo: ${DRY_RUN ? 'DRY-RUN (no toca Moodle)' : 'APLICANDO'}\n`)

  const students = await loadStudents()
  if (!students.length) {
    console.log('ℹ️  No hay estudiantes con username + email. ¿Corriste `npm run seed:demo`?\n')
    return
  }

  reportPlan(students, await loadMappedStudentIds())

  if (DRY_RUN) {
    console.log('\nℹ️  DRY-RUN: no se creó ninguna cuenta. Re-ejecutá sin --dry-run para aplicar.\n')
    return
  }

  console.log('\n🔐 Creando cuentas y fijando la contraseña de demo…')
  const accounts = await provisionAccounts(students)
  console.log(
    `   cuentas creadas: ${accounts.creadas} | reusadas: ${accounts.reusadas} | con error: ${accounts.errores}`,
  )

  let enrolErrors = 0
  if (SKIP_ENROL) {
    console.log('\n⏭️  --skip-enrol: no se matricula a nadie.')
  } else {
    enrolErrors = (await enrolStudents()).errors
  }

  console.log(`\n✅ Listo. Credencial de ejemplo: ${students[0].username} / ${DEMO_PASSWORD}`)
  if (accounts.errores || enrolErrors) {
    console.log('ℹ️  Hubo errores (probable timeout puntual). Volvé a correr el script para terminarlos.\n')
  } else {
    console.log('🎉 Todos los estudiantes tienen cuenta y matrícula en Moodle.\n')
  }
}

try {
  await main()
} catch (e) {
  console.error('❌ Error aprovisionando estudiantes:', e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
