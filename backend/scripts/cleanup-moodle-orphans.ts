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
import {
  buildLiveSubjectCourseIdnumbers,
  classifyCategory,
  classifyCourse,
  classifyStudent,
  isEtIdnumber,
  type DbIds,
  type Verdict,
} from '../src/integrations/moodle/orphan-idnumbers.js'

const prisma = new PrismaClient()

const APPLY = process.argv.includes('--apply')

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

/**
 * Idnumbers de curso-por-asignatura que los datos vivos podrían generar. Necesario para clasificar
 * la forma compacta `et-sc-<hash>`, que no se puede revertir a los UUIDs que la originaron.
 */
async function loadLiveSubjectCourseIdnumbers(): Promise<Set<string>> {
  const [offerings, subjects, courseOrientations, orientations] = await Promise.all([
    prisma.courseOffering.findMany({ select: { id: true, schoolYearId: true } }),
    prisma.subject.findMany({ select: { id: true } }),
    prisma.courseOrientation.findMany({ select: { id: true } }),
    prisma.orientation.findMany({ select: { id: true } }),
  ])
  return buildLiveSubjectCourseIdnumbers({
    offerings,
    subjectIds: subjects.map((r) => r.id),
    courseOrientationIds: courseOrientations.map((r) => r.id),
    orientationIds: orientations.map((r) => r.id),
  })
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

type ObjectMapRow = { id: string; objectType: string; localId: string; moodleId: number; idnumber: string }

/**
 * Mapas locales (`MoodleObjectMap`) de categorías/cursos cuyo dato de EduTrack ya no existe.
 * Si no se purgan, `getMappedId` devuelve el id Moodle de un objeto ya borrado y el reconcile
 * intenta crear cursos dentro de categorías inexistentes → `dmlwriteexception` (los "avisos").
 */
async function findOrphanStructureMaps(db: DbIds, liveSubjectCourseIdnumbers: Set<string>): Promise<ObjectMapRow[]> {
  const maps = (await prisma.moodleObjectMap.findMany({
    where: { objectType: { in: ['CATEGORY', 'COURSE', 'SUBJECT_COURSE'] } },
    select: { id: true, objectType: true, localId: true, moodleId: true, idnumber: true },
  })) as ObjectMapRow[]
  return maps.filter((m) => {
    if (m.objectType === 'CATEGORY') return !db.years.has(m.localId)
    if (m.objectType === 'COURSE') return !db.offerings.has(m.localId)
    // SUBJECT_COURSE: el localId ES el idnumber canónico.
    return classifyCourse(m.localId, db, liveSubjectCourseIdnumbers).orphan
  })
}

async function pruneStructureMaps(orphans: ObjectMapRow[]) {
  if (!orphans.length) return { objectMaps: 0, enrolmentMaps: 0 }
  const courseMoodleIds = orphans
    .filter((m) => m.objectType === 'COURSE' || m.objectType === 'SUBJECT_COURSE')
    .map((m) => m.moodleId)
  const [enrolmentMaps, objectMaps] = await Promise.all([
    courseMoodleIds.length
      ? prisma.moodleEnrolmentMap.deleteMany({ where: { moodleCourseId: { in: courseMoodleIds } } })
      : Promise.resolve({ count: 0 }),
    prisma.moodleObjectMap.deleteMany({ where: { id: { in: orphans.map((m) => m.id) } } }),
  ])
  return { objectMaps: objectMaps.count, enrolmentMaps: enrolmentMaps.count }
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

type OrphanCourse = { c: MoodleCourse; v: Verdict }
type OrphanCategory = { c: MoodleCategory; v: Verdict }
type OrphanStudent = { m: StudentMap; u?: MoodleUser; v: Verdict }

function reportPlan(p: {
  etCourses: MoodleCourse[]
  etCategories: MoodleCategory[]
  etStudentMaps: StudentMap[]
  orphanCourses: OrphanCourse[]
  orphanCategories: OrphanCategory[]
  orphanStudents: OrphanStudent[]
  orphanStructureMaps: ObjectMapRow[]
  unknown: { courses: number; categories: number; students: number }
}) {
  console.log(`Cursos EduTrack en Moodle: ${p.etCourses.length} | huérfanos: ${p.orphanCourses.length}`)
  for (const { c, v } of p.orphanCourses) console.log(`  - [curso ${c.id}] ${c.shortname ?? c.idnumber} — ${v.reason}`)

  console.log(`\nCategorías EduTrack en Moodle: ${p.etCategories.length} | huérfanas: ${p.orphanCategories.length}`)
  for (const { c, v } of p.orphanCategories) console.log(`  - [categoría ${c.id}] ${c.name ?? c.idnumber} — ${v.reason}`)

  console.log(`\nEstudiantes EduTrack mapeados en Moodle: ${p.etStudentMaps.length} | huérfanos: ${p.orphanStudents.length}`)
  for (const { m, u, v } of p.orphanStudents) {
    const name = u ? `${u.firstname ?? ''} ${u.lastname ?? ''}`.trim() || u.username || m.idnumber : 'usuario remoto no encontrado'
    console.log(`  - [usuario ${u?.id ?? m.moodleId}] ${name} — ${v.reason}`)
  }

  console.log(`\nMapas locales huérfanos (cursos/categorías/subject-course): ${p.orphanStructureMaps.length}`)

  if (p.unknown.courses || p.unknown.categories || p.unknown.students) {
    console.log(
      `\n⚠️  Patrones et- no reconocidos (NO se tocan): ${p.unknown.courses} cursos, ${p.unknown.categories} categorías, ${p.unknown.students} estudiantes`,
    )
  }
}

async function applyDeletions(p: {
  orphanCourses: OrphanCourse[]
  orphanCategories: OrphanCategory[]
  orphanStudents: OrphanStudent[]
  orphanStructureMaps: ObjectMapRow[]
}) {
  let coursesOutcome: DeleteOutcome = { ok: 0, failed: 0 }
  let categoriesOutcome: DeleteOutcome = { ok: 0, failed: 0 }
  let studentsOutcome: DeleteOutcome & { okIds: number[]; failedIds: number[] } = { ok: 0, failed: 0, okIds: [], failedIds: [] }
  let studentMapsOutcome = { objectMaps: 0, enrolmentMaps: 0 }

  if (p.orphanCourses.length) {
    console.log(`\n🗑️  Borrando ${p.orphanCourses.length} cursos (de a uno)…`)
    coursesOutcome = await deleteCourses(p.orphanCourses.map((x) => x.c.id))
  }
  if (p.orphanCategories.length) {
    console.log(`🗑️  Borrando ${p.orphanCategories.length} categorías (recursivo)…`)
    categoriesOutcome = await deleteCategories(p.orphanCategories.map((x) => x.c.id))
  }
  if (p.orphanStudents.length) {
    const studentDeleteTargets = Array.from(new Set(p.orphanStudents.map((x) => x.u?.id ?? x.m.moodleId)))
    console.log(`🗑️  Borrando ${studentDeleteTargets.length} usuarios Moodle de estudiantes…`)
    studentsOutcome = await deleteUsers(studentDeleteTargets)

    const deletedRemoteIds = new Set(studentsOutcome.okIds)
    const failedRemoteIds = new Set(studentsOutcome.failedIds)
    const prunable = p.orphanStudents.filter((x) => {
      const targetId = x.u?.id ?? x.m.moodleId
      return !failedRemoteIds.has(targetId) && (!x.u || deletedRemoteIds.has(targetId))
    })
    studentMapsOutcome = await pruneStudentLocalMaps(prunable.map((x) => x.m.id), prunable.map((x) => x.m.localId))
  }

  let structureMapsOutcome = { objectMaps: 0, enrolmentMaps: 0 }
  if (p.orphanStructureMaps.length) {
    console.log(`🧽 Purgando ${p.orphanStructureMaps.length} mapas locales huérfanos de cursos/categorías…`)
    structureMapsOutcome = await pruneStructureMaps(p.orphanStructureMaps)
  }

  console.log(
    `\n✅ Cursos borrados: ${coursesOutcome.ok} (fallidos: ${coursesOutcome.failed}) | ` +
      `Categorías borradas: ${categoriesOutcome.ok} (fallidas: ${categoriesOutcome.failed}) | ` +
      `Estudiantes Moodle borrados: ${studentsOutcome.ok} (fallidos: ${studentsOutcome.failed})`,
  )
  if (studentMapsOutcome.objectMaps || studentMapsOutcome.enrolmentMaps) {
    console.log(`🧽 Mapas locales de estudiantes limpiados: ${studentMapsOutcome.objectMaps} objetos, ${studentMapsOutcome.enrolmentMaps} inscripciones`)
  }
  if (structureMapsOutcome.objectMaps || structureMapsOutcome.enrolmentMaps) {
    console.log(`🧽 Mapas locales de cursos/categorías purgados: ${structureMapsOutcome.objectMaps} objetos, ${structureMapsOutcome.enrolmentMaps} inscripciones`)
  }
  if (coursesOutcome.failed || categoriesOutcome.failed || studentsOutcome.failed) {
    console.log('ℹ️  Quedaron fallidos (probable timeout puntual). Volvé a correr --apply para terminarlos.\n')
  } else {
    console.log('🎉 Limpieza completa.\n')
  }
}

async function main() {
  if (!isMoodleIntegrationEnabled()) {
    console.error('❌ Moodle no está configurado (faltan MOODLE_BASE_URL / MOODLE_WS_TOKEN). Aborto.')
    process.exitCode = 1
    return
  }

  console.log(`\n🧹 Limpieza de huérfanos Moodle — modo: ${APPLY ? 'APPLY (borra)' : 'DRY-RUN (no borra)'}\n`)

  const db = await loadDbIds()
  const liveSubjectCourses = await loadLiveSubjectCourseIdnumbers()
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
  const orphanStructureMaps = await findOrphanStructureMaps(db, liveSubjectCourses)

  const orphanCourses = etCourses
    .map((c) => ({ c, v: classifyCourse(c.idnumber!, db, liveSubjectCourses) }))
    .filter((x) => x.v.orphan)
  const orphanCategories = etCategories
    .map((c) => ({ c, v: classifyCategory(c.idnumber!, db) }))
    .filter((x) => x.v.orphan)
  const orphanStudents = etStudentMaps
    .map((m) => ({ m, u: studentUsersByIdnumber.get(m.idnumber), v: classifyStudent(m.idnumber, db) }))
    .filter((x) => x.v.orphan)

  const unknownCourses = etCourses.filter((c) =>
    classifyCourse(c.idnumber!, db, liveSubjectCourses).reason.includes('desconocido'),
  )
  const unknownCategories = etCategories.filter((c) => classifyCategory(c.idnumber!, db).reason.includes('desconocido'))
  const unknownStudents = etStudentMaps.filter((m) => classifyStudent(m.idnumber, db).reason.includes('desconocido'))

  reportPlan({
    etCourses,
    etCategories,
    etStudentMaps,
    orphanCourses,
    orphanCategories,
    orphanStudents,
    orphanStructureMaps,
    unknown: { courses: unknownCourses.length, categories: unknownCategories.length, students: unknownStudents.length },
  })

  if (!APPLY) {
    console.log('\nℹ️  DRY-RUN: no se borró nada. Re-ejecutá con --apply para borrar los huérfanos listados.\n')
    return
  }

  await applyDeletions({ orphanCourses, orphanCategories, orphanStudents, orphanStructureMaps })
}

try {
  await main()
} catch (e) {
  console.error('❌ Error en la limpieza:', e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
