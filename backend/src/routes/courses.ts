import { Router } from 'express'
import type { Request } from 'express'
import { z } from 'zod'
import { prisma } from '../db/prisma.js'
import { authGuard, requirePermission } from '../middlewares/auth.js'
import { ensureCourseOffering, getActiveSchoolYearId, resolveSchoolYearIdForList } from '../services/school-year-service.js'

const r = Router()

const courseCreateSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.preprocess((v) => (v === null || v === '' ? undefined : v), z.string().max(64).optional()),
  level: z.enum(['EBI', 'EMS']).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional().default(0),
  description: z.preprocess((v) => (v === null || v === '' ? undefined : v), z.string().max(2000).optional()),
  isActive: z.boolean().optional().default(true),
  offeringIsActive: z.boolean().optional(),
  offerInSchoolYear: z.boolean().optional().default(true),
  schoolYearId: z.preprocess((v) => (v === null || v === '' ? undefined : v), z.string().uuid().optional()),
})

const courseUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  code: z.preprocess((v) => (v === null || v === '' ? null : v), z.string().max(64).nullable().optional()),
  level: z.preprocess((v) => (v === null || v === '' ? null : v), z.enum(['EBI', 'EMS']).nullable().optional()),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  description: z.preprocess((v) => (v === null || v === '' ? null : v), z.string().max(2000).nullable().optional()),
  isActive: z.boolean().optional(),
  offeringIsActive: z.boolean().optional(),
  offeringNotes: z.preprocess((v) => (v === null || v === '' ? null : v), z.string().max(2000).nullable().optional()),
})

const orientationCreateSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.preprocess((v) => (v === null || v === '' ? undefined : v), z.string().max(64).optional()),
  description: z.preprocess((v) => (v === null || v === '' ? undefined : v), z.string().max(5000).optional()),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.number().int().min(0).max(9999).optional().default(0),
})

const orientationUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  code: z.preprocess((v) => (v === null || v === '' ? null : v), z.string().max(64).nullable().optional()),
  description: z.preprocess((v) => (v === null || v === '' ? null : v), z.string().max(5000).nullable().optional()),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
})

const courseOrientationCreateSchema = z.object({
  orientationId: z.string().uuid(),
  isActive: z.boolean().optional().default(true),
  notes: z.preprocess((v) => (v === null || v === '' ? undefined : v), z.string().max(2000).optional()),
  schoolYearId: z.preprocess((v) => (v === null || v === '' ? undefined : v), z.string().uuid().optional()),
})

const subjectAssociationTypeSchema = z.enum([
  'NIVEL_COMPLETO',
  'CURSO_COMPLETO',
  'TRONCO_COMUN_CURSO',
  'ORIENTACION',
  'OPTATIVA',
  'PERSONALIZADA',
])

const subjectCreateSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.preprocess((v) => (v === null || v === '' ? undefined : v), z.string().max(64).optional()),
  description: z.preprocess((v) => (v === null || v === '' ? undefined : v), z.string().max(5000).optional()),
  sortOrder: z.number().int().min(0).max(9999).optional().default(0),
  isActive: z.boolean().optional().default(true),
  associationType: subjectAssociationTypeSchema.optional(),
  orientationId: z.preprocess((v) => (v === null || v === '' ? undefined : v), z.string().uuid().optional()),
  level: z.enum(['EBI', 'EMS']).optional(),
})

const subjectUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  code: z.preprocess((v) => (v === null || v === '' ? null : v), z.string().max(64).nullable().optional()),
  description: z.preprocess((v) => (v === null || v === '' ? null : v), z.string().max(5000).nullable().optional()),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
  associationType: subjectAssociationTypeSchema.optional(),
  orientationId: z.preprocess((v) => (v === null || v === '' ? null : v), z.string().uuid().nullable().optional()),
})

function inferCourseLevel(data: { level?: 'EBI' | 'EMS' | null; name?: string | null; code?: string | null }): 'EBI' | 'EMS' | null {
  if (data.level) return data.level
  const text = `${data.code ?? ''} ${data.name ?? ''}`.toUpperCase()
  if (text.includes('EMS')) return 'EMS'
  if (/\b[789]\b|EBI/.test(text)) return 'EBI'
  return null
}

function courseOrderValue(data: { sortOrder?: number | null; code?: string | null; name?: string | null }): number {
  if (typeof data.sortOrder === 'number') return data.sortOrder
  const text = `${data.code ?? ''} ${data.name ?? ''}`.toUpperCase()
  if (text.includes('7')) return 70
  if (text.includes('8')) return 80
  if (text.includes('9')) return 90
  if (text.includes('1') && text.includes('EMS')) return 110
  if (text.includes('2') && text.includes('EMS')) return 120
  if (text.includes('3') && text.includes('EMS')) return 130
  return 999
}

function serializeCourse(course: any) {
  return {
    id: course.id,
    name: course.name,
    code: course.code,
    level: course.level ?? inferCourseLevel(course),
    sortOrder: course.sortOrder ?? courseOrderValue(course),
    description: course.description,
    isActive: course.isActive,
    schoolYearId: course.offerings?.[0]?.schoolYearId ?? null,
    courseOfferingId: course.offerings?.[0]?.id ?? null,
    offeringIsActive: course.offerings?.[0]?.isActive ?? null,
    offeringIsOffered: course.offerings?.[0]?.isOffered ?? null,
    visibleInFilters: course.offerings?.[0]?.visibleInFilters ?? null,
    offeringNotes: course.offerings?.[0]?.notes ?? null,
  }
}

async function findCourseVisibleToUser(
  courseId: string,
  user: { role: string },
  query: Request['query'],
): Promise<{ id: string } | null> {
  const includeInactive = query.all === '1' && user.role === 'ADMIN'
  const includeNotOffered = query.includeNotOffered === '1' && user.role === 'ADMIN'
  const allYears = query.allYears === '1' && user.role === 'ADMIN'
  const schoolYearId = allYears
    ? undefined
    : await resolveSchoolYearIdForList(prisma, {
        role: user.role,
        requestedSchoolYearId: typeof query.schoolYearId === 'string' ? query.schoolYearId : undefined,
      })
  const where: any = { id: courseId }
  if (!includeInactive) where.isActive = true
  if (schoolYearId && !includeNotOffered) {
    where.offerings = {
      some: {
        schoolYearId,
        ...(includeInactive ? {} : { isActive: true, isOffered: true, visibleInFilters: true }),
      },
    }
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

r.get('/orientations', authGuard, requirePermission('courses.read'), async (req, res) => {
  try {
    const includeInactive = req.query.all === '1' && req.user?.role === 'ADMIN'
    const where: any = {}
    if (!includeInactive) where.isActive = true
    const list = await (prisma as any).orientation.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, code: true, description: true, isActive: true, sortOrder: true },
    })
    res.json(list)
  } catch (e) {
    console.error('Error listando orientaciones:', e)
    res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.post('/orientations', authGuard, requirePermission('courses.manage', 'all'), async (req, res) => {
  try {
    const parsed = orientationCreateSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({
        message: 'Datos inválidos',
        detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · '),
      })
    }
    const row = await (prisma as any).orientation.create({
      data: {
        name: parsed.data.name,
        code: parsed.data.code ?? null,
        description: parsed.data.description ?? null,
        isActive: parsed.data.isActive,
        sortOrder: parsed.data.sortOrder,
      },
      select: { id: true, name: true, code: true, description: true, isActive: true, sortOrder: true },
    })
    res.status(201).json(row)
  } catch (e: unknown) {
    if ((e as { code?: string }).code === 'P2002') return res.status(409).json({ message: 'Ya existe una orientación con ese código' })
    console.error('Error creando orientación:', e)
    res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.put('/orientations/:orientationId', authGuard, requirePermission('courses.manage', 'all'), async (req, res) => {
  try {
    const oid = z.string().uuid().safeParse(req.params.orientationId)
    if (!oid.success) return res.status(400).json({ message: 'Orientación inválida' })
    const parsed = orientationUpdateSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({
        message: 'Datos inválidos',
        detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · '),
      })
    }
    const data = parsed.data
    const row = await (prisma as any).orientation.update({
      where: { id: oid.data },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.code !== undefined ? { code: data.code } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
      },
      select: { id: true, name: true, code: true, description: true, isActive: true, sortOrder: true },
    })
    res.json(row)
  } catch (e: unknown) {
    if ((e as { code?: string }).code === 'P2002') return res.status(409).json({ message: 'Ya existe una orientación con ese código' })
    if ((e as { code?: string }).code === 'P2025') return res.status(404).json({ message: 'Orientación no encontrada' })
    console.error('Error actualizando orientación:', e)
    res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.delete('/orientations/:orientationId', authGuard, requirePermission('courses.manage', 'all'), async (req, res) => {
  try {
    const oid = z.string().uuid().safeParse(req.params.orientationId)
    if (!oid.success) return res.status(400).json({ message: 'Orientación inválida' })
    await (prisma as any).orientation.delete({
      where: { id: oid.data },
    })
    res.json({ ok: true })
  } catch (e: unknown) {
    if ((e as { code?: string }).code === 'P2025') return res.status(404).json({ message: 'Orientación no encontrada' })
    console.error('Error eliminando orientación:', e)
    res.status(500).json({ message: 'Error interno del servidor' })
  }
})

/** Cursos del ciclo lectivo seleccionado (query `schoolYearId` para ADMIN/STAFF; por defecto año activo). `?allYears=1` solo ADMIN ignora el ciclo. */
r.get('/', authGuard, requirePermission('courses.read'), async (req, res) => {
  try {
    const includeInactive = req.query.all === '1' && req.user?.role === 'ADMIN'
    const includeNotOffered = req.query.includeNotOffered === '1' && req.user?.role === 'ADMIN'
    const allYears = req.query.allYears === '1' && req.user?.role === 'ADMIN'
    const schoolYearId = allYears
      ? undefined
      : await resolveSchoolYearIdForList(prisma, {
          role: req.user?.role,
          requestedSchoolYearId: typeof req.query.schoolYearId === 'string' ? req.query.schoolYearId : undefined,
        })
    const where: any = {}
    if (!includeInactive) where.isActive = true
    if (schoolYearId && !includeNotOffered) {
      where.offerings = {
        some: {
          schoolYearId,
          ...(includeInactive ? {} : { isActive: true, isOffered: true, visibleInFilters: true }),
        },
      }
    }
    const list = await (prisma as any).course.findMany({
      where,
      select: {
        id: true,
        name: true,
        code: true,
        level: true,
        sortOrder: true,
        description: true,
        isActive: true,
        offerings: schoolYearId
          ? { where: { schoolYearId }, select: { id: true, isActive: true, isOffered: true, visibleInFilters: true, schoolYearId: true, notes: true }, take: 1 }
          : { select: { id: true, isActive: true, isOffered: true, visibleInFilters: true, schoolYearId: true, notes: true }, take: 1 },
      } as any,
      orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    })
    res.json((list as any[]).map(serializeCourse))
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
    const { name, code, description, isActive, schoolYearId: bodySy, offerInSchoolYear } = parsed.data
    const level = inferCourseLevel(parsed.data)
    const sortOrder = courseOrderValue(parsed.data)
    const schoolYearId = offerInSchoolYear ? bodySy ?? (await getActiveSchoolYearId(prisma)) : null
    if (offerInSchoolYear && !schoolYearId) {
      return res.status(400).json({ message: 'No hay ciclo lectivo activo. Configurá un año lectivo primero.' })
    }
    if (schoolYearId) {
      const sy = await prisma.schoolYear.findUnique({ where: { id: schoolYearId }, select: { id: true } })
      if (!sy) return res.status(400).json({ message: 'Ciclo lectivo no encontrado' })
    }
    const created = await prisma.$transaction(async (tx) => {
      const existing = code
        ? await (tx as any).course.findFirst({ where: { code }, select: { id: true } })
        : await (tx as any).course.findFirst({ where: { name, code: null }, select: { id: true } })
      const course = existing
        ? await (tx as any).course.update({
            where: { id: existing.id },
            data: {
              name,
              level,
              sortOrder,
              description: description ?? null,
              isActive,
            },
            select: {
              id: true,
              name: true,
              code: true,
              level: true,
              sortOrder: true,
              description: true,
              isActive: true,
              createdAt: true,
              updatedAt: true,
            },
          })
        : await (tx as any).course.create({
            data: {
              name,
              code: code ?? null,
              level,
              sortOrder,
              description: description ?? null,
              isActive,
            },
            select: {
              id: true,
              name: true,
              code: true,
              level: true,
              sortOrder: true,
              description: true,
              isActive: true,
              createdAt: true,
              updatedAt: true,
            },
          })
      if (!schoolYearId) return serializeCourse({ ...course, offerings: [] })
      const offering = await (tx as any).courseOffering.upsert({
        where: { courseId_schoolYearId: { courseId: course.id, schoolYearId } },
        update: {
          isActive: parsed.data.offeringIsActive ?? isActive,
          isOffered: parsed.data.offeringIsActive ?? isActive,
          visibleInFilters: parsed.data.offeringIsActive ?? isActive,
        },
        create: {
          courseId: course.id,
          schoolYearId,
          isActive: parsed.data.offeringIsActive ?? isActive,
          isOffered: parsed.data.offeringIsActive ?? isActive,
          visibleInFilters: parsed.data.offeringIsActive ?? isActive,
        },
        select: { id: true, schoolYearId: true, isActive: true, isOffered: true, visibleInFilters: true, notes: true },
      })
      return serializeCourse({ ...course, offerings: [offering] })
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
    const updated = await (prisma as any).course.update({
      where: { id: course.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.code !== undefined ? { code: data.code } : {}),
        ...(data.level !== undefined ? { level: data.level } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      },
      select: { id: true, name: true, code: true, level: true, sortOrder: true, description: true, isActive: true },
    })
    const requestedSchoolYearId =
      typeof req.query.schoolYearId === 'string' ? req.query.schoolYearId : undefined
    let offering: any = null
    const desiredOfferingActive = data.offeringIsActive ?? data.isActive
    if (requestedSchoolYearId && (desiredOfferingActive !== undefined || data.offeringNotes !== undefined)) {
      await ensureCourseOffering(prisma, course.id, requestedSchoolYearId)
      offering = await (prisma as any).courseOffering.update({
        where: { courseId_schoolYearId: { courseId: course.id, schoolYearId: requestedSchoolYearId } },
        data: {
          ...(desiredOfferingActive !== undefined ? { isActive: desiredOfferingActive } : {}),
          ...(desiredOfferingActive !== undefined ? { isOffered: desiredOfferingActive, visibleInFilters: desiredOfferingActive } : {}),
          ...(data.offeringNotes !== undefined ? { notes: data.offeringNotes } : {}),
        },
        select: { id: true, schoolYearId: true, isActive: true, isOffered: true, visibleInFilters: true, notes: true },
      })
    }
    res.json(serializeCourse({ ...updated, offerings: offering ? [offering] : [] }))
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
      await ensureCourseOffering(prisma, course.id, requestedSchoolYearId)
      await (prisma as any).courseOffering.update({
        where: { courseId_schoolYearId: { courseId: course.id, schoolYearId: requestedSchoolYearId } },
        data: { isActive: false, isOffered: false, visibleInFilters: false },
      })
    } else {
      await (prisma as any).course.update({ where: { id: course.id }, data: { isActive: false } })
    }
    res.json({ ok: true })
  } catch (e) {
    console.error('Error eliminando curso:', e)
    res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.get('/:courseId/orientations', authGuard, requirePermission('courses.read'), async (req, res) => {
  try {
    const user = req.user
    if (!user) return res.status(401).json({ message: 'No autorizado' })
    const cid = z.string().uuid().safeParse(req.params.courseId)
    if (!cid.success) return res.status(400).json({ message: 'Curso inválido' })
    const course = await findCourseVisibleToUser(cid.data, user, req.query)
    if (!course) return res.status(404).json({ message: 'Curso no encontrado' })
    const includeInactive = req.query.all === '1' && user.role === 'ADMIN'
    const allYears = req.query.allYears === '1' && user.role === 'ADMIN'
    const schoolYearId = allYears
      ? undefined
      : await resolveSchoolYearIdForList(prisma, {
          role: user.role,
          requestedSchoolYearId: typeof req.query.schoolYearId === 'string' ? req.query.schoolYearId : undefined,
        })
    const where: any = {
      courseId: course.id,
      ...(includeInactive ? {} : { isActive: true, isOffered: true, visibleInFilters: true, orientation: { isActive: true } }),
    }
    if (schoolYearId) where.OR = [{ schoolYearId }, { schoolYearId: null }]
    const rows = await (prisma as any).courseOrientation.findMany({
      where,
      orderBy: [{ orientation: { sortOrder: 'asc' } }, { orientation: { name: 'asc' } }],
      select: {
        id: true,
        courseId: true,
        orientationId: true,
        schoolYearId: true,
        isActive: true,
        isOffered: true,
        visibleInFilters: true,
        notes: true,
        orientation: { select: { id: true, name: true, code: true, description: true, isActive: true, sortOrder: true } },
      },
    })
    res.json(rows)
  } catch (e) {
    console.error('Error listando orientaciones del curso:', e)
    res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.post('/:courseId/orientations', authGuard, requirePermission('courses.manage', 'all'), async (req, res) => {
  try {
    const user = req.user
    if (!user) return res.status(401).json({ message: 'No autorizado' })
    const cid = z.string().uuid().safeParse(req.params.courseId)
    if (!cid.success) return res.status(400).json({ message: 'Curso inválido' })
    const course = await findCourseVisibleToUser(cid.data, user, { ...req.query, all: '1', includeNotOffered: '1' })
    if (!course) return res.status(404).json({ message: 'Curso no encontrado' })
    const parsed = courseOrientationCreateSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({
        message: 'Datos inválidos',
        detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · '),
      })
    }
    const schoolYearId =
      parsed.data.schoolYearId ??
      (typeof req.query.schoolYearId === 'string' ? req.query.schoolYearId : undefined) ??
      undefined
    const existing = await (prisma as any).courseOrientation.findFirst({
      where: { courseId: course.id, orientationId: parsed.data.orientationId, schoolYearId: schoolYearId ?? null },
      select: { id: true },
    })
    const select = {
      id: true,
      courseId: true,
      orientationId: true,
      schoolYearId: true,
      isActive: true,
      isOffered: true,
      visibleInFilters: true,
      notes: true,
      orientation: { select: { id: true, name: true, code: true, description: true, isActive: true, sortOrder: true } },
    }
    const row = existing
      ? await (prisma as any).courseOrientation.update({
          where: { id: existing.id },
          data: {
            isActive: parsed.data.isActive,
            isOffered: parsed.data.isActive,
            visibleInFilters: parsed.data.isActive,
            notes: parsed.data.notes ?? null,
          },
          select,
        })
      : await (prisma as any).courseOrientation.create({
          data: {
            courseId: course.id,
            orientationId: parsed.data.orientationId,
            schoolYearId: schoolYearId ?? null,
            isActive: parsed.data.isActive,
            isOffered: parsed.data.isActive,
            visibleInFilters: parsed.data.isActive,
            notes: parsed.data.notes ?? null,
          },
          select,
        })
    res.status(201).json(row)
  } catch (e: unknown) {
    if ((e as { code?: string }).code === 'P2002') return res.status(409).json({ message: 'La orientación ya está asociada a este curso' })
    console.error('Error asociando orientación:', e)
    res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.delete('/:courseId/orientations/:courseOrientationId', authGuard, requirePermission('courses.manage', 'all'), async (req, res) => {
  try {
    const user = req.user
    if (!user) return res.status(401).json({ message: 'No autorizado' })
    const cid = z.string().uuid().safeParse(req.params.courseId)
    const coid = z.string().uuid().safeParse(req.params.courseOrientationId)
    if (!cid.success || !coid.success) return res.status(400).json({ message: 'Identificador inválido' })
    const course = await findCourseVisibleToUser(cid.data, user, { ...req.query, all: '1', includeNotOffered: '1' })
    if (!course) return res.status(404).json({ message: 'Curso no encontrado' })
    const row = await (prisma as any).courseOrientation.findFirst({
      where: { id: coid.data, courseId: course.id },
      select: { id: true },
    })
    if (!row) return res.status(404).json({ message: 'Orientación no asociada a este curso' })
    await (prisma as any).courseOrientation.delete({
      where: { id: row.id },
    })
    res.json({ ok: true })
  } catch (e) {
    console.error('Error quitando orientación del curso:', e)
    res.status(500).json({ message: 'Error interno del servidor' })
  }
})

/** Asignaturas de un curso (tabla `asignaturas`). */
r.get('/:courseId/subjects', authGuard, requirePermission('courses.read'), async (req, res) => {
  try {
    const user = req.user
    if (!user) return res.status(401).json({ message: 'No autorizado' })
    const cid = z.string().uuid().safeParse(req.params.courseId)
    if (!cid.success) return res.status(400).json({ message: 'Curso inválido' })
    const course = await findCourseVisibleToUser(cid.data, user, req.query)
    if (!course) return res.status(404).json({ message: 'Curso no encontrado' })
    const showInactive = req.query.all === '1' && user.role === 'ADMIN'
    const orientationId =
      typeof req.query.orientationId === 'string' && z.string().uuid().safeParse(req.query.orientationId).success
        ? req.query.orientationId
        : null
    const courseOfferingId = await resolveCourseOfferingIdFromQuery(course.id, user, req.query)
    const fullCourse = await (prisma as any).course.findUnique({ where: { id: course.id }, select: { id: true, level: true } })
    const schoolYearId = await resolveSchoolYearIdForList(prisma, {
      role: user.role,
      requestedSchoolYearId: typeof req.query.schoolYearId === 'string' ? req.query.schoolYearId : undefined,
    })
    const includeAllCourseAssignments =
      !orientationId && showInactive && req.query.includeNotOffered === '1' && user.role === 'ADMIN'
    const assignmentScope: any[] = [
      ...(fullCourse?.level
        ? [{ level: fullCourse.level, courseId: null, orientationId: null }]
        : []),
      includeAllCourseAssignments ? { courseId: course.id } : { courseId: course.id, orientationId: null },
      ...(orientationId ? [{ courseId: course.id, orientationId }] : []),
    ]
    const where: any = {
      ...(showInactive ? {} : { isActive: true }),
      OR: [
        {
          courseAssignments: {
            some: {
              ...(showInactive ? {} : { isActive: true, isOffered: true, visibleInFilters: true }),
              AND: [
                { OR: assignmentScope },
                ...(schoolYearId ? [{ OR: [{ schoolYearId }, { schoolYearId: null }] }] : []),
              ],
            },
          },
        },
        {
          courseId: course.id,
          ...(courseOfferingId ? { OR: [{ courseOfferingId }, { courseOfferingId: null }] } : {}),
        },
      ],
    }
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
        courseAssignments: {
          where: {
            AND: [
              { OR: assignmentScope },
              ...(schoolYearId ? [{ OR: [{ schoolYearId }, { schoolYearId: null }] }] : []),
            ],
          },
          select: {
            id: true,
            associationType: true,
            level: true,
            courseId: true,
            orientationId: true,
            schoolYearId: true,
            isActive: true,
            isOffered: true,
            visibleInFilters: true,
          },
        },
        createdAt: true,
        updatedAt: true,
      },
    })
    const isVisibleAssignment = (assignment: any) =>
      Boolean(assignment?.isActive && assignment?.isOffered && assignment?.visibleInFilters)
    const effectiveAssignmentsForCycle = (assignments: any[]) => {
      const byScope = new Map<string, any>()
      for (const assignment of assignments) {
        const key = [
          assignment.associationType ?? '',
          assignment.level ?? '',
          assignment.courseId ?? '',
          assignment.orientationId ?? '',
        ].join('|')
        const current = byScope.get(key)
        if (!current || (!current.schoolYearId && assignment.schoolYearId === schoolYearId)) {
          byScope.set(key, assignment)
        }
      }
      return Array.from(byScope.values())
    }
    const rows = (list as any[])
      .map((subject) => {
        const effectiveAssignments = effectiveAssignmentsForCycle(subject.courseAssignments ?? [])
        const visibleAssignments = showInactive
          ? effectiveAssignments
          : effectiveAssignments.filter(isVisibleAssignment)
        const chosenAssignment =
          (orientationId
            ? visibleAssignments.find((assignment) => assignment.orientationId === orientationId)
            : null) ??
          visibleAssignments.find((assignment) => assignment.orientationId === null) ??
          visibleAssignments[0] ??
          effectiveAssignments[0] ??
          null
        const legacyOnly = effectiveAssignments.length === 0 && subject.courseId === course.id
        if (!showInactive && !legacyOnly && visibleAssignments.length === 0) return null
        return {
          ...subject,
          courseAssignments: undefined,
          courseId: subject.courseId ?? course.id,
          assignmentId: chosenAssignment?.id ?? null,
          associationType: chosenAssignment?.associationType ?? 'CURSO_COMPLETO',
          orientationId: chosenAssignment?.orientationId ?? null,
          assignmentIsActive: chosenAssignment?.isActive ?? null,
          assignmentIsOffered: chosenAssignment?.isOffered ?? null,
          visibleInFilters: chosenAssignment?.visibleInFilters ?? null,
        }
      })
      .filter(Boolean)
    res.json(rows)
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
    const fullCourse = await (prisma as any).course.findUnique({ where: { id: course.id }, select: { id: true, level: true } })
    const schoolYearId = await resolveSchoolYearIdForList(prisma, {
      role: user.role,
      requestedSchoolYearId: typeof req.query.schoolYearId === 'string' ? req.query.schoolYearId : undefined,
    })
    const associationType =
      parsed.data.associationType ??
      (parsed.data.orientationId ? 'ORIENTACION' : 'TRONCO_COMUN_CURSO')
    if (associationType === 'ORIENTACION' && !parsed.data.orientationId) {
      return res.status(400).json({ message: 'Seleccioná una orientación para asociar esta asignatura' })
    }
    if (associationType === 'NIVEL_COMPLETO' && !(parsed.data.level ?? fullCourse?.level)) {
      return res.status(400).json({ message: 'Seleccioná un nivel para asociar esta asignatura' })
    }
    const row = await prisma.$transaction(async (tx) => {
      const subject = await (tx as any).subject.create({
        data: {
          name: parsed.data.name,
          code: parsed.data.code ?? null,
          description: parsed.data.description ?? null,
          sortOrder: parsed.data.sortOrder,
          isActive: parsed.data.isActive,
          courseId: null,
          courseOfferingId: null,
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
      const assignmentData: any = {
        subjectId: subject.id,
        associationType,
        isActive: parsed.data.isActive,
        isOffered: parsed.data.isActive,
        visibleInFilters: parsed.data.isActive,
        sortOrder: parsed.data.sortOrder,
      }
      if (associationType === 'NIVEL_COMPLETO') {
        assignmentData.level = parsed.data.level ?? fullCourse?.level ?? null
      } else {
        assignmentData.courseId = course.id
        if (associationType === 'ORIENTACION') assignmentData.orientationId = parsed.data.orientationId ?? null
      }
      if (schoolYearId) assignmentData.schoolYearId = schoolYearId
      await (tx as any).subjectCourseAssignment.create({ data: assignmentData })
      return {
        ...subject,
        courseId: subject.courseId ?? course.id,
        courseOfferingId,
        associationType,
        orientationId: assignmentData.orientationId ?? null,
      }
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
    const subjectWhere: any = {
      id: sid.data,
      OR: [
        { courseId: course.id },
        { courseAssignments: { some: { courseId: course.id } } },
        { courseAssignments: { some: { level: { not: null }, courseId: null } } },
      ],
    }
    if (courseOfferingId) {
      subjectWhere.AND = [{ OR: [{ courseOfferingId }, { courseOfferingId: null }, { courseAssignments: { some: { courseId: course.id } } }] }]
    }
    const existing = await (prisma.subject as any).findFirst({
      where: subjectWhere,
      select: {
        id: true,
        courseAssignments: {
          where: { OR: [{ courseId: course.id }, { level: { not: null }, courseId: null }] },
          select: { id: true },
          take: 1,
        },
      },
    })
    if (!existing) return res.status(404).json({ message: 'Asignatura no encontrada' })
    const data = parsed.data
    const updated = await prisma.$transaction(async (tx) => {
      const subject = await (tx as any).subject.update({
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
      const assignmentId = existing.courseAssignments?.[0]?.id
      if (assignmentId) {
        await (tx as any).subjectCourseAssignment.update({
          where: { id: assignmentId },
          data: {
            ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
            ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
            ...(data.isActive !== undefined ? { isOffered: data.isActive, visibleInFilters: data.isActive } : {}),
            ...(data.associationType !== undefined ? { associationType: data.associationType } : {}),
            ...(data.orientationId !== undefined ? { orientationId: data.orientationId } : {}),
          },
        })
      }
      return { ...subject, courseId: subject.courseId ?? course.id }
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
    const existing = await (prisma.subject as any).findFirst({
      where: {
        id: sid.data,
        OR: [
          { courseId: course.id },
          { courseAssignments: { some: { courseId: course.id } } },
          { courseAssignments: { some: { level: { not: null }, courseId: null } } },
        ],
      },
      select: {
        id: true,
        courseAssignments: {
          where: { OR: [{ courseId: course.id }, { level: { not: null }, courseId: null }] },
          select: { id: true },
        },
      },
    })
    if (!existing) return res.status(404).json({ message: 'Asignatura no encontrada' })
    if (existing.courseAssignments?.length) {
      await (prisma as any).subjectCourseAssignment.updateMany({
        where: { id: { in: existing.courseAssignments.map((a: any) => a.id) } },
        data: { isActive: false, isOffered: false, visibleInFilters: false },
      })
    } else {
      await (prisma.subject as any).update({ where: { id: existing.id }, data: { isActive: false } })
    }
    res.json({ ok: true })
  } catch (e) {
    console.error('Error eliminando asignatura:', e)
    res.status(500).json({ message: 'Error interno del servidor' })
  }
})

export default r
