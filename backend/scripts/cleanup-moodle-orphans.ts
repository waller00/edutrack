/**
 * Limpieza de datos HUÉRFANOS en Moodle creados por EduTrack.
 *
 * Pensado para el ciclo de demos: cuando se borra/reseedea la base de EduTrack, los UUIDs de
 * ciclos/ofertas/asignaturas cambian, pero los cursos y categorías que EduTrack ya había creado en
 * Moodle quedan colgados (idnumber con un UUID que ya no existe). Este script los detecta y borra.
 *
 * SEGURIDAD:
 *  - SOLO toca objetos cuyo `idnumber` empieza con `et-` (los que crea EduTrack). Nada manual.
 *  - Dentro de esos, SOLO borra los que referencian un id que ya NO existe en la base actual.
 *  - Patrones `et-*` desconocidos se reportan pero NO se borran (revisión manual).
 *  - Por defecto es DRY-RUN: lista qué borraría. Hay que pasar `--apply` para borrar de verdad.
 *
 * Uso:
 *   cd backend && npx tsx scripts/cleanup-moodle-orphans.ts            # dry-run (no borra nada)
 *   cd backend && npx tsx scripts/cleanup-moodle-orphans.ts --apply    # borra los huérfanos
 *
 * Requiere MOODLE_BASE_URL y MOODLE_WS_TOKEN en el entorno (igual que la sincronización).
 */
import { PrismaClient } from '@prisma/client'
import { isMoodleIntegrationEnabled, moodleRest } from '../src/integrations/moodle/client.js'

const prisma = new PrismaClient()

const APPLY = process.argv.includes('--apply')
const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'

const RE_OFFERING = new RegExp(`^et-offering-(${UUID})$`)
const RE_SUBJECT = new RegExp(
  `^et-subject-offering-(${UUID})-(${UUID})(?:-corientation-(${UUID}))?(?:-orientation-(${UUID}))?$`,
)
const RE_YEAR = new RegExp(`^et-year-(${UUID})$`)
const RE_STUDENT = new RegExp(`^et-student-(${UUID})$`)

// Esquemas de idnumber que el código actual ya NO genera: cualquier objeto con estos prefijos es
// de una versión vieja de la integración y, por definición, huérfano (no lo produce ningún dato vivo).
const LEGACY_COURSE_PREFIXES = ['et-subject-h-']

type MoodleCourse = { id: number; idnumber?: string; shortname?: string; fullname?: string }
type MoodleCategory = { id: number; idnumber?: string; name?: string }
type MoodleUser = {
  id: number
  idnumber?: string
  username?: string
  firstname?: string
  lastname?: string
  email?: string
}
type StudentMap = { id: string; localId: string; moodleId: number; idnumber: string }
type Verdict = { orphan: boolean; reason: string }

async function loadDbIds() {
  const [years, offerings, subjects, courseOrientations, orientations, students] = await Promise.all([
    prisma.schoolYear.findMany({ select: { id: true } }),
    prisma.courseOffering.findMany({ select: { id: true } }),
    prisma.subject.findMany({ select: { id: true } }),
    prisma.courseOrientation.findMany({ select: { id: true } }),
    prisma.orientation.findMany({ select: { id: true } }),
    prisma.student.findMany({ select: { id: true } }),
  ])
  return {
    years: new Set(years.map((r) => r.id)),
    offerings: new Set(offerings.map((r) => r.id)),
    subjects: new Set(subjects.map((r) => r.id)),
    courseOrientations: new Set(courseOrientations.map((r) => r.id)),
    orientations: new Set(orientations.map((r) => r.id)),
    students: new Set(students.map((r) => r.id)),
  }
}

type DbIds = Awaited<ReturnType<typeof loadDbIds>>

/** Decide si un curso `et-*` es huérfano según los ids vivos en la base actual. */
function classifyCourse(idnumber: string, db: DbIds): Verdict {
  const offering = RE_OFFERING.exec(idnumber)
  if (offering) {
    const id = offering[1]!
    return db.offerings.has(id)
      ? { orphan: false, reason: 'oferta vigente' }
      : { orphan: true, reason: `oferta inexistente (${id})` }
  }

  const subject = RE_SUBJECT.exec(idnumber)
  if (subject) {
    const [, offeringId, subjectId, corientationId, orientationId] = subject
    if (!db.offerings.has(offeringId!)) return { orphan: true, reason: `oferta inexistente (${offeringId})` }
    if (!db.subjects.has(subjectId!)) return { orphan: true, reason: `asignatura inexistente (${subjectId})` }
    if (corientationId && !db.courseOrientations.has(corientationId)) {
      return { orphan: true, reason: `orientación-curso inexistente (${corientationId})` }
    }
    if (orientationId && !db.orientations.has(orientationId)) {
      return { orphan: true, reason: `orientación inexistente (${orientationId})` }
    }
    return { orphan: false, reason: 'curso por asignatura vigente' }
  }

  if (LEGACY_COURSE_PREFIXES.some((p) => idnumber.startsWith(p))) {
    return { orphan: true, reason: 'esquema viejo de idnumber (legacy, ya no se usa)' }
  }

  return { orphan: false, reason: 'patrón et- desconocido (no se toca)' }
}

function classifyCategory(idnumber: string, db: DbIds): Verdict {
  const year = RE_YEAR.exec(idnumber)
  if (year) {
    const id = year[1]!
    return db.years.has(id)
      ? { orphan: false, reason: 'ciclo lectivo vigente' }
      : { orphan: true, reason: `ciclo lectivo inexistente (${id})` }
  }
  return { orphan: false, reason: 'patrón et- desconocido (no se toca)' }
}

function classifyStudent(idnumber: string, db: DbIds): Verdict {
  const student = RE_STUDENT.exec(idnumber)
  if (student) {
    const id = student[1]!
    return db.students.has(id)
      ? { orphan: false, reason: 'estudiante vigente' }
      : { orphan: true, reason: `estudiante inexistente (${id})` }
  }
  return { orphan: false, reason: 'patrón et- desconocido (no se toca)' }
}

async function fetchMoodleCourses(): Promise<MoodleCourse[]> {
  // get_courses_by_field sin `field` devuelve todos los cursos. Se usa esta (y no core_course_get_courses)
  // porque es la que el servicio web de EduTrack tiene habilitada.
  const res = await moodleRest('core_course_get_courses_by_field', {})
  const obj = res as { courses?: MoodleCourse[] }
  return Array.isArray(obj?.courses) ? obj.courses : []
}

async function fetchMoodleCategories(): Promise<MoodleCategory[]> {
  const res = await moodleRest('core_course_get_categories', {})
  return Array.isArray(res) ? (res as MoodleCategory[]) : []
}

async function fetchMoodleUsersByIdnumbers(idnumbers: string[]): Promise<Map<string, MoodleUser>> {
  const users = new Map<string, MoodleUser>()
  for (let i = 0; i < idnumbers.length; i += 100) {
    const batch = idnumbers.slice(i, i + 100)
    const params: Record<string, string> = { field: 'idnumber' }
    batch.forEach((idnumber, idx) => {
      params[`values[${idx}]`] = idnumber
    })
    const res = await moodleRest('core_user_get_users_by_field', params)
    if (!Array.isArray(res)) continue
    for (const user of res as MoodleUser[]) {
      if (user.idnumber) users.set(user.idnumber, user)
    }
  }
  return users
}

async function fetchStudentMaps(): Promise<StudentMap[]> {
  return prisma.moodleObjectMap.findMany({
    where: { objectType: 'STUDENT' },
    select: { id: true, localId: true, moodleId: true, idnumber: true },
  })
}

function isEtIdnumber(idnumber?: string): idnumber is string {
  return typeof idnumber === 'string' && idnumber.startsWith('et-')
}

type DeleteOutcome = { ok: number; failed: number }

/**
 * Borra de a UN curso por llamada: `core_course_delete_courses` con muchos ids supera el timeout
 * de 20s del cliente Moodle (borrar cursos es pesado). Un fallo puntual (p. ej. timeout de un curso
 * lento) se registra y se sigue: re-ejecutar el script termina los que queden (es idempotente).
 */
async function deleteCourses(ids: number[]): Promise<DeleteOutcome> {
  let ok = 0
  let failed = 0
  for (let i = 0; i < ids.length; i++) {
    try {
      await moodleRest('core_course_delete_courses', { 'courseids[0]': String(ids[i]) })
      ok++
    } catch (e) {
      failed++
      console.warn(`  ⚠️  no se pudo borrar curso ${ids[i]}: ${e instanceof Error ? e.message : e}`)
    }
    if ((i + 1) % 25 === 0) console.log(`  …${i + 1}/${ids.length} cursos procesados`)
  }
  return { ok, failed }
}

async function deleteCategories(ids: number[]): Promise<DeleteOutcome> {
  let ok = 0
  let failed = 0
  // recursive=1: borra lo que cuelgue de la categoría huérfana (todo es del ciclo viejo).
  for (const id of ids) {
    try {
      await moodleRest('core_course_delete_categories', {
        'categories[0][id]': String(id),
        'categories[0][recursive]': '1',
      })
      ok++
    } catch (e) {
      failed++
      console.warn(`  ⚠️  no se pudo borrar categoría ${id}: ${e instanceof Error ? e.message : e}`)
    }
  }
  return { ok, failed }
}

async function deleteUsers(ids: number[]): Promise<DeleteOutcome & { okIds: number[]; failedIds: number[] }> {
  let ok = 0
  let failed = 0
  const okIds: number[] = []
  const failedIds: number[] = []
  for (const id of ids) {
    try {
      await moodleRest('core_user_delete_users', { 'userids[0]': String(id) })
      ok++
      okIds.push(id)
    } catch (e) {
      failed++
      failedIds.push(id)
      console.warn(`  ⚠️  no se pudo borrar usuario Moodle ${id}: ${e instanceof Error ? e.message : e}`)
    }
  }
  return { ok, failed, okIds, failedIds }
}

async function pruneStudentLocalMaps(mapIds: string[], studentIds: string[]) {
  if (!mapIds.length && !studentIds.length) return { objectMaps: 0, enrolmentMaps: 0 }
  const [objectMaps, enrolmentMaps] = await Promise.all([
    mapIds.length
      ? prisma.moodleObjectMap.deleteMany({ where: { id: { in: mapIds } } })
      : Promise.resolve({ count: 0 }),
    studentIds.length
      ? prisma.moodleEnrolmentMap.deleteMany({
          where: { sourceType: 'STUDENT_ENROLLMENT', userId: { in: studentIds } },
        })
      : Promise.resolve({ count: 0 }),
  ])
  return { objectMaps: objectMaps.count, enrolmentMaps: enrolmentMaps.count }
}

async function main() {
  if (!isMoodleIntegrationEnabled()) {
    console.error('❌ Moodle no está configurado (faltan MOODLE_BASE_URL / MOODLE_WS_TOKEN). Aborto.')
    process.exitCode = 1
    return
  }

  console.log(`\n🧹 Limpieza de huérfanos Moodle — modo: ${APPLY ? 'APPLY (borra)' : 'DRY-RUN (no borra)'}\n`)

  const db = await loadDbIds()
  const [courses, categories, studentMaps] = await Promise.all([
    fetchMoodleCourses(),
    fetchMoodleCategories(),
    fetchStudentMaps(),
  ])
  const studentUsersByIdnumber = await fetchMoodleUsersByIdnumbers(
    studentMaps.filter((m) => isEtIdnumber(m.idnumber)).map((m) => m.idnumber),
  )

  const etCourses = courses.filter((c) => isEtIdnumber(c.idnumber) && c.id > 1)
  const etCategories = categories.filter((c) => isEtIdnumber(c.idnumber) && c.id > 1)
  const etStudentMaps = studentMaps.filter((m) => isEtIdnumber(m.idnumber))

  const orphanCourses = etCourses
    .map((c) => ({ c, v: classifyCourse(c.idnumber!, db) }))
    .filter((x) => x.v.orphan)
  const orphanCategories = etCategories
    .map((c) => ({ c, v: classifyCategory(c.idnumber!, db) }))
    .filter((x) => x.v.orphan)
  const orphanStudents = etStudentMaps
    .map((m) => ({ m, u: studentUsersByIdnumber.get(m.idnumber), v: classifyStudent(m.idnumber, db) }))
    .filter((x) => x.v.orphan)

  const unknownCourses = etCourses.filter((c) => classifyCourse(c.idnumber!, db).reason.includes('desconocido'))
  const unknownCategories = etCategories.filter((c) => classifyCategory(c.idnumber!, db).reason.includes('desconocido'))
  const unknownStudents = etStudentMaps.filter((m) => classifyStudent(m.idnumber, db).reason.includes('desconocido'))

  console.log(`Cursos EduTrack en Moodle: ${etCourses.length} | huérfanos: ${orphanCourses.length}`)
  for (const { c, v } of orphanCourses) {
    console.log(`  - [curso ${c.id}] ${c.shortname ?? c.idnumber} — ${v.reason}`)
  }
  console.log(`\nCategorías EduTrack en Moodle: ${etCategories.length} | huérfanas: ${orphanCategories.length}`)
  for (const { c, v } of orphanCategories) {
    console.log(`  - [categoría ${c.id}] ${c.name ?? c.idnumber} — ${v.reason}`)
  }
  console.log(`\nEstudiantes EduTrack mapeados en Moodle: ${etStudentMaps.length} | huérfanos: ${orphanStudents.length}`)
  for (const { m, u, v } of orphanStudents) {
    const name = u ? `${u.firstname ?? ''} ${u.lastname ?? ''}`.trim() || u.username || m.idnumber : 'usuario remoto no encontrado'
    const moodleId = u?.id ?? m.moodleId
    console.log(`  - [usuario ${moodleId}] ${name} — ${v.reason}`)
  }

  if (unknownCourses.length || unknownCategories.length || unknownStudents.length) {
    console.log(
      `\n⚠️  Patrones et- no reconocidos (NO se tocan): ${unknownCourses.length} cursos, ${unknownCategories.length} categorías, ${unknownStudents.length} estudiantes`,
    )
  }

  if (!APPLY) {
    console.log('\nℹ️  DRY-RUN: no se borró nada. Re-ejecutá con --apply para borrar los huérfanos listados.\n')
    return
  }

  let coursesOutcome: DeleteOutcome = { ok: 0, failed: 0 }
  let categoriesOutcome: DeleteOutcome = { ok: 0, failed: 0 }
  let studentsOutcome: DeleteOutcome & { okIds: number[]; failedIds: number[] } = { ok: 0, failed: 0, okIds: [], failedIds: [] }
  let studentMapsOutcome = { objectMaps: 0, enrolmentMaps: 0 }
  if (orphanCourses.length) {
    console.log(`\n🗑️  Borrando ${orphanCourses.length} cursos (de a uno)…`)
    coursesOutcome = await deleteCourses(orphanCourses.map((x) => x.c.id))
  }
  if (orphanCategories.length) {
    console.log(`🗑️  Borrando ${orphanCategories.length} categorías (recursivo)…`)
    categoriesOutcome = await deleteCategories(orphanCategories.map((x) => x.c.id))
  }
  if (orphanStudents.length) {
    const studentDeleteTargets = Array.from(new Set(orphanStudents.map((x) => x.u?.id ?? x.m.moodleId)))
    console.log(`🗑️  Borrando ${studentDeleteTargets.length} usuarios Moodle de estudiantes…`)
    studentsOutcome = await deleteUsers(studentDeleteTargets)

    const deletedRemoteIds = new Set(studentsOutcome.okIds)
    const failedRemoteIds = new Set(studentsOutcome.failedIds)
    const prunable = orphanStudents.filter((x) => {
      const targetId = x.u?.id ?? x.m.moodleId
      return !failedRemoteIds.has(targetId) && (!x.u || deletedRemoteIds.has(targetId))
    })
    studentMapsOutcome = await pruneStudentLocalMaps(
      prunable.map((x) => x.m.id),
      prunable.map((x) => x.m.localId),
    )
  }
  console.log(
    `\n✅ Cursos borrados: ${coursesOutcome.ok} (fallidos: ${coursesOutcome.failed}) | ` +
      `Categorías borradas: ${categoriesOutcome.ok} (fallidas: ${categoriesOutcome.failed}) | ` +
      `Estudiantes Moodle borrados: ${studentsOutcome.ok} (fallidos: ${studentsOutcome.failed})`,
  )
  if (studentMapsOutcome.objectMaps || studentMapsOutcome.enrolmentMaps) {
    console.log(
      `🧽 Mapas locales de estudiantes limpiados: ${studentMapsOutcome.objectMaps} objetos, ${studentMapsOutcome.enrolmentMaps} inscripciones`,
    )
  }
  if (coursesOutcome.failed || categoriesOutcome.failed || studentsOutcome.failed) {
    console.log('ℹ️  Quedaron fallidos (probable timeout puntual). Volvé a correr --apply para terminarlos.\n')
  } else {
    console.log('🎉 Limpieza completa.\n')
  }
}

try {
  await main()
} catch (e) {
  console.error('❌ Error en la limpieza:', e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
