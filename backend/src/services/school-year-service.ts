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

/** Garantiza al menos un ciclo ACTIVE. Idempotente. */
export async function ensureDefaultSchoolYearAndBackfill(prisma: PrismaClient): Promise<void> {
  let active = await getActiveSchoolYear(prisma)
  if (!active) {
    const code = new Date().getUTCFullYear()
    active = await prisma.schoolYear.create({
      data: {
        code,
        label: `Ciclo lectivo ${code}`,
        status: 'ACTIVE',
      },
    })
  }
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

export async function activateSchoolYearById(prisma: PrismaClient, id: string): Promise<SchoolYear> {
  return prisma.$transaction(async (tx) => {
    await tx.schoolYear.updateMany({
      where: { status: 'ACTIVE', NOT: { id } },
      data: { status: 'CLOSED' },
    })
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
  const subjectsCreated = 0
  await prisma.$transaction(async (tx) => {
    for (const offering of sourceOfferings) {
      await (tx as any).courseOffering.create({
        data: {
          courseId: offering.courseId,
          schoolYearId: targetSchoolYearId,
          isActive: offering.isActive,
          notes: `Oferta replicada desde ciclo ${source.code}`,
        },
      })
      created += 1
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
