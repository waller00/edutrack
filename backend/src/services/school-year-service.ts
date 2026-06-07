import type { PrismaClient, SchoolYear } from '@prisma/client'

export async function getActiveSchoolYear(prisma: PrismaClient): Promise<SchoolYear | null> {
  return prisma.schoolYear.findFirst({
    where: { status: 'ACTIVE' },
    orderBy: { code: 'desc' },
  })
}

export async function getActiveSchoolYearId(prisma: PrismaClient): Promise<string | null> {
  const y = await getActiveSchoolYear(prisma)
  return y?.id ?? null
}

/** Mantiene compatibilidad con el arranque histórico sin crear ni reactivar ciclos. */
export async function ensureDefaultSchoolYear(prisma: PrismaClient): Promise<void> {
  await getActiveSchoolYear(prisma)
}

export const ensureDefaultSchoolYearAndBackfill = ensureDefaultSchoolYear

export function assertValidSchoolYearDates(startsOn?: Date | null, endsOn?: Date | null): void {
  if (startsOn && Number.isNaN(startsOn.getTime())) throw new Error('INVALID_SCHOOL_YEAR_DATE')
  if (endsOn && Number.isNaN(endsOn.getTime())) throw new Error('INVALID_SCHOOL_YEAR_DATE')
  if (startsOn && endsOn && startsOn.getTime() > endsOn.getTime()) {
    throw new Error('SCHOOL_YEAR_DATES_OUT_OF_ORDER')
  }
}

export async function assertCanCreateSchoolYear(prisma: PrismaClient): Promise<void> {
  const active = await prisma.schoolYear.findFirst({ where: { status: 'ACTIVE' }, select: { id: true } })
  if (active) throw new Error('ACTIVE_SCHOOL_YEAR_EXISTS')
}

/** ADMIN/STAFF puede elegir año por query. Otros roles: siempre el año activo. */
export async function resolveSchoolYearIdForList(
  prisma: PrismaClient,
  opts: { role?: string; requestedSchoolYearId?: string | undefined },
): Promise<string | null> {
  const { role, requestedSchoolYearId } = opts
  const privileged = role === 'ADMIN' || role === 'STAFF'
  if (privileged && requestedSchoolYearId) {
    const found = await prisma.schoolYear.findUnique({
      where: { id: requestedSchoolYearId },
      select: { id: true },
    })
    if (found) return found.id
  }
  return getActiveSchoolYearId(prisma)
}

/**
 * ¿La fecha civil (YYYY-MM-DD, hora Uruguay) cae dentro del rango del ciclo lectivo?
 * `startsOn`/`endsOn` se guardan como medianoche UTC de la fecha civil, por lo que la
 * comparación lexicográfica de YMD es correcta y evita problemas de zona horaria.
 * Si el ciclo no tiene límites definidos, no se restringe.
 */
export function isYmdWithinSchoolYear(
  year: { startsOn: Date | null; endsOn: Date | null },
  ymd: string,
): boolean {
  if (year.startsOn && ymd < year.startsOn.toISOString().slice(0, 10)) return false
  if (year.endsOn && ymd > year.endsOn.toISOString().slice(0, 10)) return false
  return true
}

export async function activateSchoolYearById(prisma: PrismaClient, id: string): Promise<SchoolYear> {
  return prisma.$transaction(async (tx) => {
    const otherActive = await tx.schoolYear.findFirst({
      where: { status: 'ACTIVE', NOT: { id } },
      select: { id: true },
    })
    if (otherActive) throw new Error('ACTIVE_SCHOOL_YEAR_EXISTS')
    return tx.schoolYear.update({
      where: { id },
      data: { status: 'ACTIVE' },
    })
  })
}

export async function copyCoursesBetweenSchoolYears(
  prisma: PrismaClient,
  targetSchoolYearId: string,
  sourceSchoolYearId: string,
): Promise<{ created: number; subjectsCreated: number }> {
  const db = prisma as any
  if (targetSchoolYearId === sourceSchoolYearId) {
    throw new Error('SAME_SCHOOL_YEAR')
  }
  const [target, source] = await Promise.all([
    prisma.schoolYear.findUnique({ where: { id: targetSchoolYearId } }),
    prisma.schoolYear.findUnique({ where: { id: sourceSchoolYearId } }),
  ])
  if (!target || !source) throw new Error('SCHOOL_YEAR_NOT_FOUND')

  const existing = await db.courseOffering.count({ where: { schoolYearId: targetSchoolYearId } })
  if (existing > 0) throw new Error('TARGET_YEAR_HAS_COURSES')

  const sourceOfferings = await db.courseOffering.findMany({
    where: { schoolYearId: sourceSchoolYearId },
    include: { course: true },
  })
  let created = 0
  let subjectsCreated = 0
  await prisma.$transaction(async (tx) => {
    for (const offering of sourceOfferings) {
      const targetOffering = await (tx as any).courseOffering.create({
        data: {
          courseId: offering.courseId,
          schoolYearId: targetSchoolYearId,
          isActive: offering.isActive,
          notes: `Oferta replicada desde ciclo ${source.code}`,
        },
        select: { id: true },
      })
      created += 1
      const versionedSubjects = await (tx as any).subject.findMany({
        where: { courseId: offering.courseId, courseOfferingId: offering.id },
        select: { name: true, code: true, description: true, sortOrder: true, isActive: true },
      })
      if (versionedSubjects.length) {
        await (tx as any).subject.createMany({
          data: versionedSubjects.map((subject: any) => ({
            ...subject,
            courseId: offering.courseId,
            courseOfferingId: targetOffering.id,
          })),
        })
        subjectsCreated += versionedSubjects.length
      }
      const assignments = await (tx as any).subjectCourseAssignment?.findMany?.({
        where: { courseId: offering.courseId, schoolYearId: sourceSchoolYearId },
        select: {
          subjectId: true,
          level: true,
          courseId: true,
          orientationId: true,
          associationType: true,
          isActive: true,
          sortOrder: true,
          notes: true,
        },
      })
      if (assignments?.length) {
        await (tx as any).subjectCourseAssignment.createMany({
          data: assignments.map((assignment: any) => ({
            ...assignment,
            schoolYearId: targetSchoolYearId,
          })),
        })
      }
    }
  })
  return { created, subjectsCreated }
}

export async function ensureCourseOffering(
  prisma: PrismaClient,
  courseId: string,
  schoolYearId: string,
): Promise<{ id: string; courseId: string; schoolYearId: string; isActive: boolean }> {
  const db = prisma as any
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, isActive: true },
  })
  if (!course) throw new Error('COURSE_NOT_FOUND')
  return db.courseOffering.upsert({
    where: { courseId_schoolYearId: { courseId, schoolYearId } },
    update: {},
    create: { courseId, schoolYearId, isActive: course.isActive },
    select: { id: true, courseId: true, schoolYearId: true, isActive: true },
  })
}

/**
 * Oferta vigente y visible de un curso en un ciclo: exige `isActive`, `isOffered`,
 * `visibleInFilters` y curso activo. Criterio único compartido por eventos y matrícula
 * de estudiantes (un curso no ofertado ese ciclo no admite eventos ni inscripciones).
 */
export async function assertCourseOfferedInSchoolYear(
  prisma: PrismaClient,
  courseId: string,
  schoolYearId: string,
): Promise<{ id: string; courseId: string; schoolYearId: string } | null> {
  return (prisma as any).courseOffering.findFirst({
    where: { courseId, schoolYearId, isActive: true, isOffered: true, visibleInFilters: true, course: { isActive: true } },
    select: { id: true, courseId: true, schoolYearId: true },
  })
}

export async function findActiveCourseOffering(
  prisma: PrismaClient,
  courseId: string,
  schoolYearId: string,
): Promise<{ id: string; courseId: string; schoolYearId: string; isActive: boolean } | null> {
  return (prisma as any).courseOffering.findFirst({
    where: { courseId, schoolYearId, isActive: true, course: { isActive: true } },
    select: { id: true, courseId: true, schoolYearId: true, isActive: true },
  })
}
