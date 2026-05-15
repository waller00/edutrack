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

/**
 * Garantiza al menos un año ACTIVE y asigna `schoolYearId` en filas legacy (null).
 * Idempotente: seguro llamar en cada arranque y al final del seed.
 */
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
  await prisma.course.updateMany({ where: { schoolYearId: null }, data: { schoolYearId: active.id } })
  await prisma.event.updateMany({ where: { schoolYearId: null }, data: { schoolYearId: active.id } })
  await prisma.student.updateMany({ where: { schoolYearId: null }, data: { schoolYearId: active.id } })
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
  if (targetSchoolYearId === sourceSchoolYearId) {
    throw new Error('SAME_SCHOOL_YEAR')
  }
  const [target, source] = await Promise.all([
    prisma.schoolYear.findUnique({ where: { id: targetSchoolYearId } }),
    prisma.schoolYear.findUnique({ where: { id: sourceSchoolYearId } }),
  ])
  if (!target || !source) throw new Error('SCHOOL_YEAR_NOT_FOUND')

  const existing = await prisma.course.count({ where: { schoolYearId: targetSchoolYearId } })
  if (existing > 0) throw new Error('TARGET_YEAR_HAS_COURSES')

  const courses = await prisma.course.findMany({
    where: { schoolYearId: sourceSchoolYearId },
    include: { subjects: true },
  })
  let created = 0
  let subjectsCreated = 0
  await prisma.$transaction(async (tx) => {
    for (const c of courses) {
      const newCourse = await tx.course.create({
        data: {
          name: c.name,
          code: c.code,
          description: c.description,
          isActive: true,
          schoolYearId: targetSchoolYearId,
        },
      })
      created += 1
      if (c.subjects.length > 0) {
        await tx.subject.createMany({
          data: c.subjects.map((s) => ({
            name: s.name,
            code: s.code,
            description: s.description,
            sortOrder: s.sortOrder,
            isActive: s.isActive,
            courseId: newCourse.id,
          })),
        })
        subjectsCreated += c.subjects.length
      }
    }
  })
  return { created, subjectsCreated }
}
