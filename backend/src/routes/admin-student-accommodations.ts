import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db/prisma.js'

/**
 * Adecuaciones del estudiante (`/admin/students/:id/accommodations`).
 *
 * Router aparte de `admin-students.ts` porque no pide `students.manage`: lo montan con
 * `students.accommodations`, que tienen Administración, Dirección y Adscripción. Dirección y
 * Adscripción no gestionan la ficha del estudiante, pero sí cargan adecuaciones desde la hoja del
 * alumno en la libreta.
 *
 * **El informe nunca entra al sistema.** Se guarda el tipo, un resumen de lo que el docente
 * necesita tener en cuenta al calificar, y el enlace a donde el documento vive de verdad. Es el
 * mismo criterio que las licencias médicas: la política de privacidad prohíbe almacenar
 * diagnósticos y documentos clínicos, y un informe psicológico de un menor es exactamente eso.
 */
const r = Router({ mergeParams: true })

function clearableEmpty(v: unknown): unknown {
  if (v === null || v === undefined) return v
  if (typeof v === 'string') {
    const t = v.trim()
    return t === '' ? null : t
  }
  return v
}

const clearableDateString = z.preprocess(
  clearableEmpty,
  z
    .string()
    .min(4)
    .max(40)
    .refine((s) => !Number.isNaN(Date.parse(s)), 'Fecha inválida')
    .nullable()
    .optional(),
)

const accommodationSchema = z.object({
  kind: z.enum(['CURRICULAR', 'EVALUATION', 'ACCESSIBILITY', 'OTHER']).default('CURRICULAR'),
  summary: z.string().trim().min(1, 'Escribí qué tener en cuenta al calificar').max(4000),
  externalUrl: z.preprocess((raw) => {
    if (raw == null || raw === '') return null
    if (typeof raw !== 'string') return raw
    const t = raw.trim()
    if (!t) return null
    // Sin esquema el navegador trata el enlace como ruta relativa y se rompe el adjunto.
    if (/^https?:\/\//i.test(t)) return t
    return `https://${t}`
  }, z.string().url('El enlace tiene que ser una URL').max(2000).nullable().optional()),
  validFrom: clearableDateString,
  validUntil: clearableDateString,
})

function optionalDate(raw: string | null | undefined): Date | null {
  return raw ? new Date(raw) : null
}

function actorDisplayName(user: {
  name?: string | null
  firstName?: string | null
  lastName?: string | null
  username?: string | null
} | null | undefined): string | null {
  if (!user) return null
  const composed = [user.firstName, user.lastName].filter(Boolean).join(' ').trim()
  return (user.name?.trim() || composed || user.username || null) || null
}

function serializeAccommodation(row: any) {
  return {
    id: row.id,
    kind: row.kind,
    summary: row.summary,
    externalUrl: row.externalUrl,
    validFrom: row.validFrom?.toISOString?.() ?? row.validFrom ?? null,
    validUntil: row.validUntil?.toISOString?.() ?? row.validUntil ?? null,
    createdAt: row.createdAt?.toISOString?.() ?? row.createdAt ?? null,
    updatedAt: row.updatedAt?.toISOString?.() ?? row.updatedAt ?? null,
    createdByName: actorDisplayName(row.createdBy),
    updatedByName: actorDisplayName(row.updatedBy),
    teacherSeenAt: row.teacherSeenAt?.toISOString?.() ?? row.teacherSeenAt ?? null,
    teacherSeenByName: actorDisplayName(row.teacherSeenBy),
  }
}

const actorSelect = { select: { name: true, firstName: true, lastName: true, username: true } }
const accommodationInclude = { createdBy: actorSelect, updatedBy: actorSelect, teacherSeenBy: actorSelect }

function invalid(res: any, error: z.ZodError) {
  return res.status(400).json({
    message: 'Datos inválidos',
    detail: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · '),
  })
}

r.get('/', async (req: any, res) => {
  try {
    const rows = await prisma.studentAccommodation.findMany({
      where: { studentId: req.params.id },
      include: accommodationInclude,
      orderBy: { createdAt: 'desc' },
    })
    return res.json({ data: rows.map(serializeAccommodation) })
  } catch (error) {
    console.error('[admin/students/:id/accommodations GET]', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.post('/', async (req: any, res) => {
  const parsed = accommodationSchema.safeParse(req.body)
  if (!parsed.success) return invalid(res, parsed.error)
  try {
    const student = await prisma.student.findUnique({ where: { id: req.params.id }, select: { id: true } })
    if (!student) return res.status(404).json({ message: 'Estudiante no encontrado' })

    const d = parsed.data
    const actorId = req.user?.id ?? req.user?.sub ?? null
    const created = await prisma.studentAccommodation.create({
      data: {
        studentId: req.params.id,
        kind: d.kind,
        summary: d.summary,
        externalUrl: d.externalUrl ?? null,
        validFrom: optionalDate(d.validFrom),
        validUntil: optionalDate(d.validUntil),
        createdByUserId: actorId,
        updatedByUserId: actorId,
      },
      include: accommodationInclude,
    })
    return res.status(201).json({ data: serializeAccommodation(created) })
  } catch (error) {
    console.error('[admin/students/:id/accommodations POST]', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.put('/:accommodationId', async (req: any, res) => {
  const parsed = accommodationSchema.safeParse(req.body)
  if (!parsed.success) return invalid(res, parsed.error)
  try {
    const existing = await prisma.studentAccommodation.findFirst({
      where: { id: req.params.accommodationId, studentId: req.params.id },
      select: { id: true },
    })
    if (!existing) return res.status(404).json({ message: 'Adecuación no encontrada' })

    const d = parsed.data
    const updated = await prisma.studentAccommodation.update({
      where: { id: existing.id },
      data: {
        kind: d.kind,
        summary: d.summary,
        externalUrl: d.externalUrl ?? null,
        validFrom: optionalDate(d.validFrom),
        validUntil: optionalDate(d.validUntil),
        updatedByUserId: req.user?.id ?? req.user?.sub ?? null,
      },
      include: accommodationInclude,
    })
    return res.json({ data: serializeAccommodation(updated) })
  } catch (error) {
    console.error('[admin/students/:id/accommodations PUT]', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.delete('/:accommodationId', async (req: any, res) => {
  try {
    const deleted = await prisma.studentAccommodation.deleteMany({
      where: { id: req.params.accommodationId, studentId: req.params.id },
    })
    if (deleted.count === 0) return res.status(404).json({ message: 'Adecuación no encontrada' })
    return res.status(204).end()
  } catch (error) {
    console.error('[admin/students/:id/accommodations DELETE]', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

export default r
