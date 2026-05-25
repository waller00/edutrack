/**
 * Carga idempotente del catálogo académico DGES + oferta por ciclo lectivo.
 *
 *   npx tsx prisma/seed-academic-catalog.ts
 *   SEED_SCHOOL_YEAR=2026 npx tsx prisma/seed-academic-catalog.ts
 */
import 'dotenv/config'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '../src/db/prisma.js'
import {
  BOOTSTRAP_SCHOOL_YEARS,
  CATALOG_COURSES,
  CATALOG_ORIENTATIONS,
  COURSE_PLANS,
  SCHOOL_YEAR_OFFERS,
  collectAllSubjectNames,
  type CoursePlan,
} from './data/academic-catalog-dges.js'

type Db = PrismaClient & {
  courseOrientation: {
    upsert: (args: unknown) => Promise<{ id: string }>
  }
  subjectCourseAssignment: {
    upsert: (args: unknown) => Promise<{ id: string }>
    findFirst: (args: unknown) => Promise<{ id: string } | null>
    create: (args: unknown) => Promise<{ id: string }>
    update: (args: unknown) => Promise<{ id: string }>
  }
}

const db = prisma as Db

async function upsertSchoolYears() {
  for (const sy of BOOTSTRAP_SCHOOL_YEARS) {
    await prisma.schoolYear.upsert({
      where: { code: sy.code },
      create: {
        code: sy.code,
        label: sy.label,
        status: sy.status,
        startsOn: new Date(`${sy.code}-03-01T12:00:00.000Z`),
        endsOn: new Date(`${sy.code}-12-15T12:00:00.000Z`),
      },
      update: { label: sy.label, status: sy.status },
    })
  }
  const active = BOOTSTRAP_SCHOOL_YEARS.find((y) => y.status === 'ACTIVE')
  if (active) {
    const row = await prisma.schoolYear.findUnique({ where: { code: active.code } })
    if (row) {
      await prisma.schoolYear.updateMany({
        where: { NOT: { id: row.id }, status: 'ACTIVE' },
        data: { status: 'CLOSED' },
      })
    }
  }
}

async function upsertCourses() {
  const byCode = new Map<string, string>()
  for (const c of CATALOG_COURSES) {
    const row = await prisma.course.upsert({
      where: { code: c.code },
      create: {
        code: c.code,
        name: c.name,
        level: c.level,
        sortOrder: c.sortOrder,
        isActive: true,
        description: `Catálogo DGES — ${c.name}`,
      },
      update: {
        name: c.name,
        level: c.level,
        sortOrder: c.sortOrder,
        isActive: true,
      },
    })
    byCode.set(c.code, row.id)
  }
  return byCode
}

async function upsertOrientations() {
  const byCode = new Map<string, string>()
  for (const o of CATALOG_ORIENTATIONS) {
    const row = await prisma.orientation.upsert({
      where: { code: o.code },
      create: {
        code: o.code,
        name: o.name,
        sortOrder: o.sortOrder,
        isActive: true,
      },
      update: { name: o.name, sortOrder: o.sortOrder, isActive: true },
    })
    byCode.set(o.code, row.id)
  }
  return byCode
}

async function upsertSubjects() {
  const names = collectAllSubjectNames()
  const byName = new Map<string, { id: string; code: string }>()
  let order = 0
  for (const [name, code] of [...names.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'))) {
    const existing = await prisma.subject.findFirst({
      where: { OR: [{ code }, { name }] },
      select: { id: true, code: true },
    })
    const row = existing
      ? await prisma.subject.update({
          where: { id: existing.id },
          data: { name, code, isActive: true, sortOrder: order },
          select: { id: true, code: true },
        })
      : await prisma.subject.create({
          data: { name, code, isActive: true, sortOrder: order },
          select: { id: true, code: true },
        })
    byName.set(name, { id: row.id, code: row.code ?? code })
    order += 1
  }
  return byName
}

async function linkCourseOrientations(
  courseId: string,
  courseCode: string,
  plan: CoursePlan,
  orientationIds: Map<string, string>,
  schoolYearId: string | null,
  orientationOffered?: Readonly<Record<string, boolean>>,
  courseOffered = true,
) {
  if (!plan.orientaciones) return
  for (const orientationCode of Object.keys(plan.orientaciones)) {
    const orientationId = orientationIds.get(orientationCode)
    if (!orientationId) continue
    const offered =
      courseOffered &&
      (orientationOffered?.[orientationCode] ?? (schoolYearId === null ? true : false))
    await db.courseOrientation.upsert({
      where: {
        courseId_orientationId_schoolYearId: {
          courseId,
          orientationId,
          schoolYearId,
        },
      },
      create: {
        courseId,
        orientationId,
        schoolYearId,
        isActive: offered,
        notes: schoolYearId ? `Oferta ciclo` : 'Catálogo',
      },
      update: { isActive: offered },
    })
  }
}

async function upsertAssignment(params: {
  subjectId: string
  courseId: string
  courseLevel: 'EBI' | 'EMS'
  associationType: 'CURSO_COMPLETO' | 'TRONCO_COMUN_CURSO' | 'ORIENTACION'
  orientationId?: string | null
  schoolYearId: string | null
  isActive: boolean
  sortOrder: number
  notes?: string
}) {
  const where = {
    subjectId: params.subjectId,
    courseId: params.courseId,
    orientationId: params.orientationId ?? null,
    schoolYearId: params.schoolYearId,
    associationType: params.associationType,
  }
  const existing = await db.subjectCourseAssignment.findFirst({
    where,
    select: { id: true },
  })
  if (existing) {
    await db.subjectCourseAssignment.update({
      where: { id: existing.id },
      data: { isActive: params.isActive, sortOrder: params.sortOrder, notes: params.notes ?? null },
    })
    return
  }
  await db.subjectCourseAssignment.create({
    data: {
      subjectId: params.subjectId,
      courseId: params.courseId,
      level: params.associationType === 'NIVEL_COMPLETO' ? params.courseLevel : null,
      orientationId: params.orientationId ?? null,
      schoolYearId: params.schoolYearId,
      associationType: params.associationType,
      isActive: params.isActive,
      sortOrder: params.sortOrder,
      notes: params.notes ?? null,
    },
  })
}

async function seedPlanForCourse(
  courseCode: string,
  courseId: string,
  courseLevel: 'EBI' | 'EMS',
  plan: CoursePlan,
  subjectIds: Map<string, { id: string }>,
  orientationIds: Map<string, string>,
  schoolYearId: string | null,
  courseOffered: boolean,
  orientationOffered?: Readonly<Record<string, boolean>>,
) {
  let sort = 0
  const activeForYear = schoolYearId === null ? true : courseOffered

  for (const name of plan.obligatorias ?? []) {
    const sub = subjectIds.get(name)
    if (!sub) continue
    await upsertAssignment({
      subjectId: sub.id,
      courseId,
      courseLevel,
      associationType: 'CURSO_COMPLETO',
      schoolYearId,
      isActive: activeForYear,
      sortOrder: sort++,
      notes: schoolYearId ? undefined : 'Catálogo obligatoria',
    })
  }

  for (const name of plan.troncoComun ?? []) {
    const sub = subjectIds.get(name)
    if (!sub) continue
    await upsertAssignment({
      subjectId: sub.id,
      courseId,
      courseLevel,
      associationType: 'TRONCO_COMUN_CURSO',
      schoolYearId,
      isActive: activeForYear,
      sortOrder: sort++,
      notes: schoolYearId ? undefined : 'Tronco común',
    })
  }

  if (plan.orientaciones) {
    for (const [orientationCode, subjects] of Object.entries(plan.orientaciones)) {
      const orientationId = orientationIds.get(orientationCode)
      if (!orientationId) continue
      const orientActive =
        schoolYearId === null
          ? true
          : courseOffered && (orientationOffered?.[orientationCode] ?? false)
      for (const name of subjects) {
        const sub = subjectIds.get(name)
        if (!sub) continue
        await upsertAssignment({
          subjectId: sub.id,
          courseId,
          courseLevel,
          associationType: 'ORIENTACION',
          orientationId,
          schoolYearId,
          isActive: orientActive,
          sortOrder: sort++,
        })
      }
    }
  }

  for (const name of plan.optativas ?? []) {
    const sub = subjectIds.get(name)
    if (!sub) continue
    await upsertAssignment({
      subjectId: sub.id,
      courseId,
      courseLevel,
      associationType: 'CURSO_COMPLETO',
      schoolYearId,
      isActive: activeForYear,
      sortOrder: sort++,
      notes: 'Optativa EAC',
    })
  }

  await linkCourseOrientations(
    courseId,
    courseCode,
    plan,
    orientationIds,
    schoolYearId,
    orientationOffered,
    courseOffered,
  )
}

async function seedCatalogAssignments(
  courseIds: Map<string, string>,
  subjectIds: Map<string, { id: string }>,
  orientationIds: Map<string, string>,
) {
  for (const course of CATALOG_COURSES) {
    const plan = COURSE_PLANS[course.code]
    if (!plan) continue
    const courseId = courseIds.get(course.code)!
    await seedPlanForCourse(
      course.code,
      courseId,
      course.level,
      plan,
      subjectIds,
      orientationIds,
      null,
      true,
    )
  }
}

async function seedYearOffer(
  yearCode: number,
  courseIds: Map<string, string>,
  subjectIds: Map<string, { id: string }>,
  orientationIds: Map<string, string>,
) {
  const offer = SCHOOL_YEAR_OFFERS[yearCode]
  if (!offer) return

  const schoolYear = await prisma.schoolYear.findUnique({ where: { code: yearCode } })
  if (!schoolYear) throw new Error(`Falta ciclo lectivo ${yearCode}`)

  for (const course of CATALOG_COURSES) {
    const courseId = courseIds.get(course.code)!
    const offered = offer.courses[course.code] ?? false
    await prisma.courseOffering.upsert({
      where: { courseId_schoolYearId: { courseId, schoolYearId: schoolYear.id } },
      create: {
        courseId,
        schoolYearId: schoolYear.id,
        isActive: offered,
        notes: offered ? 'Ofertado en el liceo' : 'En catálogo, no ofertado este ciclo',
      },
      update: {
        isActive: offered,
        notes: offered ? 'Ofertado en el liceo' : 'En catálogo, no ofertado este ciclo',
      },
    })

    const plan = COURSE_PLANS[course.code]
    if (!plan) continue
    const orientationOffered = offer.orientations?.[course.code]
    await seedPlanForCourse(
      course.code,
      courseId,
      course.level,
      plan,
      subjectIds,
      orientationIds,
      schoolYear.id,
      offered,
      orientationOffered,
    )
  }
}

export async function seedAcademicCatalog(opts?: { years?: number[] }) {
  const years = opts?.years ?? Object.keys(SCHOOL_YEAR_OFFERS).map(Number)

  console.log('[seed:academic] Ciclos lectivos…')
  await upsertSchoolYears()

  console.log('[seed:academic] Cursos, orientaciones y asignaturas (catálogo)…')
  const courseIds = await upsertCourses()
  const orientationIds = await upsertOrientations()
  const subjectIds = await upsertSubjects()

  console.log('[seed:academic] Plan de estudios (sin ciclo — referencia)…')
  await seedCatalogAssignments(courseIds, subjectIds, orientationIds)

  for (const yearCode of years) {
    console.log(`[seed:academic] Oferta ciclo ${yearCode}…`)
    await seedYearOffer(yearCode, courseIds, subjectIds, orientationIds)
  }

  const offered = SCHOOL_YEAR_OFFERS[2026]?.courses ?? {}
  const activeCourses = Object.entries(offered).filter(([, v]) => v).map(([k]) => k)
  console.log(
    `[seed:academic] OK — ${CATALOG_COURSES.length} cursos, ${subjectIds.size} asignaturas, ${CATALOG_ORIENTATIONS.length} orientaciones. Oferta 2026: ${activeCourses.join(', ')}`,
  )
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL no está definida')
  const extraYear = process.env.SEED_SCHOOL_YEAR
  const years = extraYear
    ? [...new Set([...Object.keys(SCHOOL_YEAR_OFFERS).map(Number), Number(extraYear)])]
    : undefined
  await seedAcademicCatalog({ years })
}

const isDirectRun = (process.argv[1] ?? '').includes('seed-academic-catalog')
if (isDirectRun) {
  main()
    .catch((e) => {
      console.error(e)
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
