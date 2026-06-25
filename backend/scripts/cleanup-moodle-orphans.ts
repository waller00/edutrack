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

type MoodleCourse = { id: number; idnumber?: string; shortname?: string; fullname?: string }
type MoodleCategory = { id: number; idnumber?: string; name?: string }
type Verdict = { orphan: boolean; reason: string }

async function loadDbIds() {
  const [years, offerings, subjects, courseOrientations, orientations] = await Promise.all([
    prisma.schoolYear.findMany({ select: { id: true } }),
    prisma.courseOffering.findMany({ select: { id: true } }),
    prisma.subject.findMany({ select: { id: true } }),
    prisma.courseOrientation.findMany({ select: { id: true } }),
    prisma.orientation.findMany({ select: { id: true } }),
  ])
  return {
    years: new Set(years.map((r) => r.id)),
    offerings: new Set(offerings.map((r) => r.id)),
    subjects: new Set(subjects.map((r) => r.id)),
    courseOrientations: new Set(courseOrientations.map((r) => r.id)),
    orientations: new Set(orientations.map((r) => r.id)),
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

async function fetchMoodleCourses(): Promise<MoodleCourse[]> {
  const res = await moodleRest('core_course_get_courses', {})
  return Array.isArray(res) ? (res as MoodleCourse[]) : []
}

async function fetchMoodleCategories(): Promise<MoodleCategory[]> {
  const res = await moodleRest('core_course_get_categories', {})
  return Array.isArray(res) ? (res as MoodleCategory[]) : []
}

function isEtIdnumber(idnumber?: string): idnumber is string {
  return typeof idnumber === 'string' && idnumber.startsWith('et-')
}

async function deleteCourses(ids: number[]) {
  for (let i = 0; i < ids.length; i += 25) {
    const batch = ids.slice(i, i + 25)
    const params: Record<string, string> = {}
    batch.forEach((id, idx) => {
      params[`courseids[${idx}]`] = String(id)
    })
    await moodleRest('core_course_delete_courses', params)
  }
}

async function deleteCategories(ids: number[]) {
  // recursive=1: borra lo que cuelgue de la categoría huérfana (todo es del ciclo viejo).
  for (const id of ids) {
    await moodleRest('core_course_delete_categories', {
      'categories[0][id]': String(id),
      'categories[0][recursive]': '1',
    })
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
  const [courses, categories] = await Promise.all([fetchMoodleCourses(), fetchMoodleCategories()])

  const etCourses = courses.filter((c) => isEtIdnumber(c.idnumber) && c.id > 1)
  const etCategories = categories.filter((c) => isEtIdnumber(c.idnumber) && c.id > 1)

  const orphanCourses = etCourses
    .map((c) => ({ c, v: classifyCourse(c.idnumber!, db) }))
    .filter((x) => x.v.orphan)
  const orphanCategories = etCategories
    .map((c) => ({ c, v: classifyCategory(c.idnumber!, db) }))
    .filter((x) => x.v.orphan)

  const unknownCourses = etCourses.filter((c) => classifyCourse(c.idnumber!, db).reason.includes('desconocido'))
  const unknownCategories = etCategories.filter((c) => classifyCategory(c.idnumber!, db).reason.includes('desconocido'))

  console.log(`Cursos EduTrack en Moodle: ${etCourses.length} | huérfanos: ${orphanCourses.length}`)
  for (const { c, v } of orphanCourses) {
    console.log(`  - [curso ${c.id}] ${c.shortname ?? c.idnumber} — ${v.reason}`)
  }
  console.log(`\nCategorías EduTrack en Moodle: ${etCategories.length} | huérfanas: ${orphanCategories.length}`)
  for (const { c, v } of orphanCategories) {
    console.log(`  - [categoría ${c.id}] ${c.name ?? c.idnumber} — ${v.reason}`)
  }

  if (unknownCourses.length || unknownCategories.length) {
    console.log(
      `\n⚠️  Patrones et- no reconocidos (NO se tocan): ${unknownCourses.length} cursos, ${unknownCategories.length} categorías`,
    )
  }

  if (!APPLY) {
    console.log('\nℹ️  DRY-RUN: no se borró nada. Re-ejecutá con --apply para borrar los huérfanos listados.\n')
    return
  }

  if (orphanCourses.length) {
    console.log(`\n🗑️  Borrando ${orphanCourses.length} cursos…`)
    await deleteCourses(orphanCourses.map((x) => x.c.id))
  }
  if (orphanCategories.length) {
    console.log(`🗑️  Borrando ${orphanCategories.length} categorías (recursivo)…`)
    await deleteCategories(orphanCategories.map((x) => x.c.id))
  }
  console.log('\n✅ Limpieza completa.\n')
}

main()
  .catch((e) => {
    console.error('❌ Error en la limpieza:', e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
