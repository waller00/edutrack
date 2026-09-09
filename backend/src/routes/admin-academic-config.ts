import { Router, type Response } from 'express'
import { z } from 'zod'
import { AuditAction, type AcademicLevel } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { recordAuditEvent } from '../services/audit-log.js'
import { resolveSchoolYearIdForList } from '../services/school-year-service.js'
import { provisionGradeBooks } from '../services/gradebook/provision.js'
import {
  AcademicConfigError,
  assertLevelsCoverScale,
  findScaleGaps,
} from '../services/academic-config/validation.js'

/**
 * Parametrización académica de la libreta (RF-041, RF-044, RF-050, RF-053, §8.3).
 *
 * Montado bajo `/admin/academic-config` con `academic-config.manage` scope ALL.
 *
 * **`DELETE` desactiva, nunca destruye.** Un período o una escala quedan referenciados por las
 * calificaciones históricas: borrarlos rompería libretas de años cerrados, que RF-111 exige poder
 * consultar. La UI habla de "desactivar" y estas filas dejan de ofrecerse al calificar.
 */

const r = Router()

const ACADEMIC_LEVELS = ['EBI', 'EMS'] as const

const scaleLevelSchema = z.object({
  code: z.string().trim().min(1).max(60).regex(/^[A-Z0-9_]+$/, 'Usá mayúsculas, números y guion bajo'),
  label: z.string().trim().min(1).max(160),
  descriptor: z.string().trim().max(1000).nullish(),
  minValueHundredths: z.number().int(),
  maxValueHundredths: z.number().int(),
  colorToken: z.string().trim().max(32).nullish(),
  iconToken: z.string().trim().max(64).nullish(),
  isPassing: z.boolean().default(false),
  isAlert: z.boolean().default(false),
  sortOrder: z.number().int().min(0).default(0),
})

const scaleSchema = z.object({
  code: z.string().trim().min(1).max(60).regex(/^[A-Z0-9_]+$/, 'Usá mayúsculas, números y guion bajo'),
  name: z.string().trim().min(1).max(160),
  kind: z.enum(['NUMERIC', 'ORDINAL']).default('NUMERIC'),
  minValueHundredths: z.number().int().nullish(),
  maxValueHundredths: z.number().int().nullish(),
  decimals: z.number().int().min(0).max(2).default(0),
  description: z.string().trim().max(1000).nullish(),
  sortOrder: z.number().int().min(0).default(0),
  levels: z.array(scaleLevelSchema).max(20).default([]),
})

const scaleUpdateSchema = scaleSchema.partial().extend({
  isActive: z.boolean().optional(),
})

const ymdSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida')

const periodSchema = z.object({
  schoolYearId: z.string().uuid(),
  level: z.enum(ACADEMIC_LEVELS),
  code: z.string().trim().min(1).max(60).regex(/^[A-Z0-9_]+$/, 'Usá mayúsculas, números y guion bajo'),
  name: z.string().trim().min(1).max(160),
  sortOrder: z.number().int().min(0).default(0),
  startsOn: ymdSchema.nullish(),
  endsOn: ymdSchema.nullish(),
  closesOn: ymdSchema.nullish(),
  requiresConceptualJudgement: z.boolean().default(false),
  requiresGeneralGrade: z.boolean().default(true),
})

const periodUpdateSchema = periodSchema
  .omit({ schoolYearId: true, level: true, code: true })
  .partial()
  .extend({ isActive: z.boolean().optional() })

const activityTypeSchema = z.object({
  code: z.string().trim().min(1).max(60).regex(/^[A-Z0-9_]+$/, 'Usá mayúsculas, números y guion bajo'),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).nullish(),
  sortOrder: z.number().int().min(0).default(0),
})

const activityTypeUpdateSchema = activityTypeSchema
  .omit({ code: true })
  .partial()
  .extend({ isActive: z.boolean().optional() })

/**
 * Los payloads NO se pasan a Prisma con spread de `parsed.data`: se arman campo por campo.
 *
 * El tsconfig del backend corre con `strict: false`, y sin `strictNullChecks` la inferencia de zod
 * marca **todas** las claves como opcionales (su helper `addQuestionMarks` depende de que
 * `undefined extends T[k]` sea falso). Leer una de esas claves da el tipo correcto, pero
 * *esparcirla* conserva el `?` y Prisma rechaza el objeto por campos faltantes. Armarlo explícito
 * tipa bien y, de paso, impide que una clave inesperada del body llegue a la base.
 */
type ScaleLevelPayload = {
  code: string
  label: string
  descriptor: string | null
  minValueHundredths: number
  maxValueHundredths: number
  colorToken: string | null
  iconToken: string | null
  isPassing: boolean
  isAlert: boolean
  sortOrder: number
}

function toLevelPayload(level: z.infer<typeof scaleLevelSchema>): ScaleLevelPayload {
  return {
    code: level.code,
    label: level.label,
    descriptor: level.descriptor ?? null,
    minValueHundredths: level.minValueHundredths,
    maxValueHundredths: level.maxValueHundredths,
    colorToken: level.colorToken ?? null,
    iconToken: level.iconToken ?? null,
    isPassing: level.isPassing ?? false,
    isAlert: level.isAlert ?? false,
    sortOrder: level.sortOrder ?? 0,
  }
}

/** Día civil uruguayo a mediodía UTC: un `T00:00:00Z` se leería como el día anterior en UTC-3. */
function parseYmd(value: string | null | undefined): Date | null {
  if (!value) return null
  return new Date(`${value}T12:00:00.000Z`)
}

function serializeYmd(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null
}

function audit(req: any, action: AuditAction, entityType: string, entityId: string, metadata?: unknown) {
  recordAuditEvent({
    action,
    actorUserId: req.user?.id ?? req.user?.sub ?? null,
    req,
    entityType,
    entityId,
    metadata: metadata as never,
  })
}

/**
 * Traduce el error al cliente. `AcademicConfigError` lleva su propio status y código semántico;
 * el choque de clave única de Prisma (P2002) es un código duplicado, no un 500.
 */
function handleError(res: Response, scope: string, error: unknown) {
  if (error instanceof AcademicConfigError) {
    return res.status(error.httpStatus).json({ message: error.message, code: error.code, detail: error.details })
  }
  if ((error as { code?: string })?.code === 'P2002') {
    return res.status(409).json({ message: 'Ya existe un registro con ese código.', code: 'DUPLICATE_CODE' })
  }
  console.error(`[academic-config ${scope}]`, error)
  return res.status(500).json({ message: 'Error interno del servidor' })
}

// ─── Escalas ────────────────────────────────────────────────────────────────

const SCALE_INCLUDE = { levels: { orderBy: { sortOrder: 'asc' as const } } }

/** Los huecos no bloquean el guardado, pero la UI tiene que poder avisarlos (RF-053). */
function withScaleGaps(scale: { minValueHundredths: number | null; maxValueHundredths: number | null; levels: Array<{ code: string; minValueHundredths: number; maxValueHundredths: number }> }) {
  return { ...scale, gaps: findScaleGaps(scale.levels, scale) }
}

/**
 * Cuántas veces se usa cada fila de la parametrización.
 *
 * La UI lo necesita para poder **explicar** por qué una acción no está disponible en vez de dejar
 * que el usuario la intente y coma un error: desactivar un período con libretas cerradas, o
 * reescribir los tramos de una escala que ya tiene notas puestas (eso las re-clasifica).
 */
function countBy<K extends string>(
  rows: Array<Record<K, string | null> & { _count: { _all: number } }>,
  key: K,
): Map<string, number> {
  const map = new Map<string, number>()
  for (const row of rows) {
    const id = row[key]
    if (id) map.set(id, (map.get(id) ?? 0) + row._count._all)
  }
  return map
}

r.get('/scales', async (req, res) => {
  try {
    const includeInactive = req.query.includeInactive === 'true'
    const [scales, byScale] = await Promise.all([
      prisma.gradingScale.findMany({
        where: includeInactive ? {} : { isActive: true },
        include: SCALE_INCLUDE,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      prisma.assessment
        .groupBy({ by: ['gradingScaleId'], where: { deletedAt: null }, _count: { _all: true } })
        .then((rows) => countBy(rows, 'gradingScaleId')),
    ])
    res.json({
      data: scales.map((scale) => ({
        ...withScaleGaps(scale),
        usage: { assessments: byScale.get(scale.id) ?? 0 },
      })),
    })
  } catch (error) {
    handleError(res, 'GET /scales', error)
  }
})

r.post('/scales', async (req: any, res) => {
  const parsed = scaleSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos', errors: parsed.error.errors })

  try {
    const d = parsed.data
    const levels = (d.levels ?? []).map(toLevelPayload)
    const range = {
      minValueHundredths: d.minValueHundredths ?? null,
      maxValueHundredths: d.maxValueHundredths ?? null,
    }
    assertLevelsCoverScale(levels, range)
    const created = await prisma.gradingScale.create({
      data: {
        code: d.code,
        name: d.name,
        kind: d.kind,
        decimals: d.decimals ?? 0,
        description: d.description ?? null,
        sortOrder: d.sortOrder ?? 0,
        ...range,
        levels: { create: levels },
      },
      include: SCALE_INCLUDE,
    })
    audit(req, AuditAction.ACADEMIC_CONFIG_CREATED, 'GradingScale', created.id, { code: created.code })
    res.status(201).json({ data: withScaleGaps(created) })
  } catch (error) {
    handleError(res, 'POST /scales', error)
  }
})

r.patch('/scales/:id', async (req: any, res) => {
  const parsed = scaleUpdateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos', errors: parsed.error.errors })

  try {
    const current = await prisma.gradingScale.findUnique({ where: { id: req.params.id }, include: SCALE_INCLUDE })
    if (!current) return res.status(404).json({ message: 'Escala no encontrada' })

    const d = parsed.data
    const levels = d.levels ? d.levels.map(toLevelPayload) : null
    // Los tramos nuevos se validan contra el rango que quedará, no contra el que había.
    const range = {
      minValueHundredths: d.minValueHundredths === undefined ? current.minValueHundredths : d.minValueHundredths,
      maxValueHundredths: d.maxValueHundredths === undefined ? current.maxValueHundredths : d.maxValueHundredths,
    }
    assertLevelsCoverScale(levels ?? current.levels, range)

    const fields = {
      ...(d.name === undefined ? {} : { name: d.name }),
      ...(d.kind === undefined ? {} : { kind: d.kind }),
      ...(d.decimals === undefined ? {} : { decimals: d.decimals }),
      ...(d.description === undefined ? {} : { description: d.description ?? null }),
      ...(d.sortOrder === undefined ? {} : { sortOrder: d.sortOrder }),
      ...(d.isActive === undefined ? {} : { isActive: d.isActive }),
      ...range,
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (levels) {
        // Reemplazo completo: los tramos son un conjunto, no filas independientes; conservar los
        // viejos dejaría solapes que `assertLevelsCoverScale` ya descartó para el conjunto nuevo.
        await tx.gradingScaleLevel.deleteMany({ where: { scaleId: current.id } })
        await tx.gradingScaleLevel.createMany({
          data: levels.map((l) => ({ ...l, scaleId: current.id })),
        })
      }
      return tx.gradingScale.update({ where: { id: current.id }, data: fields, include: SCALE_INCLUDE })
    })

    audit(req, AuditAction.ACADEMIC_CONFIG_UPDATED, 'GradingScale', updated.id, { code: updated.code })
    res.json({ data: withScaleGaps(updated) })
  } catch (error) {
    handleError(res, 'PATCH /scales/:id', error)
  }
})

r.delete('/scales/:id', async (req: any, res) => {
  try {
    const updated = await prisma.gradingScale.update({
      where: { id: req.params.id },
      data: { isActive: false },
      select: { id: true, code: true },
    })
    audit(req, AuditAction.ACADEMIC_CONFIG_DEACTIVATED, 'GradingScale', updated.id, { code: updated.code })
    res.json({ ok: true, deactivated: true })
  } catch (error) {
    if ((error as { code?: string })?.code === 'P2025') {
      return res.status(404).json({ message: 'Escala no encontrada' })
    }
    handleError(res, 'DELETE /scales/:id', error)
  }
})

// ─── Períodos ───────────────────────────────────────────────────────────────

function serializePeriod(row: {
  startsOn: Date | null
  endsOn: Date | null
  closesOn: Date | null
}) {
  return {
    ...row,
    startsOn: serializeYmd(row.startsOn),
    endsOn: serializeYmd(row.endsOn),
    closesOn: serializeYmd(row.closesOn),
  }
}

r.get('/periods', async (req: any, res) => {
  try {
    const schoolYearId = await resolveSchoolYearIdForList(prisma, {
      role: req.user?.role,
      requestedSchoolYearId: req.query.schoolYearId ? String(req.query.schoolYearId) : undefined,
    })
    if (!schoolYearId) return res.status(400).json({ message: 'No hay ciclo lectivo activo' })

    const level = ACADEMIC_LEVELS.includes(req.query.level) ? (req.query.level as AcademicLevel) : undefined
    const periods = await prisma.academicPeriod.findMany({
      where: {
        schoolYearId,
        ...(level ? { level } : {}),
        ...(req.query.includeInactive === 'true' ? {} : { isActive: true }),
      },
      orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }],
    })
    const [byAssessment, byGradeBookPeriod] = await Promise.all([
      prisma.assessment
        .groupBy({ by: ['periodId'], where: { deletedAt: null }, _count: { _all: true } })
        .then((rows) => countBy(rows, 'periodId')),
      // Un período con libretas cerradas no se desactiva: RF-111 exige poder consultarlas.
      prisma.gradeBookPeriod
        .groupBy({ by: ['periodId'], where: { status: { not: 'OPEN' } }, _count: { _all: true } })
        .then((rows) => countBy(rows, 'periodId')),
    ])
    res.json({
      schoolYearId,
      data: periods.map((period) => ({
        ...serializePeriod(period),
        usage: {
          assessments: byAssessment.get(period.id) ?? 0,
          closedGradeBooks: byGradeBookPeriod.get(period.id) ?? 0,
        },
      })),
    })
  } catch (error) {
    handleError(res, 'GET /periods', error)
  }
})

/** El fin nunca puede ser anterior al inicio; el cierre nunca anterior al fin. */
function assertPeriodWindow(startsOn: Date | null, endsOn: Date | null, closesOn: Date | null) {
  if (startsOn && endsOn && startsOn > endsOn) {
    throw new AcademicConfigError(400, 'PERIOD_WINDOW_INVERTED', 'El período termina antes de empezar.')
  }
  if (endsOn && closesOn && closesOn < endsOn) {
    throw new AcademicConfigError(400, 'PERIOD_CLOSES_BEFORE_END', 'El cierre no puede ser anterior al fin del período.')
  }
}

r.post('/periods', async (req: any, res) => {
  const parsed = periodSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos', errors: parsed.error.errors })

  try {
    const d = parsed.data
    const window = {
      startsOn: parseYmd(d.startsOn),
      endsOn: parseYmd(d.endsOn),
      closesOn: parseYmd(d.closesOn),
    }
    assertPeriodWindow(window.startsOn, window.endsOn, window.closesOn)

    const created = await prisma.academicPeriod.create({
      data: {
        schoolYearId: d.schoolYearId,
        level: d.level,
        code: d.code,
        name: d.name,
        sortOrder: d.sortOrder ?? 0,
        requiresConceptualJudgement: d.requiresConceptualJudgement ?? false,
        requiresGeneralGrade: d.requiresGeneralGrade ?? true,
        ...window,
      },
    })
    audit(req, AuditAction.ACADEMIC_CONFIG_CREATED, 'AcademicPeriod', created.id, {
      code: created.code,
      level: created.level,
    })
    res.status(201).json({ data: serializePeriod(created) })
  } catch (error) {
    handleError(res, 'POST /periods', error)
  }
})

r.patch('/periods/:id', async (req: any, res) => {
  const parsed = periodUpdateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos', errors: parsed.error.errors })

  try {
    const current = await prisma.academicPeriod.findUnique({ where: { id: req.params.id } })
    if (!current) return res.status(404).json({ message: 'Período no encontrado' })

    const d = parsed.data
    const window = {
      startsOn: d.startsOn === undefined ? current.startsOn : parseYmd(d.startsOn),
      endsOn: d.endsOn === undefined ? current.endsOn : parseYmd(d.endsOn),
      closesOn: d.closesOn === undefined ? current.closesOn : parseYmd(d.closesOn),
    }
    assertPeriodWindow(window.startsOn, window.endsOn, window.closesOn)

    const updated = await prisma.academicPeriod.update({
      where: { id: current.id },
      data: {
        ...(d.name === undefined ? {} : { name: d.name }),
        ...(d.sortOrder === undefined ? {} : { sortOrder: d.sortOrder }),
        ...(d.requiresConceptualJudgement === undefined
          ? {}
          : { requiresConceptualJudgement: d.requiresConceptualJudgement }),
        ...(d.requiresGeneralGrade === undefined ? {} : { requiresGeneralGrade: d.requiresGeneralGrade }),
        ...(d.isActive === undefined ? {} : { isActive: d.isActive }),
        ...window,
      },
    })
    audit(req, AuditAction.ACADEMIC_CONFIG_UPDATED, 'AcademicPeriod', updated.id, { code: updated.code })
    res.json({ data: serializePeriod(updated) })
  } catch (error) {
    handleError(res, 'PATCH /periods/:id', error)
  }
})

r.delete('/periods/:id', async (req: any, res) => {
  try {
    const updated = await prisma.academicPeriod.update({
      where: { id: req.params.id },
      data: { isActive: false },
      select: { id: true, code: true },
    })
    audit(req, AuditAction.ACADEMIC_CONFIG_DEACTIVATED, 'AcademicPeriod', updated.id, { code: updated.code })
    res.json({ ok: true, deactivated: true })
  } catch (error) {
    if ((error as { code?: string })?.code === 'P2025') {
      return res.status(404).json({ message: 'Período no encontrado' })
    }
    handleError(res, 'DELETE /periods/:id', error)
  }
})

// ─── Tipos de actividad ─────────────────────────────────────────────────────

r.get('/activity-types', async (req, res) => {
  try {
    const [types, byType] = await Promise.all([
      prisma.activityType.findMany({
        where: {
          scope: 'GLOBAL',
          ...(req.query.includeInactive === 'true' ? {} : { isActive: true }),
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      prisma.assessment
        .groupBy({ by: ['activityTypeId'], where: { deletedAt: null }, _count: { _all: true } })
        .then((rows) => countBy(rows, 'activityTypeId')),
    ])
    res.json({
      data: types.map((type) => ({ ...type, usage: { assessments: byType.get(type.id) ?? 0 } })),
    })
  } catch (error) {
    handleError(res, 'GET /activity-types', error)
  }
})

r.post('/activity-types', async (req: any, res) => {
  const parsed = activityTypeSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos', errors: parsed.error.errors })

  try {
    // La unicidad de los códigos globales la garantiza un índice único parcial en Postgres
    // (`ActivityType_global_code_key`), porque @@unique([ownerUserId, code]) no cubre los NULL.
    const d = parsed.data
    const created = await prisma.activityType.create({
      data: {
        code: d.code,
        name: d.name,
        description: d.description ?? null,
        sortOrder: d.sortOrder ?? 0,
        scope: 'GLOBAL',
      },
    })
    audit(req, AuditAction.ACADEMIC_CONFIG_CREATED, 'ActivityType', created.id, { code: created.code })
    res.status(201).json({ data: created })
  } catch (error) {
    handleError(res, 'POST /activity-types', error)
  }
})

r.patch('/activity-types/:id', async (req: any, res) => {
  const parsed = activityTypeUpdateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos', errors: parsed.error.errors })

  try {
    const current = await prisma.activityType.findUnique({ where: { id: req.params.id } })
    if (!current) return res.status(404).json({ message: 'Tipo de actividad no encontrado' })
    if (current.scope !== 'GLOBAL') {
      return res.status(403).json({
        message: 'Este tipo pertenece a un docente; sólo su dueño puede editarlo.',
        code: 'NOT_GLOBAL',
      })
    }

    const d = parsed.data
    const updated = await prisma.activityType.update({
      where: { id: current.id },
      data: {
        ...(d.name === undefined ? {} : { name: d.name }),
        ...(d.description === undefined ? {} : { description: d.description ?? null }),
        ...(d.sortOrder === undefined ? {} : { sortOrder: d.sortOrder }),
        ...(d.isActive === undefined ? {} : { isActive: d.isActive }),
      },
    })
    audit(req, AuditAction.ACADEMIC_CONFIG_UPDATED, 'ActivityType', updated.id, { code: updated.code })
    res.json({ data: updated })
  } catch (error) {
    handleError(res, 'PATCH /activity-types/:id', error)
  }
})

r.delete('/activity-types/:id', async (req: any, res) => {
  try {
    const current = await prisma.activityType.findUnique({ where: { id: req.params.id } })
    if (!current) return res.status(404).json({ message: 'Tipo de actividad no encontrado' })
    if (current.scope !== 'GLOBAL') {
      return res.status(403).json({
        message: 'Este tipo pertenece a un docente; sólo su dueño puede darlo de baja.',
        code: 'NOT_GLOBAL',
      })
    }

    await prisma.activityType.update({ where: { id: current.id }, data: { isActive: false } })
    audit(req, AuditAction.ACADEMIC_CONFIG_DEACTIVATED, 'ActivityType', current.id, { code: current.code })
    res.json({ ok: true, deactivated: true })
  } catch (error) {
    handleError(res, 'DELETE /activity-types/:id', error)
  }
})

/**
 * Genera las libretas del ciclo a partir de los eventos de clase (RF-020).
 *
 * Vive acá y no en `/gradebook` porque es un acto de administración, no del docente. Es
 * idempotente: se puede correr las veces que haga falta tras cargar u ordenar el horario.
 */
r.post('/gradebooks/provision', async (req: any, res) => {
  try {
    const schoolYearId = await resolveSchoolYearIdForList(prisma, {
      role: req.user?.role,
      requestedSchoolYearId: req.query.schoolYearId ? String(req.query.schoolYearId) : undefined,
    })
    if (!schoolYearId) return res.status(400).json({ message: 'No hay ciclo lectivo activo' })

    const summary = await provisionGradeBooks(schoolYearId)
    audit(req, AuditAction.ACADEMIC_CONFIG_UPDATED, 'GradeBook', schoolYearId, summary)
    return res.json({ data: summary })
  } catch (error) {
    return handleError(res, 'POST /gradebooks/provision', error)
  }
})

export default r
