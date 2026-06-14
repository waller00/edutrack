import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { authGuard, requirePermission, userPermissionScope } from '../middlewares/auth.js';
import {
  applyEventStartDateFilter,
  buildMyEventsBaseFilter,
  applyMyEventsDateFilter,
  deriveOccurrenceStatus,
  expandRecurringEvent,
} from '../events/events-query.js';
import {
  APP_TIMEZONE,
  isYmdDateString,
  jsWeekdayInUruguay,
  parseEventTimeToUruguayHhMm,
  parseStartDateToUruguayYmd,
  uruguayWallToUtc,
  uruguayYmdEndOfDayToUtc,
} from '../config/app-timezone.js';
import { DateTime } from 'luxon';
import { sendWebPushPayloadToUser } from '../services/webPush.js';
import { attachRoleCode, selectOrgRoleCode } from '../identity/user-role-prisma.js';
import { AuditAction } from '@prisma/client';
import { recordAuditEvent } from '../services/audit-log.js';
import {
  getActiveSchoolYearId,
  resolveSchoolYearIdForList,
  assertCourseOfferedInSchoolYear as assertCourseOfferedInSchoolYearShared,
  isYmdWithinSchoolYear,
} from '../services/school-year-service.js';
import { ensureMoodleUserById } from '../services/moodle.js';
import { conflictKindBetween, findEventOverlapConflict, type EventSchedule } from '../services/events/event-overlap.js';
import { isEventStartInPast, isMovingEventStartToPast, splitEventDefinitionForEdit, todayUruguayYmd } from '../services/events/event-versioning.js';

const r = Router();

/** Aplana `orgRole.code` → `role` en usuarios relacionados del evento. */
function mapNestedEventUsers(ev: Record<string, unknown>) {
  const e = { ...ev };
  if (e.courseOffering && typeof e.courseOffering === 'object' && e.courseOffering !== null) {
    const co = e.courseOffering as { courseId?: unknown; course?: unknown };
    e.courseId = co.courseId ?? null;
    e.course = co.course ?? null;
  }
  if (e.user && typeof e.user === 'object' && e.user !== null && 'orgRole' in e.user) {
    e.user = attachRoleCode(e.user as Parameters<typeof attachRoleCode>[0]);
  }
  if (e.assignedUser && typeof e.assignedUser === 'object' && 'orgRole' in e.assignedUser) {
    e.assignedUser = attachRoleCode(e.assignedUser as Parameters<typeof attachRoleCode>[0]);
  }
  if (Array.isArray(e.attendances)) {
    e.attendances = e.attendances.map((a) => {
      const row = a as Record<string, unknown>;
      if (row.user && typeof row.user === 'object' && row.user !== null && 'orgRole' in row.user) {
        return { ...row, user: attachRoleCode(row.user as Parameters<typeof attachRoleCode>[0]) };
      }
      return a;
    });
  }
  return e;
}

/** Relación opcional incluida en respuestas de evento. */
const eventSubjectInclude = { select: { id: true, name: true, code: true } } as const
const eventCourseOfferingInclude = {
  select: { id: true, courseId: true, schoolYearId: true, course: { select: { id: true, name: true, code: true } } },
} as const
const eventOrientationInclude = { select: { id: true, name: true, code: true } } as const

function assertCourseOfferedInSchoolYear(
  courseId: string,
  schoolYearId: string,
): Promise<{ id: string; courseId: string; schoolYearId: string } | null> {
  return assertCourseOfferedInSchoolYearShared(prisma, courseId, schoolYearId)
}

async function assertActiveSubjectInCourse(
  subjectId: string,
  courseId: string,
  courseOfferingId?: string | null,
  orientationId?: string | null,
): Promise<{ id: string } | null> {
  const offering = courseOfferingId
    ? await (prisma as any).courseOffering?.findUnique?.({
        where: { id: courseOfferingId },
        select: { schoolYearId: true, course: { select: { level: true } } },
      })
    : null
  const level = offering?.course?.level ?? null
  const schoolYearId = offering?.schoolYearId ?? null
  const assignmentScopes: any[] = [
    ...(level ? [{ level, courseId: null, orientationId: null }] : []),
    { courseId, orientationId: null },
    ...(orientationId ? [{ courseId, orientationId }] : []),
  ]
  const where: any = {
    id: subjectId,
    isActive: true,
    OR: [
      { courseId },
      {
        courseAssignments: {
          some: {
            isActive: true,
            isOffered: true,
            visibleInFilters: true,
            AND: [
              { OR: assignmentScopes },
              ...(schoolYearId ? [{ OR: [{ schoolYearId }, { schoolYearId: null }] }] : []),
            ],
          },
        },
      },
    ],
  }
  if (courseOfferingId) {
    where.AND = [{ OR: [{ courseOfferingId }, { courseOfferingId: null }, { courseAssignments: { some: { courseId } } }] }]
  }
  const s = await (prisma.subject as any).findFirst({
    where,
    select: {
      id: true,
      courseId: true,
      courseAssignments: {
        where: {
          AND: [
            { OR: assignmentScopes },
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
    },
  })
  if (!s) return null
  const byScope = new Map<string, any>()
  for (const assignment of s.courseAssignments ?? []) {
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
  const visibleAssignment = Array.from(byScope.values()).some((assignment) =>
    Boolean(assignment.isActive && assignment.isOffered && assignment.visibleInFilters),
  )
  if (!visibleAssignment && s.courseId !== courseId) return null
  return { id: s.id }
}

function myEventsPathForRole(role: string | undefined): string {
  if (role === 'ADMIN') return '/admin/events';
  return '/me/events';
}

function toTimeMinutes(hh: number, mm: number) {
  return hh * 60 + mm
}

function parseRecurrenceEndInclusive(s: string) {
  if (isYmdDateString(s)) {
    return uruguayYmdEndOfDayToUtc(s)
  }
  const d = new Date(s)
  return new Date(d.getTime())
}

function normalizeImportText(value: unknown): string {
  return String(value ?? '').trim()
}

function normalizeImportLookup(value: unknown): string {
  return normalizeImportText(value).toLowerCase()
}

function importCell(row: Record<string, unknown>, keys: string[]): string {
  const normalized = new Map<string, unknown>()
  for (const [key, value] of Object.entries(row)) {
    normalized.set(key.trim().toLowerCase(), value)
  }
  for (const key of keys) {
    const value = normalized.get(key.toLowerCase())
    if (value !== undefined && String(value).trim() !== '') return String(value).trim()
  }
  return ''
}

function normalizeImportDate(value: string): string | null {
  const raw = value.trim()
  if (!raw) return null
  if (isYmdDateString(raw)) return raw
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) {
    const dd = m[1].padStart(2, '0')
    const mm = m[2].padStart(2, '0')
    return `${m[3]}-${mm}-${dd}`
  }
  return parseStartDateToUruguayYmd(raw)
}

function normalizeImportType(value: string): 'JORNADA_LABORAL' | 'REUNION' | 'CLASE' | null {
  const key = normalizeImportLookup(value).normalize('NFD').replace(/\p{Diacritic}/gu, '')
  if (key === 'clase') return 'CLASE'
  if (key === 'reunion') return 'REUNION'
  if (key === 'jornada' || key === 'jornada laboral' || key === 'jornada_laboral') return 'JORNADA_LABORAL'
  if (key === 'jornada-laboral') return 'JORNADA_LABORAL'
  if (value === 'CLASE' || value === 'REUNION' || value === 'JORNADA_LABORAL') return value
  return null
}

function parseImportBoolean(value: string): boolean {
  const key = normalizeImportLookup(value).normalize('NFD').replace(/\p{Diacritic}/gu, '')
  return ['si', 's', 'true', '1', 'yes', 'y', 'x'].includes(key)
}

function parseImportDays(value: string): number[] {
  const keyFor = (part: string) => part.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
  const map = new Map<string, number>([
    ['dom', 0], ['domingo', 0], ['0', 0],
    ['lun', 1], ['lunes', 1], ['1', 1],
    ['mar', 2], ['martes', 2], ['2', 2],
    ['mie', 3], ['miercoles', 3], ['mié', 3], ['3', 3],
    ['jue', 4], ['jueves', 4], ['4', 4],
    ['vie', 5], ['viernes', 5], ['5', 5],
    ['sab', 6], ['sabado', 6], ['sáb', 6], ['6', 6],
  ])
  const days = value
    .split(/[,+|/ ]+/)
    .map((part) => map.get(keyFor(part)))
    .filter((day): day is number => typeof day === 'number')
  return Array.from(new Set(days))
}

async function resolveImportUser(input: string): Promise<string | null> {
  if (!input) return null
  const user = await (prisma as any).user.findFirst({
    where: {
      isActive: true,
      username: { equals: input, mode: 'insensitive' },
    },
    select: { id: true },
  })
  return user?.id ?? null
}

async function resolveImportCourse(
  input: string,
  schoolYearId: string,
): Promise<{ courseId: string; courseOfferingId: string } | null> {
  if (!input) return null
  const course = await (prisma as any).course.findFirst({
    where: {
      isActive: true,
      OR: [
        { code: { equals: input, mode: 'insensitive' } },
        { name: { equals: input, mode: 'insensitive' } },
      ],
    },
    select: { id: true },
  })
  if (!course) return null
  const offering = await assertCourseOfferedInSchoolYear(course.id, schoolYearId)
  if (!offering) return null
  return { courseId: course.id, courseOfferingId: offering.id }
}

async function resolveImportOrientation(
  courseId: string,
  input: string,
  schoolYearId: string,
): Promise<{ orientationId: string; courseOrientationId: string } | null> {
  if (!input) return null
  const row = await (prisma as any).courseOrientation.findFirst({
    where: {
      courseId,
      isActive: true,
      isOffered: true,
      visibleInFilters: true,
      OR: [{ schoolYearId }, { schoolYearId: null }],
      orientation: {
        isActive: true,
        OR: [
          { code: { equals: input, mode: 'insensitive' } },
          { name: { equals: input, mode: 'insensitive' } },
        ],
      },
    },
    select: { id: true, orientationId: true },
  })
  if (!row) return null
  return { orientationId: row.orientationId, courseOrientationId: row.id }
}

async function resolveImportSubject(
  input: string,
  courseId: string,
  courseOfferingId: string,
  orientationId: string | null,
): Promise<string | null> {
  if (!input) return null
  const candidates = await (prisma.subject as any).findMany({
    where: {
      isActive: true,
      OR: [
        { code: { equals: input, mode: 'insensitive' } },
        { name: { equals: input, mode: 'insensitive' } },
      ],
    },
    select: { id: true },
    take: 20,
  })
  for (const candidate of candidates) {
    const ok = await assertActiveSubjectInCourse(candidate.id, courseId, courseOfferingId, orientationId)
    if (ok) return candidate.id
  }
  return null
}

// Esquemas de validación
const optionalUuidFromInput = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.string().uuid().optional(),
)

const nullableOptionalUuidFromUpdateInput = z.preprocess(
  (v) => (v === '' || v === null ? null : v),
  z.string().uuid().nullable().optional(),
)

const boolish = z.preprocess((v) => {
  if (v === true || v === 'true' || v === 1 || v === '1') return true
  if (v === false || v === 'false' || v === 0 || v === '0') return false
  return Boolean(v)
}, z.boolean())

const daysOfWeekish = z.preprocess((v) => {
  if (!Array.isArray(v)) return []
  return v
    .map((x) => (typeof x === 'string' ? Number.parseInt(x, 10) : Number(x)))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
}, z.array(z.number().min(0).max(6)).default([]))

const eventSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.preprocess((v) => (v === null || v === '' ? undefined : v), z.string().optional()),
  type: z.enum(['JORNADA_LABORAL', 'REUNION', 'CLASE']),
  // YYYY-MM-DD o ISO; el día civil se interpreta en America/Montevideo.
  startDate: z.string().min(1),
  // HH:MM (hora Uruguay) o ISO; se normaliza a instante UTC.
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  // El front puede mandar "" cuando el select está en "Sin asignar"; no es UUID válido.
  assignedUserId: optionalUuidFromInput,
  courseId: optionalUuidFromInput,
  orientationId: optionalUuidFromInput,
  courseOrientationId: optionalUuidFromInput,
  subjectId: optionalUuidFromInput,
  recurrenceType: z.enum(['NONE', 'DAILY', 'WEEKLY', 'MONTHLY']).default('NONE'),
  recurrenceEnd: z.string().optional().nullable(),
  isRecurring: boolish.default(false),
  daysOfWeek: daysOfWeekish,
});

const eventUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.preprocess((v) => (v === null || v === '' ? null : v), z.string().nullable().optional()),
  type: z.enum(['JORNADA_LABORAL', 'REUNION', 'CLASE']).optional(),
  startDate: z.string().min(1).optional(),
  startTime: z.string().min(1).optional(),
  endTime: z.string().min(1).optional(),
  assignedUserId: nullableOptionalUuidFromUpdateInput,
  courseId: nullableOptionalUuidFromUpdateInput,
  orientationId: nullableOptionalUuidFromUpdateInput,
  courseOrientationId: nullableOptionalUuidFromUpdateInput,
  subjectId: nullableOptionalUuidFromUpdateInput,
  status: z.enum(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED']).optional(),
  recurrenceType: z.enum(['NONE', 'DAILY', 'WEEKLY', 'MONTHLY']).optional(),
  isRecurring: boolish.optional(),
  daysOfWeek: z.preprocess(
    (v) => {
      if (v === undefined) return undefined
      if (!Array.isArray(v)) return undefined
      return v
        .map((x) => (typeof x === 'string' ? Number.parseInt(x, 10) : Number(x)))
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
    },
    z.array(z.number().min(0).max(6)).optional(),
  ),
  recurrenceEnd: z.preprocess((v) => (v === '' || v === null ? null : v), z.string().optional().nullable()),
});

const eventImportSchema = z.object({
  dryRun: boolish.optional().default(false),
  rows: z.array(z.record(z.unknown())).min(1).max(500),
})

// Importar eventos en lote desde filas CSV parseadas por el frontend.
r.post('/import', authGuard, requirePermission('events.create', 'all'), async (req, res) => {
  try {
    const user = req.user
    if (!user) return res.status(401).json({ message: 'No autorizado' })

    const parsed = eventImportSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({
        message: 'Datos inválidos',
        detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · '),
      })
    }

    let schoolYearId: string | null =
      typeof req.query.schoolYearId === 'string' ? req.query.schoolYearId : null
    if (schoolYearId) {
      const sy = await prisma.schoolYear.findUnique({ where: { id: schoolYearId }, select: { id: true, status: true } })
      if (!sy) return res.status(400).json({ message: 'Ciclo lectivo no encontrado' })
      if (sy.status === 'CLOSED') return res.status(400).json({ message: 'No se pueden importar eventos en un ciclo lectivo cerrado' })
    }
    if (!schoolYearId) schoolYearId = await getActiveSchoolYearId(prisma)
    if (!schoolYearId) {
      return res.status(400).json({ message: 'No hay ciclo lectivo activo. Configurá un año lectivo primero.' })
    }
    const importYearBounds = await prisma.schoolYear.findUnique({
      where: { id: schoolYearId },
      select: { startsOn: true, endsOn: true },
    })

    const errors: Array<{ row: number; message: string }> = []
    const prepared: any[] = []
    const batchSchedules: EventSchedule[] = []

    for (let idx = 0; idx < parsed.data.rows.length; idx += 1) {
      const source = parsed.data.rows[idx]
      const rowNumber = idx + 2
      const title = importCell(source, ['titulo', 'título', 'title'])
      const description = importCell(source, ['descripcion', 'descripción', 'description'])
      const typeInput = importCell(source, ['tipo', 'type'])
      const dateInput = importCell(source, ['fecha', 'date', 'startDate'])
      const startTimeInput = importCell(source, ['hora_inicio', 'inicio', 'startTime'])
      const endTimeInput = importCell(source, ['hora_fin', 'fin', 'endTime'])
      const assignedInput = importCell(source, ['asignado_a', 'asignado', 'docente', 'usuario', 'assignedTo'])
      const courseInput = importCell(source, ['curso', 'course'])
      const orientationInput = importCell(source, ['orientacion', 'orientación', 'orientation'])
      const subjectInput = importCell(source, ['asignatura', 'materia', 'subject'])
      const repeatsInput = importCell(source, ['repite', 'repetitivo', 'isRecurring'])
      const daysInput = importCell(source, ['dias', 'días', 'days'])
      const recurrenceEndInput = importCell(source, ['fin_repeticion', 'fin_repetición', 'hasta', 'recurrenceEnd'])

      const rowErrors: string[] = []
      if (!title) rowErrors.push('falta titulo')
      const type = normalizeImportType(typeInput || 'JORNADA_LABORAL')
      if (!type) rowErrors.push('tipo inválido')
      const ymd = normalizeImportDate(dateInput)
      if (!ymd) rowErrors.push('fecha inválida')
      else if (importYearBounds && !isYmdWithinSchoolYear(importYearBounds, ymd)) {
        rowErrors.push('la fecha está fuera del rango del ciclo lectivo')
      }
      const startHHmm = parseEventTimeToUruguayHhMm(startTimeInput)
      const endHHmm = parseEventTimeToUruguayHhMm(endTimeInput)
      if (!startHHmm) rowErrors.push('hora_inicio inválida')
      if (!endHHmm) rowErrors.push('hora_fin inválida')
      if (startHHmm && endHHmm && toTimeMinutes(endHHmm.hh, endHHmm.mm) <= toTimeMinutes(startHHmm.hh, startHHmm.mm)) {
        rowErrors.push('hora_fin debe ser mayor que hora_inicio')
      }

      let assignedUserId: string | null = null
      if (assignedInput) {
        assignedUserId = await resolveImportUser(assignedInput)
        if (!assignedUserId) rowErrors.push(`asignado_a no encontrado: ${assignedInput}`)
      }

      let courseId: string | null = null
      let courseOfferingId: string | null = null
      if (courseInput) {
        const resolved = await resolveImportCourse(courseInput, schoolYearId)
        if (!resolved) {
          rowErrors.push(`curso no encontrado/ofertado: ${courseInput}`)
        } else {
          courseId = resolved.courseId
          courseOfferingId = resolved.courseOfferingId
        }
      }

      let orientationId: string | null = null
      let courseOrientationId: string | null = null
      if (orientationInput) {
        if (!courseId) {
          rowErrors.push('orientacion requiere curso')
        } else {
          const resolved = await resolveImportOrientation(courseId, orientationInput, schoolYearId)
          if (!resolved) {
            rowErrors.push(`orientacion no disponible para el curso: ${orientationInput}`)
          } else {
            orientationId = resolved.orientationId
            courseOrientationId = resolved.courseOrientationId
          }
        }
      }

      let subjectId: string | null = null
      if (subjectInput) {
        if (!courseId || !courseOfferingId) {
          rowErrors.push('asignatura requiere curso')
        } else {
          subjectId = await resolveImportSubject(subjectInput, courseId, courseOfferingId, orientationId)
          if (!subjectId) rowErrors.push(`asignatura no pertenece al alcance elegido: ${subjectInput}`)
        }
      }

      if (rowErrors.length > 0 || !type || !ymd || !startHHmm || !endHHmm) {
        errors.push({ row: rowNumber, message: rowErrors.join(' · ') || 'fila inválida' })
        continue
      }

      const startDate = uruguayWallToUtc(ymd, startHHmm.hh, startHHmm.mm)
      const endTime = uruguayWallToUtc(ymd, endHHmm.hh, endHHmm.mm)
      const isRecurring = parseImportBoolean(repeatsInput)
      let daysOfWeek = isRecurring ? parseImportDays(daysInput) : []
      if (isRecurring && daysOfWeek.length === 0) daysOfWeek = [jsWeekdayInUruguay(startDate)]
      const recurrenceEndKey = normalizeImportLookup(recurrenceEndInput).normalize('NFD').replace(/\p{Diacritic}/gu, '')
      const recurrenceEndYmd =
        isRecurring && recurrenceEndInput && !['ciclo', 'cierre', 'ano lectivo', 'anio lectivo'].includes(recurrenceEndKey)
          ? normalizeImportDate(recurrenceEndInput)
          : null
      if (isRecurring && recurrenceEndInput && recurrenceEndYmd === null && !['', 'ciclo', 'cierre', 'ano lectivo', 'anio lectivo'].includes(recurrenceEndKey)) {
        errors.push({ row: rowNumber, message: 'fin_repeticion inválido' })
        continue
      }
      if (isRecurring && recurrenceEndYmd && uruguayYmdEndOfDayToUtc(recurrenceEndYmd).getTime() < startDate.getTime()) {
        errors.push({ row: rowNumber, message: 'fin_repeticion debe ser igual o posterior a fecha' })
        continue
      }

      const recurrenceEnd = recurrenceEndYmd ? parseRecurrenceEndInclusive(recurrenceEndYmd) : null
      const candidateSchedule: EventSchedule = {
        type,
        assignedUserId,
        startTime: startDate,
        endTime,
        startDate,
        isRecurring,
        daysOfWeek,
        recurrenceEnd,
        schoolYearId,
        courseOfferingId,
        courseOrientationId,
      }

      // Doble-reserva con otra fila del mismo archivo (aún no persistida).
      const batchConflict = batchSchedules.find((s) => conflictKindBetween(candidateSchedule, s) !== null)
      if (batchConflict) {
        errors.push({ row: rowNumber, message: 'se superpone con otra fila del archivo' })
        continue
      }
      // Doble-reserva contra eventos ya existentes en la base.
      const dbConflict = await findEventOverlapConflict(prisma, candidateSchedule)
      if (dbConflict) {
        errors.push({
          row: rowNumber,
          message:
            dbConflict.kind === 'TEACHER'
              ? 'el docente ya tiene un evento que se superpone en ese horario'
              : 'el grupo ya tiene otra clase en ese horario',
        })
        continue
      }
      batchSchedules.push(candidateSchedule)

      prepared.push({
        row: rowNumber,
        data: {
          title,
          description: description || null,
          type,
          status: 'SCHEDULED',
          userId: user.sub,
          assignedUserId,
          startDate,
          startTime: startDate,
          endTime,
          endDate: null,
          schoolYearId,
          courseOfferingId,
          orientationId,
          courseOrientationId,
          subjectId,
          isRecurring,
          recurrenceType: isRecurring ? 'WEEKLY' : 'NONE',
          daysOfWeek,
          recurrenceEnd,
        },
      })
    }

    if (errors.length > 0) {
      return res.status(400).json({
        message: 'No se importó ningún evento porque hay filas con errores',
        errors,
        validCount: prepared.length,
      })
    }

    if (parsed.data.dryRun) {
      return res.json({ ok: true, dryRun: true, createdCount: 0, validCount: prepared.length, errors: [] })
    }

    const created = await prisma.$transaction(async (tx) => {
      const rows = []
      for (const item of prepared) {
        rows.push(await (tx as any).event.create({ data: item.data, select: { id: true, title: true } }))
      }
      return rows
    })

    for (const event of created) {
      recordAuditEvent({
        action: AuditAction.EVENT_CREATED,
        actorUserId: user.sub,
        req,
        entityType: 'Event',
        entityId: event.id,
        metadata: { title: event.title, imported: true },
      })
    }

    for (const item of prepared) {
      if (item.data.assignedUserId) void ensureMoodleUserById(item.data.assignedUserId)
    }

    res.status(201).json({ ok: true, createdCount: created.length, errors: [] })
  } catch (error) {
    console.error('Error importando eventos:', error)
    res.status(500).json({ message: 'Error interno del servidor' })
  }
})

// Crear evento
r.post('/', authGuard, requirePermission('events.create'), async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'No autorizado' });

    const parsed = eventSchema.safeParse(req.body);
    if (!parsed.success) {
      const flat = parsed.error.flatten();
      const detail = parsed.error.issues
        .map((i) => `${i.path.length ? i.path.join('.') : 'formulario'}: ${i.message}`)
        .join(' · ');
      return res.status(400).json({
        message: 'Datos inválidos',
        detail,
        errors: parsed.error.issues,
        fieldErrors: flat.fieldErrors,
      });
    }

    const eventData = parsed.data;

    const eventCreateScope = await userPermissionScope(user.sub, 'events.create', user.role)
    // Los permisos de alcance propio no pueden asignar eventos a terceros.
    if (eventCreateScope !== 'all' && eventData.assignedUserId && eventData.assignedUserId !== user.sub) {
      return res.status(403).json({ message: 'No puedes asignar eventos a otros usuarios' });
    }

    let resolvedSchoolYearId: string | null =
      typeof req.query.schoolYearId === 'string' ? req.query.schoolYearId : null
    if (resolvedSchoolYearId) {
      const sy = await prisma.schoolYear.findUnique({ where: { id: resolvedSchoolYearId }, select: { id: true, status: true } })
      if (!sy) return res.status(400).json({ message: 'Ciclo lectivo no encontrado' })
      if (sy.status === 'CLOSED') return res.status(400).json({ message: 'No se pueden crear eventos en un ciclo lectivo cerrado' })
    }
    if (!resolvedSchoolYearId) {
      resolvedSchoolYearId = await getActiveSchoolYearId(prisma);
    }
    if (!resolvedSchoolYearId) {
      return res.status(400).json({ message: 'No hay ciclo lectivo activo. Configurá un año lectivo primero.' });
    }
    let resolvedCourseOfferingId: string | null = null
    let resolvedOrientationId: string | null = eventData.orientationId ?? null
    let resolvedCourseOrientationId: string | null = eventData.courseOrientationId ?? null
    if (eventData.courseId) {
      const offering = await assertCourseOfferedInSchoolYear(eventData.courseId, resolvedSchoolYearId)
      if (!offering) {
        return res.status(400).json({ message: 'Curso no encontrado, inactivo o no ofertado en este ciclo' });
      }
      resolvedCourseOfferingId = offering.id || null
    }
    if (resolvedCourseOrientationId) {
      const co = await (prisma as any).courseOrientation.findFirst({
        where: {
          id: resolvedCourseOrientationId,
          isActive: true,
          isOffered: true,
          visibleInFilters: true,
          course: { isActive: true },
          orientation: { isActive: true },
          ...(eventData.courseId ? { courseId: eventData.courseId } : {}),
          OR: [{ schoolYearId: resolvedSchoolYearId }, { schoolYearId: null }],
        },
        select: { id: true, orientationId: true, courseId: true },
      })
      if (!co) return res.status(400).json({ message: 'Orientación no disponible para este curso y ciclo' })
      resolvedOrientationId = co.orientationId
    } else if (resolvedOrientationId && eventData.courseId) {
      const co = await (prisma as any).courseOrientation.findFirst({
        where: {
          courseId: eventData.courseId,
          orientationId: resolvedOrientationId,
          isActive: true,
          isOffered: true,
          visibleInFilters: true,
          orientation: { isActive: true },
          OR: [{ schoolYearId: resolvedSchoolYearId }, { schoolYearId: null }],
        },
        select: { id: true },
      })
      if (!co) return res.status(400).json({ message: 'Orientación no disponible para este curso y ciclo' })
      resolvedCourseOrientationId = co.id
    }
    if (eventData.subjectId) {
      if (!eventData.courseId) {
        return res.status(400).json({ message: 'Seleccioná un curso para asociar una asignatura' });
      }
      const sub = await assertActiveSubjectInCourse(eventData.subjectId, eventData.courseId, resolvedCourseOfferingId, resolvedOrientationId);
      if (!sub) {
        return res.status(400).json({ message: 'Asignatura no encontrada o no pertenece al curso' });
      }
    }
    // Normalización: fecha y hora civil en Uruguay → UTC en DB.
    const ymd = parseStartDateToUruguayYmd(eventData.startDate);
    const tStart = parseEventTimeToUruguayHhMm(eventData.startTime);
    const tEnd = parseEventTimeToUruguayHhMm(eventData.endTime);
    if (!ymd || !tStart || !tEnd) {
      return res.status(400).json({ message: 'Fechas/hora inválidas (usar YYYY-MM-DD y HH:MM, hora de Uruguay)' });
    }

    const eventYearBounds = await prisma.schoolYear.findUnique({
      where: { id: resolvedSchoolYearId },
      select: { startsOn: true, endsOn: true },
    });
    if (eventYearBounds && !isYmdWithinSchoolYear(eventYearBounds, ymd)) {
      return res.status(400).json({ message: 'La fecha del evento está fuera del rango del ciclo lectivo seleccionado' });
    }

    const startMinutes = toTimeMinutes(tStart.hh, tStart.mm);
    const endMinutes = toTimeMinutes(tEnd.hh, tEnd.mm);
    if (endMinutes <= startMinutes) {
      return res.status(400).json({ message: 'Hora fin debe ser mayor que hora inicio' });
    }

    let startDateUtc: Date;
    let endTimeUtc: Date;
    try {
      startDateUtc = uruguayWallToUtc(ymd, tStart.hh, tStart.mm);
      endTimeUtc = uruguayWallToUtc(ymd, tEnd.hh, tEnd.mm);
    } catch {
      return res.status(400).json({ message: 'Fechas/hora inválidas (usar YYYY-MM-DD y HH:MM, hora de Uruguay)' });
    }

    if (isEventStartInPast(startDateUtc)) {
      return res.status(400).json({
        message: 'No se pueden crear eventos en el pasado. La fecha y hora de inicio deben ser actuales o futuras.',
      });
    }

    // Validaciones para recurrencia.
    const isRecurring = Boolean(eventData.isRecurring);
    const recurrenceType = eventData.recurrenceType ?? (isRecurring ? 'WEEKLY' : 'NONE');
    if (isRecurring && recurrenceType === 'NONE') {
      return res.status(400).json({ message: 'Evento repetitivo requiere recurrenceType válido' });
    }
    if (isRecurring && recurrenceType === 'WEEKLY' && eventData.daysOfWeek.length === 0) {
      // UX: si no seleccionan días pero el usuario definió una fecha base,
      // inferimos el día de la semana desde startDate para que el evento sea utilizable.
      // (Así evitamos “no deja” por validación demasiado estricta).
      eventData.daysOfWeek = [jsWeekdayInUruguay(startDateUtc)];
    }
    if (isRecurring && recurrenceType === 'WEEKLY' && eventData.daysOfWeek.length === 0) {
      return res.status(400).json({ message: 'Evento repetitivo semanal requiere al menos un día de la semana' });
    }
    if (isRecurring && eventData.recurrenceEnd) {
      const recEnd = parseRecurrenceEndInclusive(eventData.recurrenceEnd);
      if (recEnd.getTime() < startDateUtc.getTime()) {
        return res.status(400).json({ message: 'recurrenceEnd debe ser >= startDate (base)' });
      }
    }

    const recurrenceEndUtc = eventData.recurrenceEnd ? parseRecurrenceEndInclusive(eventData.recurrenceEnd) : null;

    const overlapCandidate: EventSchedule = {
      type: eventData.type,
      assignedUserId: eventData.assignedUserId ?? null,
      startTime: startDateUtc,
      endTime: endTimeUtc,
      startDate: startDateUtc,
      isRecurring,
      daysOfWeek: eventData.daysOfWeek ?? [],
      recurrenceEnd: recurrenceEndUtc,
      schoolYearId: resolvedSchoolYearId,
      courseOfferingId: resolvedCourseOfferingId,
      courseOrientationId: resolvedCourseOrientationId,
    };
    const conflict = await findEventOverlapConflict(prisma, overlapCandidate);
    if (conflict) {
      return res.status(409).json({
        message:
          conflict.kind === 'TEACHER'
            ? 'El docente ya tiene otro evento que se superpone en ese horario'
            : 'El grupo ya tiene otra clase en ese horario',
        code: 'EVENT_OVERLAP',
        conflict,
      });
    }

    const event = (await prisma.event.create({
      data: {
        title: eventData.title,
        description: eventData.description ?? null,
        type: eventData.type,
        status: 'SCHEDULED',
        userId: user.sub,
        assignedUserId: eventData.assignedUserId ?? null,
        startDate: startDateUtc,
        startTime: startDateUtc,
        endTime: endTimeUtc,
        endDate: null,
        recurrenceType,
        recurrenceEnd: recurrenceEndUtc,
        isRecurring,
        daysOfWeek: eventData.daysOfWeek ?? [],
        courseOfferingId: resolvedCourseOfferingId,
        orientationId: resolvedOrientationId,
        courseOrientationId: resolvedCourseOrientationId,
        subjectId: eventData.subjectId ?? null,
        schoolYearId: resolvedSchoolYearId,
      },
      include: {
        user: {
          select: { id: true, name: true, email: true, ...selectOrgRoleCode }
        },
        assignedUser: {
          select: { id: true, name: true, email: true, ...selectOrgRoleCode }
        },
        courseOffering: eventCourseOfferingInclude,
        orientation: eventOrientationInclude,
        subject: eventSubjectInclude,
      }
    } as any)) as any;

    const assigneeId = event.assignedUserId;
    if (assigneeId && assigneeId !== user.sub) {
      const assigneeRole = event.assignedUser?.orgRole?.code;
      const titleShort = event.title.length > 80 ? `${event.title.slice(0, 80)}…` : event.title;
      void sendWebPushPayloadToUser(assigneeId, {
        title: 'Edutrack — Nuevo evento',
        body: `Te asignaron un evento: ${titleShort}`,
        url: myEventsPathForRole(assigneeRole),
      }).catch((err) => console.error('Web push (evento asignado):', err));

      void prisma.inAppNotification
        .create({
          data: {
            userId: assigneeId,
            type: 'EVENT_ASSIGNED',
            title: 'Nuevo evento',
            body: `Te asignaron un evento: ${titleShort}`,
            actionUrl: myEventsPathForRole(assigneeRole),
          },
        })
        .catch((err) => console.error('Aviso en app (evento asignado):', err));
    }

    recordAuditEvent({
      action: AuditAction.EVENT_CREATED,
      actorUserId: user.sub,
      req,
      entityType: 'Event',
      entityId: event.id,
      metadata: {
        title: event.title,
        type: event.type,
        assignedUserId: event.assignedUserId,
      },
    });

    if (assigneeId) {
      void ensureMoodleUserById(assigneeId);
    }

    res.json(mapNestedEventUsers(event as unknown as Record<string, unknown>));
  } catch (error) {
    console.error('Error creando evento:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Obtener eventos del usuario actual
r.get('/my-events', authGuard, requirePermission('events.read'), async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'No autorizado' });

    const { startDate, endDate, type, status } = req.query;
    const courseIdRaw = Array.isArray(req.query.courseId) ? req.query.courseId[0] : req.query.courseId;
    const courseIdFilter = optionalUuidFromInput.safeParse(courseIdRaw);

    const where: any = buildMyEventsBaseFilter(user.sub)
    // Excluimos excepciones materializadas en childEvents para evitar duplicados.
    where.parentEventId = null

    const activeSy = await getActiveSchoolYearId(prisma)
    if (activeSy) {
      where.schoolYearId = activeSy
    }

    // Si hay filtro de fecha, buscar eventos que puedan tener instancias en ese rango
    applyMyEventsDateFilter(where, user.sub, startDate, endDate)

    if (type) {
      where.type = type;
    }

    if (status) {
      where.status = status;
    }

    if (courseIdFilter.success && courseIdFilter.data) {
      where.courseOffering = { courseId: courseIdFilter.data };
    }

    const events = await (prisma.event as any).findMany({
      where,
      include: {
        user: {
          select: { id: true, name: true, email: true, ...selectOrgRoleCode }
        },
        assignedUser: {
          select: { id: true, name: true, email: true, ...selectOrgRoleCode }
        },
        courseOffering: eventCourseOfferingInclude,
        orientation: eventOrientationInclude,
        subject: eventSubjectInclude,
        childEvents: {
          select: {
            id: true,
            title: true,
            description: true,
            type: true,
            status: true,
            startDate: true,
            startTime: true,
            endTime: true,
            endDate: true,
            recurrenceType: true,
            isRecurring: true,
            daysOfWeek: true,
            parentEventId: true,
            subjectId: true,
            courseOffering: eventCourseOfferingInclude,
            orientation: eventOrientationInclude,
            subject: eventSubjectInclude,
          },
        },
        _count: {
          select: { attendances: true }
        }
      },
      orderBy: { startDate: 'asc' },
    });

    // Para eventos repetitivos, generar instancias específicas para el rango de fechas
    let processedEvents = events.flatMap((event) => expandRecurringEvent(event, startDate, endDate))

    const subRangeStart = startDate
      ? uruguayWallToUtc(String(startDate).slice(0, 10), 0, 0)
      : uruguayWallToUtc(
          DateTime.now().setZone(APP_TIMEZONE).toFormat('yyyy-MM-dd'),
          0,
          0,
        )
    const subRangeEnd = endDate
      ? uruguayYmdEndOfDayToUtc(String(endDate).slice(0, 10))
      : uruguayYmdEndOfDayToUtc(DateTime.now().setZone(APP_TIMEZONE).toFormat('yyyy-MM-dd'))

    const substitutionRows = await (prisma as any).substitution.findMany({
      where: {
        substituteUserId: user.sub,
        date: { gte: subRangeStart, lte: subRangeEnd },
        event: {
          status: { not: 'CANCELLED' as any },
          ...(type ? { type: type as any } : null),
        },
      },
      include: {
        event: {
          include: {
            user: { select: { id: true, name: true, email: true, ...selectOrgRoleCode } },
            assignedUser: { select: { id: true, name: true, email: true, ...selectOrgRoleCode } },
            courseOffering: eventCourseOfferingInclude,
            orientation: eventOrientationInclude,
            subject: eventSubjectInclude,
          },
        },
      },
      orderBy: { startTime: 'asc' },
    })

    const seenIds = new Set(processedEvents.map((e: { id: string }) => e.id))
    for (const sub of substitutionRows) {
      const ev = sub.event as any
      if (!ev || seenIds.has(ev.id)) continue
      seenIds.add(ev.id)
      processedEvents.push({
        ...ev,
        title: `${ev.title} (suplencia)`,
        startDate: sub.date,
        startTime: sub.startTime,
        endTime: sub.endTime,
        status: deriveOccurrenceStatus(ev.status, new Date(sub.startTime), new Date(sub.endTime)),
        isSubstitution: true,
      })
    }

    processedEvents.sort(
      (a: { startTime?: Date | string | null }, b: { startTime?: Date | string | null }) =>
        new Date(a.startTime || 0).getTime() - new Date(b.startTime || 0).getTime(),
    )

    res.json(processedEvents.map((e) => mapNestedEventUsers(e as unknown as Record<string, unknown>)));
  } catch (error) {
    console.error('Error obteniendo eventos:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Marcar eventos vencidos automáticamente
async function markExpiredEvents() {
  try {
    const now = new Date();
    await prisma.event.updateMany({
      where: {
        status: {
          in: ['SCHEDULED', 'IN_PROGRESS']
        },
        OR: [
          {
            isRecurring: true,
            recurrenceEnd: { not: null, lt: now },
          },
          {
            isRecurring: true,
            recurrenceEnd: null,
            schoolYear: { status: 'CLOSED' as any },
          },
          {
            isRecurring: false,
            endDate: {
              lt: now,
            },
          },
        ],
      },
      data: {
        status: 'EXPIRED'
      }
    });
  } catch (error) {
    console.error('Error marcando eventos vencidos:', error);
  }
}

// Obtener todos los eventos (solo ADMIN)
r.get('/all', authGuard, requirePermission('events.read', 'all'), async (req, res) => {
  try {
    const user = req.user
    if (!user) return res.status(401).json({ message: 'No autorizado' })

    // Marcar eventos vencidos antes de obtener la lista
    await markExpiredEvents();
    
    const { startDate, endDate, userId, assignedUserId, type, status } = req.query;
    const courseIdRaw = Array.isArray(req.query.courseId) ? req.query.courseId[0] : req.query.courseId;
    const courseIdFilter = optionalUuidFromInput.safeParse(courseIdRaw);
    const page = Number(req.query.page) || 1;
    const pageSize = Math.min(Number(req.query.pageSize) || 20, 100);

    const allYears = req.query.allYears === '1'
    const schoolYearId = allYears
      ? undefined
      : await resolveSchoolYearIdForList(prisma, {
          role: user.role,
          requestedSchoolYearId: typeof req.query.schoolYearId === 'string' ? req.query.schoolYearId : undefined,
        })

    const where: any = {};

    applyEventStartDateFilter(where, startDate, endDate)

    if (userId) {
      where.userId = userId;
    }

    if (assignedUserId) {
      where.assignedUserId = assignedUserId;
    }

    if (type) {
      where.type = type;
    }

    if (status) {
      where.status = status;
    }

    if (schoolYearId) {
      where.schoolYearId = schoolYearId;
    }

    if (courseIdFilter.success && courseIdFilter.data) {
      where.courseOffering = { courseId: courseIdFilter.data };
    }

    const [total, events] = await Promise.all([
      prisma.event.count({ where }),
      (prisma.event as any).findMany({
        where,
        include: {
          user: {
            select: { id: true, name: true, email: true, ...selectOrgRoleCode }
          },
          assignedUser: {
            select: { id: true, name: true, email: true, ...selectOrgRoleCode }
          },
          courseOffering: eventCourseOfferingInclude,
          orientation: eventOrientationInclude,
          subject: eventSubjectInclude,
          childEvents: {
            select: {
              id: true,
              title: true,
              description: true,
              type: true,
              status: true,
              startDate: true,
              startTime: true,
              endTime: true,
              endDate: true,
              recurrenceType: true,
              isRecurring: true,
              daysOfWeek: true,
              parentEventId: true,
              subjectId: true,
              courseOffering: eventCourseOfferingInclude,
              orientation: eventOrientationInclude,
              subject: eventSubjectInclude,
            },
          },
          _count: {
            select: { attendances: true }
          }
        },
        orderBy: { startDate: startDate || endDate ? 'asc' : 'desc' },
        skip: startDate || endDate ? undefined : (page - 1) * pageSize,
        take: startDate || endDate ? undefined : pageSize,
      }),
    ]);

    const expandedEvents = (startDate || endDate)
      ? events
          .flatMap((event: any) => expandRecurringEvent(event, startDate, endDate))
          .sort((a: any, b: any) => {
            const aTime = new Date(a.startTime || a.startDate).getTime()
            const bTime = new Date(b.startTime || b.startDate).getTime()
            return aTime - bTime
          })
      : events
    const pagedEvents = startDate || endDate
      ? expandedEvents.slice((page - 1) * pageSize, page * pageSize)
      : expandedEvents

    res.json({
      total: startDate || endDate ? expandedEvents.length : total,
      page,
      pageSize,
      data: pagedEvents.map((e: any) => mapNestedEventUsers(e as unknown as Record<string, unknown>)),
    });
  } catch (error) {
    console.error('Error obteniendo todos los eventos:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Eliminar todos los eventos (solo ADMIN)
r.delete('/purge-all', authGuard, requirePermission('events.delete', 'all'), async (_req, res) => {
  try {
    const deleted = await prisma.event.deleteMany({})
    res.json({ ok: true, deletedCount: deleted.count, message: 'Todos los eventos fueron eliminados' })
  } catch (error) {
    console.error('Error eliminando todos los eventos:', error)
    res.status(500).json({ message: 'Error interno del servidor' })
  }
})

// Obtener evento por ID
r.get('/:id', authGuard, requirePermission('events.read'), async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'No autorizado' });

    const event = await (prisma.event as any).findUnique({
      where: { id },
      include: {
        user: {
          select: { id: true, name: true, email: true, ...selectOrgRoleCode }
        },
        assignedUser: {
          select: { id: true, name: true, email: true, ...selectOrgRoleCode }
        },
        courseOffering: eventCourseOfferingInclude,
        orientation: eventOrientationInclude,
        subject: eventSubjectInclude,
        attendances: {
          include: {
            user: {
              select: { id: true, name: true, email: true, ...selectOrgRoleCode }
            }
          },
          orderBy: { time: 'asc' }
        }
      }
    });

    if (!event) {
      return res.status(404).json({ message: 'Evento no encontrado' });
    }

    const eventReadScope = await userPermissionScope(user.sub, 'events.read', user.role)
    if (eventReadScope !== 'all' && event.userId !== user.sub && event.assignedUserId !== user.sub) {
      return res.status(403).json({ message: 'No tienes permisos para ver este evento' });
    }

    res.json(mapNestedEventUsers(event as unknown as Record<string, unknown>));
  } catch (error) {
    console.error('Error obteniendo evento:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Actualizar evento
r.put('/:id', authGuard, requirePermission('events.update'), async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'No autorizado' });

    const parsed = eventUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: 'Datos inválidos',
        detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · '),
        errors: parsed.error.issues,
      });
    }

    // Verificar que el evento existe y el usuario tiene permisos
    const existingEvent = await (prisma.event as any).findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        description: true,
        type: true,
        userId: true,
        assignedUserId: true,
        location: true,
        courseOfferingId: true,
        courseOffering: { select: { courseId: true } },
        orientationId: true,
        courseOrientationId: true,
        subjectId: true,
        schoolYearId: true,
        _count: { select: { attendances: true } },
        startDate: true,
        endDate: true,
        startTime: true,
        endTime: true,
        isRecurring: true,
        recurrenceType: true,
        recurrenceEnd: true,
        daysOfWeek: true,
        status: true,
        revisionOf: true,
        effectiveFrom: true,
      }
    });

    if (!existingEvent) {
      return res.status(404).json({ message: 'Evento no encontrado' });
    }

    const eventUpdateScope = await userPermissionScope(user.sub, 'events.update', user.role)
    if (eventUpdateScope !== 'all' && existingEvent.userId !== user.sub && existingEvent.assignedUserId !== user.sub) {
      return res.status(403).json({ message: 'No tienes permisos para editar este evento' });
    }

    const updateData: any = { ...parsed.data };
    delete updateData.courseId

    const attendanceCount = existingEvent._count?.attendances ?? 0
    const historySensitiveFields: Array<keyof typeof parsed.data | 'courseId'> = [
      'type',
      'startDate',
      'startTime',
      'endTime',
      'assignedUserId',
      'courseId',
      'orientationId',
      'courseOrientationId',
      'subjectId',
      'isRecurring',
      'daysOfWeek',
      'recurrenceEnd',
    ]
    const attemptedHistoricalFields = historySensitiveFields.filter(
      (field) => parsed.data[field as keyof typeof parsed.data] !== undefined,
    )
    const recurrenceTypeChanged =
      parsed.data.recurrenceType !== undefined && parsed.data.recurrenceType !== existingEvent.recurrenceType
    const requiresHistoricalReplacement =
      attendanceCount > 0 && (attemptedHistoricalFields.length > 0 || recurrenceTypeChanged)

    if (parsed.data.courseId !== undefined) {
      if (parsed.data.courseId === null) {
        updateData.schoolYearId = existingEvent.schoolYearId ?? (await getActiveSchoolYearId(prisma))
        updateData.courseOfferingId = null
      } else {
        const requestedSchoolYearId =
          typeof req.query.schoolYearId === 'string'
            ? req.query.schoolYearId
            : undefined
        const targetSchoolYearId =
          requestedSchoolYearId ??
          existingEvent.schoolYearId ??
          (await getActiveSchoolYearId(prisma))
        if (!targetSchoolYearId) {
          return res.status(400).json({ message: 'No hay ciclo lectivo activo. Configurá un año lectivo primero.' })
        }
        const co = await assertCourseOfferedInSchoolYear(parsed.data.courseId, targetSchoolYearId)
        if (!co) {
          return res.status(400).json({ message: 'Curso no encontrado, inactivo o no ofertado en este ciclo' });
        }
        updateData.schoolYearId = co.schoolYearId
        updateData.courseOfferingId = co.id || null
      }
    }

    if (
      updateData.schoolYearId &&
      existingEvent.schoolYearId &&
      updateData.schoolYearId !== existingEvent.schoolYearId &&
      attendanceCount > 0 && !requiresHistoricalReplacement
    ) {
      return res.status(409).json({
        message: 'No se puede cambiar de ciclo un evento que ya tiene asistencias registradas',
      })
    }

    if (parsed.data.subjectId !== undefined && parsed.data.subjectId !== null) {
      if (parsed.data.courseId === undefined && !existingEvent.courseOffering?.courseId) {
        return res.status(400).json({ message: 'Seleccioná un curso para asociar una asignatura' });
      }
    }

    if (parsed.data.courseId === null) {
      updateData.subjectId = null
      updateData.orientationId = null
      updateData.courseOrientationId = null
    } else if (
      parsed.data.courseId !== undefined &&
      parsed.data.courseId !== existingEvent.courseOffering?.courseId &&
      updateData.subjectId === undefined
    ) {
      updateData.subjectId = null
    }

    const finalCourseId =
      parsed.data.courseId !== undefined ? parsed.data.courseId : existingEvent.courseOffering?.courseId
    const finalCourseOfferingId =
      updateData.courseOfferingId !== undefined ? updateData.courseOfferingId : existingEvent.courseOfferingId
    let finalOrientationId =
      parsed.data.orientationId !== undefined ? parsed.data.orientationId : existingEvent.orientationId
    let finalCourseOrientationId =
      parsed.data.courseOrientationId !== undefined ? parsed.data.courseOrientationId : existingEvent.courseOrientationId

    if (parsed.data.courseOrientationId !== undefined) {
      if (parsed.data.courseOrientationId === null) {
        updateData.courseOrientationId = null
        finalCourseOrientationId = null
      } else {
        const co = await (prisma as any).courseOrientation.findFirst({
          where: {
            id: parsed.data.courseOrientationId,
            isActive: true,
            isOffered: true,
            visibleInFilters: true,
            orientation: { isActive: true },
            ...(finalCourseId ? { courseId: finalCourseId } : {}),
            ...(updateData.schoolYearId || existingEvent.schoolYearId
              ? { OR: [{ schoolYearId: updateData.schoolYearId ?? existingEvent.schoolYearId }, { schoolYearId: null }] }
              : {}),
          },
          select: { id: true, orientationId: true },
        })
        if (!co) return res.status(400).json({ message: 'Orientación no disponible para este curso y ciclo' })
        updateData.courseOrientationId = co.id
        updateData.orientationId = co.orientationId
        finalCourseOrientationId = co.id
        finalOrientationId = co.orientationId
      }
    } else if (parsed.data.orientationId !== undefined) {
      if (parsed.data.orientationId === null) {
        updateData.orientationId = null
        updateData.courseOrientationId = null
        finalOrientationId = null
        finalCourseOrientationId = null
      } else {
        if (!finalCourseId) return res.status(400).json({ message: 'Orientación requiere curso' })
        const co = await (prisma as any).courseOrientation.findFirst({
          where: {
            courseId: finalCourseId,
            orientationId: parsed.data.orientationId,
            isActive: true,
            isOffered: true,
            visibleInFilters: true,
            orientation: { isActive: true },
            ...(updateData.schoolYearId || existingEvent.schoolYearId
              ? { OR: [{ schoolYearId: updateData.schoolYearId ?? existingEvent.schoolYearId }, { schoolYearId: null }] }
              : {}),
          },
          select: { id: true },
        })
        if (!co) return res.status(400).json({ message: 'Orientación no disponible para este curso y ciclo' })
        updateData.orientationId = parsed.data.orientationId
        updateData.courseOrientationId = co.id
        finalCourseOrientationId = co.id
      }
    }
    const finalSubjectId =
      updateData.subjectId !== undefined ? updateData.subjectId : existingEvent.subjectId

    if (finalCourseId === null && finalSubjectId != null) {
      return res.status(400).json({ message: 'Asignatura requiere curso' })
    }

    if (finalSubjectId != null) {
      if (!finalCourseId) {
        return res.status(400).json({ message: 'Asignatura requiere curso' })
      }
      const okSub = await assertActiveSubjectInCourse(finalSubjectId, finalCourseId, finalCourseOfferingId, finalOrientationId)
      if (!okSub) {
        return res.status(400).json({ message: 'Asignatura no encontrada o no pertenece al curso' })
      }
    }

    // Normalización UTC de startDate/startTime/endTime si se envían.
    // Si no se envían, conservamos componentes del evento actual.
    const nextStartDateInput = updateData.startDate ?? null;
    const nextStartTimeInput = updateData.startTime ?? null;
    const nextEndTimeInput = updateData.endTime ?? null;

    if (nextStartDateInput || nextStartTimeInput || nextEndTimeInput) {
      const baseYmd =
        nextStartDateInput != null && String(nextStartDateInput) !== ''
          ? parseStartDateToUruguayYmd(String(nextStartDateInput))
          : DateTime.fromJSDate(new Date(existingEvent.startDate), { zone: 'utc' })
              .setZone(APP_TIMEZONE)
              .toFormat('yyyy-MM-dd');

      const existingStartWall = DateTime.fromJSDate(
        new Date(existingEvent.startTime ?? existingEvent.startDate),
        { zone: 'utc' },
      ).setZone(APP_TIMEZONE);
      const existingEndWall = DateTime.fromJSDate(
        new Date(existingEvent.endTime ?? existingEvent.startDate),
        { zone: 'utc' },
      ).setZone(APP_TIMEZONE);

      const startHHmm = nextStartTimeInput
        ? parseEventTimeToUruguayHhMm(String(nextStartTimeInput))
        : { hh: existingStartWall.hour, mm: existingStartWall.minute };

      const endHHmm = nextEndTimeInput
        ? parseEventTimeToUruguayHhMm(String(nextEndTimeInput))
        : { hh: existingEndWall.hour, mm: existingEndWall.minute };

      if (!baseYmd || !startHHmm || !endHHmm) {
        return res.status(400).json({ message: 'Fechas/hora inválidas (usar YYYY-MM-DD y HH:MM, hora de Uruguay)' });
      }

      const startMinutes = toTimeMinutes(startHHmm.hh, startHHmm.mm);
      const endMinutes = toTimeMinutes(endHHmm.hh, endHHmm.mm);
      if (endMinutes <= startMinutes) {
        return res.status(400).json({ message: 'Hora fin debe ser mayor que hora inicio' });
      }

      const targetYearId = updateData.schoolYearId ?? existingEvent.schoolYearId;
      if (targetYearId) {
        const updateYearBounds = await prisma.schoolYear.findUnique({
          where: { id: targetYearId },
          select: { startsOn: true, endsOn: true },
        });
        if (updateYearBounds && !isYmdWithinSchoolYear(updateYearBounds, baseYmd)) {
          return res.status(400).json({ message: 'La fecha del evento está fuera del rango del ciclo lectivo seleccionado' });
        }
      }

      let startDateUtc: Date;
      let endTimeUtc: Date;
      try {
        startDateUtc = uruguayWallToUtc(baseYmd, startHHmm.hh, startHHmm.mm);
        endTimeUtc = uruguayWallToUtc(baseYmd, endHHmm.hh, endHHmm.mm);
      } catch {
        return res.status(400).json({ message: 'Fechas/hora inválidas (usar YYYY-MM-DD y HH:MM, hora de Uruguay)' });
      }

      const existingStartUtc = new Date(existingEvent.startTime ?? existingEvent.startDate);
      if (isMovingEventStartToPast(existingStartUtc, startDateUtc)) {
        return res.status(400).json({
          message: 'No se puede mover un evento al pasado. La fecha y hora de inicio deben ser actuales o futuras.',
        });
      }

      updateData.startDate = startDateUtc
      updateData.startTime = startDateUtc
      updateData.endTime = endTimeUtc
      updateData.endDate = null
    }

    if (updateData.recurrenceEnd !== undefined) {
      updateData.recurrenceEnd = updateData.recurrenceEnd
        ? parseRecurrenceEndInclusive(String(updateData.recurrenceEnd))
        : null
    }

    // Validación mínima para recurrencia si se está actualizando.
    if (typeof updateData.isRecurring === 'boolean' ? updateData.isRecurring : existingEvent.isRecurring) {
      const recType = updateData.recurrenceType ?? existingEvent.recurrenceType
      if (recType === 'NONE') {
        return res.status(400).json({ message: 'Evento repetitivo requiere recurrenceType válido' })
      }
      const days = updateData.daysOfWeek ?? existingEvent.daysOfWeek
      if (recType === 'WEEKLY' && (!days || days.length === 0)) {
        return res.status(400).json({ message: 'Evento repetitivo semanal requiere al menos un día de la semana' })
      }
    }

    // Validación de doble-reserva sobre la agenda resultante (excluye el propio evento y su familia).
    const mergedStartTime = updateData.startTime ?? existingEvent.startTime ?? existingEvent.startDate
    const mergedEndTime = updateData.endTime ?? existingEvent.endTime
    if (mergedStartTime && mergedEndTime) {
      const overlapCandidate: EventSchedule = {
        id: existingEvent.id,
        type: updateData.type ?? existingEvent.type,
        assignedUserId:
          updateData.assignedUserId !== undefined ? updateData.assignedUserId : existingEvent.assignedUserId,
        startTime: mergedStartTime,
        endTime: mergedEndTime,
        startDate: updateData.startDate ?? existingEvent.startDate,
        isRecurring: updateData.isRecurring !== undefined ? updateData.isRecurring : existingEvent.isRecurring,
        daysOfWeek: updateData.daysOfWeek ?? existingEvent.daysOfWeek ?? [],
        recurrenceEnd: updateData.recurrenceEnd !== undefined ? updateData.recurrenceEnd : existingEvent.recurrenceEnd,
        effectiveFrom: existingEvent.effectiveFrom ?? null,
        schoolYearId: updateData.schoolYearId ?? existingEvent.schoolYearId,
        courseOfferingId: finalCourseOfferingId,
        courseOrientationId: finalCourseOrientationId,
        revisionOf: existingEvent.revisionOf ?? null,
      }
      const conflict = await findEventOverlapConflict(prisma, overlapCandidate)
      if (conflict) {
        return res.status(409).json({
          message:
            conflict.kind === 'TEACHER'
              ? 'El docente ya tiene otro evento que se superpone en ese horario'
              : 'El grupo ya tiene otra clase en ese horario',
          code: 'EVENT_OVERLAP',
          conflict,
        })
      }
    }

    if (requiresHistoricalReplacement) {
      // Split de vigencia: la versión actual conserva sus ocurrencias pasadas (con asistencia)
      // y se crea una nueva versión vigente desde hoy con los cambios. No se corrompen históricos.
      const newVersion = await prisma.$transaction(async (tx) =>
        splitEventDefinitionForEdit(tx, {
          existing: { id: existingEvent.id, revisionOf: existingEvent.revisionOf ?? null },
          cutoffYmd: todayUruguayYmd(),
          data: {
            title: updateData.title ?? existingEvent.title,
            description: updateData.description !== undefined ? updateData.description : existingEvent.description,
            type: updateData.type ?? existingEvent.type,
            status: updateData.status ?? 'SCHEDULED',
            userId: existingEvent.userId,
            assignedUserId:
              updateData.assignedUserId !== undefined ? updateData.assignedUserId : existingEvent.assignedUserId,
            location: existingEvent.location ?? null,
            startDate: updateData.startDate ?? existingEvent.startDate,
            endDate: updateData.endDate !== undefined ? updateData.endDate : existingEvent.endDate ?? null,
            startTime: updateData.startTime ?? existingEvent.startTime ?? updateData.startDate ?? existingEvent.startDate,
            endTime: updateData.endTime ?? existingEvent.endTime,
            schoolYearId: updateData.schoolYearId ?? existingEvent.schoolYearId,
            courseOfferingId:
              updateData.courseOfferingId !== undefined ? updateData.courseOfferingId : existingEvent.courseOfferingId,
            orientationId:
              updateData.orientationId !== undefined ? updateData.orientationId : existingEvent.orientationId,
            courseOrientationId:
              updateData.courseOrientationId !== undefined
                ? updateData.courseOrientationId
                : existingEvent.courseOrientationId,
            subjectId: updateData.subjectId !== undefined ? updateData.subjectId : existingEvent.subjectId,
            recurrenceType: updateData.recurrenceType ?? existingEvent.recurrenceType,
            recurrenceEnd:
              updateData.recurrenceEnd !== undefined ? updateData.recurrenceEnd : existingEvent.recurrenceEnd,
            isRecurring: updateData.isRecurring !== undefined ? updateData.isRecurring : existingEvent.isRecurring,
            daysOfWeek: updateData.daysOfWeek ?? existingEvent.daysOfWeek ?? [],
          },
          include: {
            user: { select: { id: true, name: true, email: true, ...selectOrgRoleCode } },
            assignedUser: { select: { id: true, name: true, email: true, ...selectOrgRoleCode } },
            courseOffering: eventCourseOfferingInclude,
            orientation: eventOrientationInclude,
            subject: eventSubjectInclude,
          },
        }),
      )

      if (newVersion.assignedUserId) {
        void ensureMoodleUserById(newVersion.assignedUserId)
      }

      recordAuditEvent({
        action: AuditAction.EVENT_CREATED,
        actorUserId: user.sub,
        req,
        entityType: 'Event',
        entityId: newVersion.id,
        metadata: { supersedesEventId: id, reason: 'Split de vigencia por edición con asistencias' },
      })

      const mapped = mapNestedEventUsers(newVersion as unknown as Record<string, unknown>)
      return res.json({
        ...mapped,
        historicalReplacement: true,
        replacedEventId: id,
        message:
          'El evento tenía asistencias: se conservó la versión histórica y se creó una nueva versión vigente desde hoy con los cambios.',
      })
    }

    const event = await (prisma.event as any).update({
      where: { id },
      data: updateData,
      include: {
        user: {
          select: { id: true, name: true, email: true, ...selectOrgRoleCode }
        },
        assignedUser: {
          select: { id: true, name: true, email: true, ...selectOrgRoleCode }
        },
        courseOffering: eventCourseOfferingInclude,
        orientation: eventOrientationInclude,
        subject: eventSubjectInclude,
      }
    });

    if (parsed.data.assignedUserId !== undefined && parsed.data.assignedUserId !== null) {
      void ensureMoodleUserById(parsed.data.assignedUserId);
    }

    res.json(mapNestedEventUsers(event as unknown as Record<string, unknown>));
  } catch (error) {
    console.error('Error actualizando evento:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Cancelar evento
r.put('/:id/cancel', authGuard, requirePermission('events.cancel'), async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'No autorizado' });

    const { reason } = req.body;

    // Verificar que el evento existe y el usuario tiene permisos
    const existingEvent = await (prisma.event as any).findUnique({
      where: { id },
      select: { userId: true, assignedUserId: true, status: true, description: true }
    });

    if (!existingEvent) {
      return res.status(404).json({ message: 'Evento no encontrado' });
    }

    if (existingEvent.status === 'CANCELLED') {
      return res.status(400).json({ message: 'El evento ya está cancelado' });
    }

    const eventCancelScope = await userPermissionScope(user.sub, 'events.cancel', user.role)
    if (eventCancelScope !== 'all' && existingEvent.userId !== user.sub && existingEvent.assignedUserId !== user.sub) {
      return res.status(403).json({ message: 'No tienes permisos para cancelar este evento' });
    }

    const event = await (prisma.event as any).update({
      where: { id },
      data: { 
        status: 'CANCELLED',
        description: reason ? `${existingEvent.description || ''}\n\nCancelado: ${reason}`.trim() : existingEvent.description
      },
      include: {
        user: {
          select: { id: true, name: true, email: true, ...selectOrgRoleCode }
        },
        assignedUser: {
          select: { id: true, name: true, email: true, ...selectOrgRoleCode }
        },
            courseOffering: eventCourseOfferingInclude,
            orientation: eventOrientationInclude,
            subject: eventSubjectInclude,
      }
    });

    res.json(mapNestedEventUsers(event as unknown as Record<string, unknown>));
  } catch (error) {
    console.error('Error cancelando evento:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Eliminación lógica de evento (solo ADMIN): conserva asistencias e historial.
r.delete('/:id', authGuard, requirePermission('events.delete', 'all'), async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'No autorizado' });

    const existingEvent = await (prisma.event as any).findUnique({
      where: { id },
      select: { id: true, title: true, status: true, description: true },
    });
    if (!existingEvent) return res.status(404).json({ message: 'Evento no encontrado' });

    const marker = '[Eliminado logicamente]';
    const description = existingEvent.description?.includes(marker)
      ? existingEvent.description
      : `${existingEvent.description || ''}\n\n${marker}`.trim();

    if (existingEvent.status !== 'CANCELLED' || description !== existingEvent.description) {
      await (prisma.event as any).update({
        where: { id },
        data: { status: 'CANCELLED', description },
      });
    }

    recordAuditEvent({
      action: AuditAction.EVENT_CREATED,
      actorUserId: user.sub,
      req,
      entityType: 'Event',
      entityId: id,
      metadata: {
        title: existingEvent.title,
        softDeleted: true,
      },
    });

    res.json({ message: 'Evento eliminado correctamente', softDeleted: true });
  } catch (error: any) {
    console.error('Error eliminando evento:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

export default r;
