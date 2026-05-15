import { Router } from 'express'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../prisma.js'
import { authGuard, requireAnyRole, requireRole } from '../middlewares/auth.js'
import { getActiveSchoolYearId, resolveSchoolYearIdForList } from '../services/school-year-service.js'

const r = Router()

const courseCreateSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.preprocess((v) => (v === null || v === '' ? undefined : v), z.string().max(64).optional()),
  description: z.preprocess((v) => (v === null || v === '' ? undefined : v), z.string().max(2000).optional()),
  isActive: z.boolean().optional().default(true),
  schoolYearId: z.preprocess((v) => (v === null || v === '' ? undefined : v), z.string().uuid().optional()),
})

/** Cursos del ciclo lectivo seleccionado (query `schoolYearId` para ADMIN/STAFF; por defecto año activo). `?allYears=1` solo ADMIN ignora el ciclo. */
r.get('/', authGuard, requireAnyRole(['ADMIN', 'STAFF', 'TEACHER']), async (req, res) => {
  try {
    const includeInactive = req.query.all === '1' && req.user?.role === 'ADMIN'
    const allYears = req.query.allYears === '1' && req.user?.role === 'ADMIN'
    const schoolYearId = allYears
      ? undefined
      : await resolveSchoolYearIdForList(prisma, {
          role: req.user?.role,
          requestedSchoolYearId: typeof req.query.schoolYearId === 'string' ? req.query.schoolYearId : undefined,
        })
    const where: Prisma.CourseWhereInput = {}
    if (!includeInactive) where.isActive = true
    if (schoolYearId) where.schoolYearId = schoolYearId
    const list = await prisma.course.findMany({
      where,
      select: { id: true, name: true, code: true, description: true, isActive: true, schoolYearId: true },
      orderBy: [{ name: 'asc' }],
    })
    res.json(list)
  } catch (e) {
    console.error('Error listando cursos:', e)
    res.status(500).json({ message: 'Error interno del servidor' })
  }
})

/** Alta de curso (admin), siempre asociado a un ciclo lectivo. */
r.post('/', authGuard, requireRole('ADMIN'), async (req, res) => {
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
    const created = await prisma.course.create({
      data: {
        name,
        code: code ?? null,
        description: description ?? null,
        isActive,
        schoolYearId,
      },
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
        isActive: true,
        schoolYearId: true,
        createdAt: true,
        updatedAt: true,
      },
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

export default r
