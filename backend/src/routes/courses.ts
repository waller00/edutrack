import { Router } from 'express'
import type { Request } from 'express'
import { z } from 'zod'
import { prisma } from '../db/prisma.js'
import { authGuard, requireAnyRoleOrPermission, requirePermission } from '../middlewares/auth.js'
import { ensureCourseOffering, getActiveSchoolYearId, resolveSchoolYearIdForList } from '../services/school-year-service.js'

const r = Router()

const courseCreateSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.preprocess((v) => (v === null || v === '' ? undefined : v), z.string().max(64).optional()),
  description: z.preprocess((v) => (v === null || v === '' ? undefined : v), z.string().max(2000).optional()),
  isActive: z.boolean().optional().default(true),
  schoolYearId: z.preprocess((v) => (v === null || v === '' ? undefined : v), z.string().uuid().optional()),
})

const courseUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  code: z.preprocess((v) => (v === null || v === '' ? null : v), z.string().max(64).nullable().optional()),
  description: z.preprocess((v) => (v === null || v === '' ? null : v), z.string().max(2000).nullable().optional()),
  isActive: z.boolean().optional(),
})

const subjectCreateSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.preprocess((v) => (v === null || v === '' ? undefined : v), z.string().max(64).optional()),
  description: z.preprocess((v) => (v === null || v === '' ? undefined : v), z.string().max(5000).optional()),
  sortOrder: z.number().int().min(0).max(9999).optional().default(0),
  isActive: z.boolean().optional().default(true),
})

const subjectUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  code: z.preprocess((v) => (v === null || v === '' ? null : v), z.string().max(64).nullable().optional()),
  description: z.preprocess((v) => (v === null || v === '' ? null : v), z.string().max(5000).nullable().optional()),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
})

async function findCourseVisibleToUser(
  courseId: string,
  user: { role: string },
  query: Request['query'],
): Promise<{ id: string } | null> {
  const includeInactive = query.all === '1' && user.role === 'ADMIN'
  const allYears = query.allYears === '1' && user.role === 'ADMIN'
  const schoolYearId = allYears
    ? undefined
    : await resolveSchoolYearIdForList(prisma, {
        role: user.role,
        requestedSchoolYearId: typeof query.schoolYearId === 'string' ? query.schoolYearId : undefined,
      })
  const where: any = { id: courseId }
  if (!includeInactive) where.isActive = true
  if (schoolYearId) {
    where.offerings = { some: { schoolYearId, ...(includeInactive ? {} : { isActive: true }) } }
  }
  return prisma.course.findFirst({ where, select: { id: true } })
}

async function resolveCourseOfferingIdFromQuery(
  courseId: string,
  user: { role: string },
  query: Request['query'],
): Promise<string | null> {
  const schoolYearId = await resolveSchoolYearIdForList(prisma, {
    role: user.role,
    requestedSchoolYearId: typeof query.schoolYearId === 'string' ? query.schoolYearId : undefined,
  })
  if (!schoolYearId) return null
  const courseOfferingDelegate = (prisma as any).courseOffering
  if (!courseOfferingDelegate?.findFirst) return null
  const offering = await courseOfferingDelegate.findFirst({
    where: { courseId, schoolYearId },
    select: { id: true },
  })
  return offering?.id ?? null
}

/** Cursos del ciclo lectivo seleccionado (query `schoolYearId` para ADMIN/STAFF; por defecto año activo). `?allYears=1` solo ADMIN ignora el ciclo. */
r.get('/', authGuard, requireAnyRoleOrPermission(['ADMIN', 'STAFF', 'TEACHER'], 'courses.manage'), async (req, res) => {
  try {
    const includeInactive = req.query.all === '1' && req.user?.role === 'ADMIN'
    const allYears = req.query.allYears === '1' && req.user?.role === 'ADMIN'
    const schoolYearId = allYears
      ? undefined
      : await resolveSchoolYearIdForList(prisma, {
          role: req.user?.role,
          requestedSchoolYearId: typeof req.query.schoolYearId === 'string' ? req.query.schoolYearId : undefined,
        })
    const where: any = {}
    if (!includeInactive) where.isActive = true
    if (schoolYearId) {
      where.offerings = { some: { schoolYearId, ...(includeInactive ? {} : { isActive: true }) } }
    }
    const list = await prisma.course.findMany({
      where,
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
        isActive: true,
        offerings: schoolYearId
          ? { where: { schoolYearId }, select: { id: true, isActive: true, schoolYearId: true }, take: 1 }
          : { select: { id: true, isActive: true, schoolYearId: true }, take: 1 },
      } as any,
      orderBy: [{ name: 'asc' }],
    })
    res.json(
      (list as any[]).map((course) => ({
        id: course.id,
        name: course.name,
        code: course.code,
        description: course.description,
        isActive: course.isActive,
        schoolYearId: course.offerings[0]?.schoolYearId ?? null,
        courseOfferingId: course.offerings[0]?.id ?? null,
        offeringIsActive: course.offerings[0]?.isActive ?? null,
      })),
    )
  } catch (e) {
    console.error('Error listando cursos:', e)
    res.status(500).json({ message: 'Error interno del servidor' })
  }
})

/** Alta de curso (admin), siempre asociado a un ciclo lectivo. */
r.post('/', authGuard, requirePermission('courses.manage', 'all'), async (req, res) => {
  try {
    const parsed = courseCreateSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({
        message: 'Datos inválidos',
        detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · '),
      })
    }
    const { name, code, description, isActive, schoolYearId: bodySy } = parsed.data
    const schoolYearId = bodySy ?? (await getActiveSchoolYearId(prisma))
    if (!schoolYearId) {
      return res.status(400).json({ message: 'No hay ciclo lectivo activo. Configurá un año lectivo primero.' })
    }
    const sy = await prisma.schoolYear.findUnique({ where: { id: schoolYearId }, select: { id: true } })
    if (!sy) return res.status(400).json({ message: 'Ciclo lectivo no encontrado' })
    const created = await prisma.$transaction(async (tx) => {
      const existing = code
        ? await tx.course.findFirst({ where: { code }, select: { id: true } })
        : await tx.course.findFirst({ where: { name, code: null }, select: { id: true } })
      const course = existing
        ? await tx.course.update({
            where: { id: existing.id },
            data: {
              name,
              description: description ?? null,
              isActive,
            },
            select: {
              id: true,
              name: true,
              code: true,
              description: true,
              isActive: true,
              createdAt: true,
              updatedAt: true,
            },
          })
        : await tx.course.create({
            data: {
              name,
              code: code ?? null,
              description: description ?? null,
              isActive,
            },
            select: {
              id: true,
              name: true,
              code: true,
              description: true,
              isActive: true,
              createdAt: true,
              updatedAt: true,
            },
          })
      const offering = await (tx as any).courseOffering.upsert({
        where: { courseId_schoolYearId: { courseId: course.id, schoolYearId } },
        update: { isActive },
        create: { courseId: course.id, schoolYearId, isActive },
        select: { id: true, schoolYearId: true, isActive: true },
      })
      return { ...course, schoolYearId: offering.schoolYearId, courseOfferingId: offering.id, offeringIsActive: offering.isActive }
    })
    res.status(201).json(created)
  } catch (e: unknown) {
    const code = (e as { code?: string }).code
    if (code === 'P2002') {
      return res.status(409).json({ message: 'Ya existe un curso con ese código en este ciclo lectivo' })
    }
    console.error('Error creando curso:', e)
    res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.put('/:courseId', authGuard, requirePermission('courses.manage', 'all'), async (req, res) => {
  try {
    const user = req.user
    if (!user) return res.status(401).json({ message: 'No autorizado' })
    const cid = z.string().uuid().safeParse(req.params.courseId)
    if (!cid.success) return res.status(400).json({ message: 'Curso inválido' })
    const course = await findCourseVisibleToUser(cid.data, user, { ...req.query, all: '1' })
    if (!course) return res.status(404).json({ message: 'Curso no encontrado' })
    const parsed = courseUpdateSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({
        message: 'Datos inválidos',
        detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · '),
      })
    }
    const data = parsed.data
    const updated = await prisma.course.update({
      where: { id: course.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.code !== undefined ? { code: data.code } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      },
      select: { id: true, name: true, code: true, description: true, isActive: true },
    })
    const requestedSchoolYearId =
      typeof req.query.schoolYearId === 'string' ? req.query.schoolYearId : undefined
    if (requestedSchoolYearId && data.isActive !== undefined) {
      await ensureCourseOffering(prisma, course.id, requestedSchoolYearId)
      await (prisma as any).courseOffering.update({
        where: { courseId_schoolYearId: { courseId: course.id, schoolYearId: requestedSchoolYearId } },
        data: { isActive: data.isActive },
      })
    }
    res.json(updated)
  } catch (e: unknown) {
    const code = (e as { code?: string }).code
    if (code === 'P2002') return res.status(409).json({ message: 'Ya existe un curso con ese código en este ciclo lectivo' })
    console.error('Error actualizando curso:', e)
    res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.delete('/:courseId', authGuard, requirePermission('courses.manage', 'all'), async (req, res) => {
  try {
    const user = req.user
    if (!user) return res.status(401).json({ message: 'No autorizado' })
    const cid = z.string().uuid().safeParse(req.params.courseId)
    if (!cid.success) return res.status(400).json({ message: 'Curso inválido' })
    const course = await findCourseVisibleToUser(cid.data, user, { ...req.query, all: '1' })
    if (!course) return res.status(404).json({ message: 'Curso no encontrado' })
    const requestedSchoolYearId =
      typeof req.query.schoolYearId === 'string' ? req.query.schoolYearId : undefined
    if (requestedSchoolYearId) {
      await (prisma as any).courseOffering.deleteMany({ where: { courseId: course.id, schoolYearId: requestedSchoolYearId } })
    } else {
      await prisma.course.update({ where: { id: course.id }, data: { isActive: false } })
    }
    res.json({ ok: true })
  } catch (e) {
    console.error('Error eliminando curso:', e)
    res.status(500).json({ message: 'Error interno del servidor' })
  }
})

/** Asignaturas de un curso (tabla `asignaturas`). */
r.get('/:courseId/subjects', authGuard, requireAnyRoleOrPermission(['ADMIN', 'STAFF', 'TEACHER'], 'courses.manage'), async (req, res) => {
  try {
    const user = req.user
    if (!user) return res.status(401).json({ message: 'No autorizado' })
    const cid = z.string().uuid().safeParse(req.params.courseId)
    if (!cid.success) return res.status(400).json({ message: 'Curso inválido' })
    const course = await findCourseVisibleToUser(cid.data, user, req.query)
    if (!course) return res.status(404).json({ message: 'Curso no encontrado' })
    const showInactive = req.query.all === '1' && user.role === 'ADMIN'
    const courseOfferingId = await resolveCourseOfferingIdFromQuery(course.id, user, req.query)
    const where: any = { courseId: course.id }
    if (!showInactive) where.isActive = true
    if (courseOfferingId) where.OR = [{ courseOfferingId }, { courseOfferingId: null }]
    const list = await (prisma.subject as any).findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
        sortOrder: true,
        isActive: true,
        courseId: true,
        courseOfferingId: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    res.json(list)
  } catch (e) {
    console.error('Error listando asignaturas:', e)
    res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.post('/:courseId/subjects', authGuard, requirePermission('courses.manage', 'all'), async (req, res) => {
  try {
    const user = req.user
    if (!user) return res.status(401).json({ message: 'No autorizado' })
    const cid = z.string().uuid().safeParse(req.params.courseId)
    if (!cid.success) return res.status(400).json({ message: 'Curso inválido' })
    const course = await findCourseVisibleToUser(cid.data, user, req.query)
    if (!course) return res.status(404).json({ message: 'Curso no encontrado' })
    const parsed = subjectCreateSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({
        message: 'Datos inválidos',
        detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · '),
      })
    }
    const courseOfferingId = await resolveCourseOfferingIdFromQuery(course.id, user, req.query)
    const row = await (prisma.subject as any).create({
      data: {
        courseId: course.id,
        courseOfferingId,
        name: parsed.data.name,
        code: parsed.data.code ?? null,
        description: parsed.data.description ?? null,
        sortOrder: parsed.data.sortOrder,
        isActive: parsed.data.isActive,
      },
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
        sortOrder: true,
        isActive: true,
        courseId: true,
        courseOfferingId: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    res.status(201).json(row)
  } catch (e) {
    console.error('Error creando asignatura:', e)
    res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.put('/:courseId/subjects/:subjectId', authGuard, requirePermission('courses.manage', 'all'), async (req, res) => {
  try {
    const user = req.user
    if (!user) return res.status(401).json({ message: 'No autorizado' })
    const cid = z.string().uuid().safeParse(req.params.courseId)
    const sid = z.string().uuid().safeParse(req.params.subjectId)
    if (!cid.success || !sid.success) return res.status(400).json({ message: 'Identificador inválido' })
    const course = await findCourseVisibleToUser(cid.data, user, req.query)
    if (!course) return res.status(404).json({ message: 'Curso no encontrado' })
    const parsed = subjectUpdateSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({
        message: 'Datos inválidos',
        detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · '),
      })
    }
    const courseOfferingId = await resolveCourseOfferingIdFromQuery(course.id, user, req.query)
    const subjectWhere: any = { id: sid.data, courseId: course.id }
    if (courseOfferingId) subjectWhere.OR = [{ courseOfferingId }, { courseOfferingId: null }]
    const existing = await (prisma.subject as any).findFirst({
      where: subjectWhere,
      select: { id: true },
    })
    if (!existing) return res.status(404).json({ message: 'Asignatura no encontrada' })
    const data = parsed.data
    const updated = await (prisma.subject as any).update({
      where: { id: existing.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.code !== undefined ? { code: data.code } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      },
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
        sortOrder: true,
        isActive: true,
        courseId: true,
        courseOfferingId: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    res.json(updated)
  } catch (e) {
    console.error('Error actualizando asignatura:', e)
    res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.delete('/:courseId/subjects/:subjectId', authGuard, requirePermission('courses.manage', 'all'), async (req, res) => {
  try {
    const user = req.user
    if (!user) return res.status(401).json({ message: 'No autorizado' })
    const cid = z.string().uuid().safeParse(req.params.courseId)
    const sid = z.string().uuid().safeParse(req.params.subjectId)
    if (!cid.success || !sid.success) return res.status(400).json({ message: 'Identificador inválido' })
    const course = await findCourseVisibleToUser(cid.data, user, req.query)
    if (!course) return res.status(404).json({ message: 'Curso no encontrado' })
    const courseOfferingId = await resolveCourseOfferingIdFromQuery(course.id, user, req.query)
    const subjectWhere: any = { id: sid.data, courseId: course.id }
    if (courseOfferingId) subjectWhere.OR = [{ courseOfferingId }, { courseOfferingId: null }]
    const del = await (prisma.subject as any).deleteMany({ where: subjectWhere })
    if (del.count === 0) return res.status(404).json({ message: 'Asignatura no encontrada' })
    res.json({ ok: true })
  } catch (e) {
    console.error('Error eliminando asignatura:', e)
    res.status(500).json({ message: 'Error interno del servidor' })
  }
})

export default r
