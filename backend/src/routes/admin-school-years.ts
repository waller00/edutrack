import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../prisma.js'
import {
  activateSchoolYearById,
  copyCoursesBetweenSchoolYears,
  getActiveSchoolYear,
} from '../services/school-year-service.js'

const r = Router()

function serializeYear(row: {
  id: string
  code: number
  label: string
  startsOn: Date | null
  endsOn: Date | null
  status: string
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    startsOn: row.startsOn?.toISOString() ?? null,
    endsOn: row.endsOn?.toISOString() ?? null,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

r.get('/', async (_req, res) => {
  try {
    const rows = await prisma.schoolYear.findMany({
      orderBy: [{ code: 'desc' }],
    })
    return res.json(rows.map(serializeYear))
  } catch (e) {
    console.error('[admin/school-years]', e)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.get('/active', async (_req, res) => {
  try {
    const row = await getActiveSchoolYear(prisma)
    if (!row) return res.json(null)
    return res.json(serializeYear(row))
  } catch (e) {
    console.error('[admin/school-years/active]', e)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

/** Comparación básica entre dos ciclos (estudiantes y cursos). */
r.get('/compare-metrics', async (req, res) => {
  const a = z.string().uuid().safeParse(req.query.a)
  const b = z.string().uuid().safeParse(req.query.b)
  if (!a.success || !b.success) {
    return res.status(400).json({ message: 'Parámetros a y b deben ser UUID de SchoolYear' })
  }
  try {
    const [ya, yb] = await Promise.all([
      prisma.schoolYear.findUnique({ where: { id: a.data } }),
      prisma.schoolYear.findUnique({ where: { id: b.data } }),
    ])
    if (!ya || !yb) return res.status(404).json({ message: 'Año lectivo no encontrado' })

    const [studentsA, studentsB, coursesA, coursesB, groupA, groupB] = await Promise.all([
      prisma.student.count({ where: { schoolYearId: ya.id } }),
      prisma.student.count({ where: { schoolYearId: yb.id } }),
      prisma.course.count({ where: { schoolYearId: ya.id } }),
      prisma.course.count({ where: { schoolYearId: yb.id } }),
      prisma.student.groupBy({
        by: ['enrollmentStatus'],
        where: { schoolYearId: ya.id },
        _count: { _all: true },
      }),
      prisma.student.groupBy({
        by: ['enrollmentStatus'],
        where: { schoolYearId: yb.id },
        _count: { _all: true },
      }),
    ])

    const mapGroup = (g: typeof groupA) => {
      const out: Record<string, number> = {}
      for (const row of g) out[row.enrollmentStatus] = row._count._all
      return out
    }

    return res.json({
      a: {
        ...serializeYear(ya),
        studentsTotal: studentsA,
        coursesCount: coursesA,
        studentsByStatus: mapGroup(groupA),
      },
      b: {
        ...serializeYear(yb),
        studentsTotal: studentsB,
        coursesCount: coursesB,
        studentsByStatus: mapGroup(groupB),
      },
    })
  } catch (e) {
    console.error('[admin/school-years/compare-metrics]', e)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

const createSchema = z.object({
  code: z.number().int().min(1980).max(2100),
  label: z.string().min(1).max(120),
  startsOn: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.string().min(4).max(40).optional()),
  endsOn: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.string().min(4).max(40).optional()),
  status: z.enum(['PLANNED', 'ACTIVE', 'CLOSED']).optional(),
})

r.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({
      message: 'Datos inválidos',
      detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · '),
    })
  }
  const { code, label, startsOn, endsOn, status } = parsed.data
  try {
    if (status === 'ACTIVE') {
      return res.status(400).json({ message: 'Para activar un ciclo usá POST /:id/activate' })
    }
    const row = await prisma.schoolYear.create({
      data: {
        code,
        label,
        startsOn: startsOn ? new Date(startsOn) : null,
        endsOn: endsOn ? new Date(endsOn) : null,
        status: status ?? 'PLANNED',
      },
    })
    return res.status(201).json(serializeYear(row))
  } catch (e: unknown) {
    const codeP = (e as { code?: string }).code
    if (codeP === 'P2002') {
      return res.status(409).json({ message: 'Ya existe un ciclo con ese código (año)' })
    }
    console.error('[admin/school-years POST]', e)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

const patchSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  startsOn: z.preprocess((v) => (v === '' || v === null ? null : v), z.string().min(4).max(40).optional().nullable()),
  endsOn: z.preprocess((v) => (v === '' || v === null ? null : v), z.string().min(4).max(40).optional().nullable()),
})

r.patch('/:id', async (req, res) => {
  const id = req.params.id
  const parsed = patchSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({
      message: 'Datos inválidos',
      detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · '),
    })
  }
  try {
    const data: Record<string, unknown> = {}
    if (parsed.data.label !== undefined) data.label = parsed.data.label
    if (parsed.data.startsOn !== undefined) {
      data.startsOn = parsed.data.startsOn === null ? null : new Date(parsed.data.startsOn)
    }
    if (parsed.data.endsOn !== undefined) {
      data.endsOn = parsed.data.endsOn === null ? null : new Date(parsed.data.endsOn)
    }
    const row = await prisma.schoolYear.update({
      where: { id },
      data: data as { label?: string; startsOn?: Date | null; endsOn?: Date | null },
    })
    return res.json(serializeYear(row))
  } catch (e: unknown) {
    const codeP = (e as { code?: string }).code
    if (codeP === 'P2025') return res.status(404).json({ message: 'Ciclo no encontrado' })
    console.error('[admin/school-years PATCH]', e)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.post('/:id/activate', async (req, res) => {
  const id = req.params.id
  try {
    const row = await prisma.schoolYear.findUnique({ where: { id } })
    if (!row) return res.status(404).json({ message: 'Ciclo no encontrado' })
    if (row.status === 'CLOSED') {
      return res.status(400).json({ message: 'No se puede activar un ciclo ya cerrado' })
    }
    const updated = await activateSchoolYearById(prisma, id)
    return res.json(serializeYear(updated))
  } catch (e) {
    console.error('[admin/school-years activate]', e)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.post('/:id/close', async (req, res) => {
  const id = req.params.id
  try {
    const row = await prisma.schoolYear.findUnique({ where: { id } })
    if (!row) return res.status(404).json({ message: 'Ciclo no encontrado' })
    if (row.status === 'ACTIVE') {
      return res.status(400).json({
        message: 'No se puede cerrar el ciclo activo. Primero activá otro año lectivo.',
      })
    }
    const updated = await prisma.schoolYear.update({
      where: { id },
      data: { status: 'CLOSED' },
    })
    return res.json(serializeYear(updated))
  } catch (e) {
    console.error('[admin/school-years close]', e)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.post('/:id/copy-courses-from/:sourceId', async (req, res) => {
  const targetId = req.params.id
  const sourceId = req.params.sourceId
  try {
    const result = await copyCoursesBetweenSchoolYears(prisma, targetId, sourceId)
    return res.status(201).json({ ok: true, ...result })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg === 'SCHOOL_YEAR_NOT_FOUND') return res.status(404).json({ message: 'Año lectivo no encontrado' })
    if (msg === 'SAME_SCHOOL_YEAR') return res.status(400).json({ message: 'Origen y destino no pueden ser el mismo' })
    if (msg === 'TARGET_YEAR_HAS_COURSES') {
      return res.status(409).json({ message: 'El año destino ya tiene cursos. La copia solo se permite en un catálogo vacío.' })
    }
    console.error('[admin/school-years copy-courses]', e)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

export default r
