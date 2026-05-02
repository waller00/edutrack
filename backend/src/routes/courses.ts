import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../prisma.js'
import { authGuard, requireAnyRole, requireRole } from '../middlewares/auth.js'

const r = Router()

const courseCreateSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.preprocess((v) => (v === null || v === '' ? undefined : v), z.string().max(64).optional()),
  description: z.preprocess((v) => (v === null || v === '' ? undefined : v), z.string().max(2000).optional()),
  isActive: z.boolean().optional().default(true),
})

/** Cursos activos para selects (crear/editar eventos). */
r.get('/', authGuard, requireAnyRole(['ADMIN', 'STAFF', 'TEACHER']), async (_req, res) => {
  try {
    const list = await prisma.course.findMany({
      where: { isActive: true },
      select: { id: true, name: true, code: true, description: true },
      orderBy: [{ name: 'asc' }],
    })
    res.json(list)
  } catch (e) {
    console.error('Error listando cursos:', e)
    res.status(500).json({ message: 'Error interno del servidor' })
  }
})

/** Alta de curso (admin). */
r.post('/', authGuard, requireRole('ADMIN'), async (req, res) => {
  try {
    const parsed = courseCreateSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({
        message: 'Datos inválidos',
        detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · '),
      })
    }
    const { name, code, description, isActive } = parsed.data
    const created = await prisma.course.create({
      data: { name, code: code ?? null, description: description ?? null, isActive },
      select: { id: true, name: true, code: true, description: true, isActive: true, createdAt: true, updatedAt: true },
    })
    res.status(201).json(created)
  } catch (e: unknown) {
    const code = (e as { code?: string }).code
    if (code === 'P2002') {
      return res.status(409).json({ message: 'Ya existe un curso con ese código' })
    }
    console.error('Error creando curso:', e)
    res.status(500).json({ message: 'Error interno del servidor' })
  }
})

export default r
