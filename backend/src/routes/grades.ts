import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { AuditAction, type AcademicLevel } from '@prisma/client'
import { authGuard, requirePermission } from '../middlewares/auth.js'
import { recordAuditEvent } from '../services/audit-log.js'
import { prisma } from '../db/prisma.js'
import { isMoodleIntegrationEnabled } from '../integrations/moodle/client.js'
import { resolveMoodleAcademicScope } from '../integrations/moodle/scope.js'
import { getMappedId } from '../integrations/moodle/object-map.js'
import { getEnrolledUserIds } from '../integrations/moodle/enrolments.js'
import { studentIdnumber } from '../integrations/moodle/student-users.js'
import {
  listCourseAssignments,
  getAssignmentGrades,
  saveAssignmentGrade,
  type MoodleAssignment,
} from '../integrations/moodle/grades.js'
import {
  buildGradeWorkbook,
  parseGradeWorkbook,
  type GradeSheetMeta,
  type GradeSheetStudent,
  type GradeWorkbookEntry,
  type ParsedGradeRow,
  type ParsedGradeSheet,
} from '../services/grades/gradeSheet.js'

/**
 * Puente de notas EduTrack↔Moodle: bajar una planilla con el roster + notas actuales y subirla para
 * escribir las notas de vuelta en Moodle. EduTrack no almacena notas; Moodle es la fuente de verdad.
 * Sólo admin (`courses.manage` / scope ALL).
 *
 * El único filtro obligatorio es el curso (oferta): sin asignatura/tarea la planilla abarca todas
 * las asignaturas sincronizadas del curso (una hoja por tarea); con asignatura, todas sus tareas;
 * con tarea, sólo esa. Si el curso tiene orientaciones se puede filtrar por orientación (precedencia
 * `courseOrientationId` → `orientationId` → curso general, igual que el scope de eventos). Cada hoja
 * embebe metadatos, así la subida identifica la tarea sin depender de los filtros.
 */

const r = Router()

const scopeFilter = z.object({
  courseOfferingId: z.string().uuid(),
  subjectId: z.string().uuid().optional(),
  orientationId: z.string().uuid().optional(),
  courseOrientationId: z.string().uuid().optional(),
})

type ScopeFilter = z.infer<typeof scopeFilter>

type OfferingInfo = {
  id: string
  courseId: string
  schoolYearId: string
  courseName: string
  courseLevel: AcademicLevel | null
  schoolYearLabel: string
}

type SubjectInfo = { id: string; name: string }

type ResolvedSubjectCourse = {
  subject: SubjectInfo
  moodleCourseId: number
  courseLabel: string
  /** Orientación efectiva con la que se encontró el curso Moodle (puede caer al curso general). */
  effectiveCourseOrientationId: string | null
  effectiveOrientationId: string | null
}

class GradeBridgeError extends Error {
  constructor(
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message)
  }
}

async function loadOffering(courseOfferingId: string): Promise<OfferingInfo> {
  if (!isMoodleIntegrationEnabled()) {
    throw new GradeBridgeError(409, 'La integración con Moodle no está configurada.')
  }
  const offering = await prisma.courseOffering.findUnique({
    where: { id: courseOfferingId },
    select: {
      id: true,
      courseId: true,
      schoolYearId: true,
      course: { select: { name: true, level: true } },
      schoolYear: { select: { label: true } },
    },
  })
  if (!offering) throw new GradeBridgeError(404, 'Oferta de curso no encontrada.')
  return {
    id: offering.id,
    courseId: offering.courseId,
    schoolYearId: offering.schoolYearId,
    courseName: offering.course.name,
    courseLevel: offering.course.level ?? null,
    schoolYearLabel: offering.schoolYear.label,
  }
}

/** Nombre de la orientación filtrada (para etiquetas), validando que pertenezca al curso. */
async function loadOrientationName(offering: OfferingInfo, filter: ScopeFilter): Promise<string | null> {
  if (filter.courseOrientationId) {
    const row = await prisma.courseOrientation.findUnique({
      where: { id: filter.courseOrientationId },
      select: { courseId: true, orientation: { select: { name: true } } },
    })
    if (!row || row.courseId !== offering.courseId) {
      throw new GradeBridgeError(400, 'La orientación no pertenece al curso elegido.')
    }
    return row.orientation.name
  }
  if (filter.orientationId) {
    const row = await prisma.orientation.findUnique({
      where: { id: filter.orientationId },
      select: { name: true },
    })
    if (!row) throw new GradeBridgeError(404, 'Orientación no encontrada.')
    return row.name
  }
  return null
}

/**
 * Resuelve el curso Moodle de una asignatura probando la orientación de más específica a más
 * general (courseOrientation → orientation → curso general): los cursos Moodle se crean desde
 * eventos, que pueden llevar cualquiera de las tres formas. Devuelve `null` si ninguna está
 * sincronizada.
 */
async function resolveSubjectCourse(
  offering: OfferingInfo,
  subject: SubjectInfo,
  filter: ScopeFilter,
  orientationName: string | null,
): Promise<ResolvedSubjectCourse | null> {
  const candidates: Array<{ courseOrientationId: string | null; orientationId: string | null }> = []
  if (filter.courseOrientationId) {
    candidates.push({ courseOrientationId: filter.courseOrientationId, orientationId: null })
  }
  if (filter.orientationId) {
    candidates.push({ courseOrientationId: null, orientationId: filter.orientationId })
  }
  candidates.push({ courseOrientationId: null, orientationId: null })

  for (const candidate of candidates) {
    const scope = resolveMoodleAcademicScope({
      schoolYearId: offering.schoolYearId,
      courseOfferingId: offering.id,
      subjectId: subject.id,
      orientationId: candidate.orientationId,
      courseOrientationId: candidate.courseOrientationId,
    })
    if (!scope) continue
    const moodleCourseId = await getMappedId('SUBJECT_COURSE', scope.idnumber)
    if (moodleCourseId == null) continue

    const withOrientation = !scope.isGeneral && orientationName ? ` - ${orientationName}` : ''
    return {
      subject,
      moodleCourseId,
      courseLabel: `${subject.name} - ${offering.courseName}${withOrientation} (${offering.schoolYearLabel})`,
      effectiveCourseOrientationId: scope.courseOrientationId,
      effectiveOrientationId: scope.orientationId,
    }
  }
  return null
}

async function loadSubject(subjectId: string): Promise<SubjectInfo> {
  const subject = await prisma.subject.findUnique({
    where: { id: subjectId },
    select: { id: true, name: true },
  })
  if (!subject) throw new GradeBridgeError(404, 'Asignatura no encontrada.')
  return subject
}

/**
 * Asignaturas visibles del curso para el ciclo de la oferta (mismos criterios que el selector de
 * asignaturas de la UI): por `SubjectCourseAssignment` (nivel, curso y orientación si se filtró)
 * más las asignaturas legadas ligadas directo al curso.
 */
async function listOfferingSubjects(offering: OfferingInfo, orientationId: string | null): Promise<SubjectInfo[]> {
  const assignmentScope = [
    ...(offering.courseLevel ? [{ level: offering.courseLevel, courseId: null, orientationId: null }] : []),
    { courseId: offering.courseId, orientationId: null },
    ...(orientationId ? [{ courseId: offering.courseId, orientationId }] : []),
  ]
  return prisma.subject.findMany({
    where: {
      isActive: true,
      OR: [
        {
          courseAssignments: {
            some: {
              isActive: true,
              isOffered: true,
              visibleInFilters: true,
              AND: [
                { OR: assignmentScope },
                { OR: [{ schoolYearId: offering.schoolYearId }, { schoolYearId: null }] },
              ],
            },
          },
        },
        { courseId: offering.courseId, OR: [{ courseOfferingId: offering.id }, { courseOfferingId: null }] },
      ],
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true },
  })
}

/** Alumnos ACTIVE de la oferta, con su usuario Moodle ya resuelto (compartido entre hojas). */
type RosterStudent = { name: string; idnumber: string; moodleUserId: number | null }

async function loadRosterStudents(courseOfferingId: string): Promise<RosterStudent[]> {
  const enrolments = await prisma.studentEnrollment.findMany({
    where: { courseOfferingId, enrollmentStatus: 'ACTIVE' },
    select: { student: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: [{ student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }],
  })
  const roster: RosterStudent[] = []
  for (const en of enrolments) {
    const s = en.student
    roster.push({
      name: `${s.lastName}, ${s.firstName}`.trim(),
      idnumber: studentIdnumber(s.id),
      moodleUserId: await getMappedId('STUDENT', s.id),
    })
  }
  return roster
}

/** Roster de una tarea: nota actual y estado de cuenta en ese curso Moodle. */
function buildSheetStudents(
  roster: RosterStudent[],
  enrolledInMoodle: Set<number>,
  currentGrades: Map<number, number>,
): GradeSheetStudent[] {
  return roster.map((s) => ({
    name: s.name,
    idnumber: s.idnumber,
    currentGrade: s.moodleUserId != null ? (currentGrades.get(s.moodleUserId) ?? null) : null,
    hasMoodleAccount: s.moodleUserId != null && enrolledInMoodle.has(s.moodleUserId),
  }))
}

function handleError(res: Response, error: unknown) {
  if (error instanceof GradeBridgeError) {
    return res.status(error.httpStatus).json({ message: error.message })
  }
  const message = error instanceof Error ? error.message : String(error)
  return res.status(502).json({ message: 'Error comunicándose con Moodle.', error: message })
}

const NOT_SYNCED_MESSAGE =
  'El curso todavía no está sincronizado con Moodle. Ejecutá la reconciliación e intentá de nuevo.'

// GET /grades/activities → lista las tareas del curso Moodle de una asignatura.
r.get('/activities', authGuard, requirePermission('courses.manage', 'all'), async (req, res) => {
  const parsed = scopeFilter.extend({ subjectId: z.string().uuid() }).safeParse(req.query)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Parámetros inválidos', errors: parsed.error.errors })
  }
  try {
    const offering = await loadOffering(parsed.data.courseOfferingId)
    const orientationName = await loadOrientationName(offering, parsed.data)
    const subject = await loadSubject(parsed.data.subjectId)
    const resolved = await resolveSubjectCourse(offering, subject, parsed.data, orientationName)
    if (!resolved) throw new GradeBridgeError(409, NOT_SYNCED_MESSAGE)
    const assignments = await listCourseAssignments(resolved.moodleCourseId)
    return res.json({ courseLabel: resolved.courseLabel, assignments })
  } catch (error) {
    return handleError(res, error)
  }
})

/** Arma las hojas (una por tarea) de una asignatura ya resuelta a curso Moodle. */
async function buildSubjectEntries(
  resolved: ResolvedSubjectCourse,
  roster: RosterStudent[],
  assignmentId: number | null,
  singleSubject: boolean,
): Promise<GradeWorkbookEntry[]> {
  const assignments = await listCourseAssignments(resolved.moodleCourseId)
  // Sin tarea puntual sólo van las calificables por puntaje (las de escala/rúbrica no se cargan por planilla).
  const targets =
    assignmentId != null
      ? assignments.filter((a) => a.id === assignmentId)
      : assignments.filter((a) => a.gradeType === 'point')
  if (assignmentId != null && targets.length === 0) {
    throw new GradeBridgeError(404, 'La tarea no existe en el curso Moodle.')
  }
  if (targets.length === 0) return []

  const enrolledInMoodle = await getEnrolledUserIds(resolved.moodleCourseId)
  const entries: GradeWorkbookEntry[] = []
  for (const assignment of targets) {
    const currentGrades = await getAssignmentGrades(assignment.id)
    entries.push({
      courseLabel: resolved.courseLabel,
      assignment,
      students: buildSheetStudents(roster, enrolledInMoodle, currentGrades),
      meta: {
        subjectId: resolved.subject.id,
        assignmentId: assignment.id,
        courseOrientationId: resolved.effectiveCourseOrientationId,
        orientationId: resolved.effectiveOrientationId,
      },
      sheetTitle: singleSubject ? assignment.name : `${resolved.subject.name} - ${assignment.name}`,
    })
  }
  return entries
}

// GET /grades/sheet → descarga el .xlsx. Alcance: curso entero, una asignatura o una tarea puntual.
r.get('/sheet', authGuard, requirePermission('courses.manage', 'all'), async (req, res) => {
  const parsed = scopeFilter
    .extend({ assignmentId: z.coerce.number().int().positive().optional() })
    .safeParse(req.query)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Parámetros inválidos', errors: parsed.error.errors })
  }
  const { assignmentId, ...filter } = parsed.data
  if (assignmentId != null && !filter.subjectId) {
    return res.status(400).json({ message: 'Para filtrar por tarea hay que elegir la asignatura.' })
  }
  try {
    const offering = await loadOffering(filter.courseOfferingId)
    const orientationName = await loadOrientationName(offering, filter)
    const subjects = filter.subjectId
      ? [await loadSubject(filter.subjectId)]
      : await listOfferingSubjects(offering, filter.orientationId ?? null)
    const roster = await loadRosterStudents(offering.id)

    const entries: GradeWorkbookEntry[] = []
    for (const subject of subjects) {
      const resolved = await resolveSubjectCourse(offering, subject, filter, orientationName)
      if (!resolved) {
        if (filter.subjectId) throw new GradeBridgeError(409, NOT_SYNCED_MESSAGE)
        continue // curso amplio: las asignaturas sin curso Moodle no pueden tener notas
      }
      entries.push(...(await buildSubjectEntries(resolved, roster, assignmentId ?? null, Boolean(filter.subjectId))))
    }
    if (entries.length === 0) {
      throw new GradeBridgeError(404, 'No hay tareas Moodle para el alcance elegido.')
    }
    const buffer = await buildGradeWorkbook(entries)

    const scopeName =
      entries.length === 1 ? entries[0].assignment.name : (subjects.length === 1 ? subjects[0].name : offering.courseName)
    const filename = `Notas_${scopeName}`.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`)
    return res.send(buffer)
  } catch (error) {
    return handleError(res, error)
  }
})

const uploadBody = scopeFilter.extend({
  assignmentId: z.number().int().positive().optional(),
  fileBase64: z.string().min(1),
})

/** Extrae los bytes de un data-URL o base64 plano. */
function decodeBase64File(value: string): Buffer {
  const commaIdx = value.indexOf(',')
  const raw = value.startsWith('data:') && commaIdx >= 0 ? value.slice(commaIdx + 1) : value
  return Buffer.from(raw, 'base64')
}

type RowResolution =
  | { skip: true }
  | { error: string }
  | { moodleUserId: number; grade: number }

/** Valida una fila y resuelve el usuario Moodle, o devuelve el motivo de descarte/omisión. */
async function resolveGradeRow(row: ParsedGradeRow, assignment: MoodleAssignment): Promise<RowResolution> {
  if (row.raw === '') return { skip: true } // sin nota cargada
  if (!row.idnumber.startsWith('et-student-')) return { error: `idnumber inválido: "${row.idnumber}"` }
  if (row.grade == null) return { error: `Nota no numérica: "${row.raw}"` }
  if (assignment.maxGrade != null && (row.grade < 0 || row.grade > assignment.maxGrade)) {
    return { error: `Nota fuera de rango (0..${assignment.maxGrade}): ${row.grade}` }
  }
  const studentId = row.idnumber.slice('et-student-'.length)
  const moodleUserId = await getMappedId('STUDENT', studentId)
  if (moodleUserId == null) return { error: 'El alumno no tiene cuenta Moodle sincronizada.' }
  return { moodleUserId, grade: row.grade }
}

/** Escrituras concurrentes a Moodle: la planilla puede tener decenas de alumnos. Un pool acotado
 *  preserva el orden y no satura el WS de Moodle. */
const UPLOAD_CONCURRENCY = 5

type UploadError = { sheet?: string; row?: number; message: string }
type RowOutcome = { ok: boolean; error?: UploadError }

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const i = cursor++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, worker))
  return results
}

/** Resuelve y escribe una fila; nunca lanza (devuelve el desenlace). */
async function pushGradeRow(row: ParsedGradeRow, assignment: MoodleAssignment, assignmentId: number): Promise<RowOutcome> {
  const resolvedRow = await resolveGradeRow(row, assignment)
  if ('skip' in resolvedRow) return { ok: false }
  if ('error' in resolvedRow) return { ok: false, error: { row: row.rowNumber, message: resolvedRow.error } }
  try {
    await saveAssignmentGrade(assignmentId, resolvedRow.moodleUserId, resolvedRow.grade)
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: { row: row.rowNumber, message: `Moodle rechazó la nota: ${message}` } }
  }
}

/** Estado compartido de una subida: cachés por request para no repetir llamadas a Moodle/BD. */
type UploadContext = {
  offering: OfferingInfo
  orientationName: string | null
  subjects: Map<string, SubjectInfo | null>
  resolvedBySubject: Map<string, ResolvedSubjectCourse | null>
  assignmentsByCourse: Map<number, MoodleAssignment[]>
}

async function getSubjectCached(ctx: UploadContext, subjectId: string): Promise<SubjectInfo | null> {
  if (!ctx.subjects.has(subjectId)) {
    const subject = await prisma.subject.findUnique({ where: { id: subjectId }, select: { id: true, name: true } })
    ctx.subjects.set(subjectId, subject)
  }
  return ctx.subjects.get(subjectId) ?? null
}

/** Resuelve la tarea Moodle a la que pertenece una hoja, o el error legible para reportar. */
async function resolveSheetTarget(
  ctx: UploadContext,
  meta: GradeSheetMeta,
): Promise<{ assignment: MoodleAssignment } | { error: string }> {
  const subject = await getSubjectCached(ctx, meta.subjectId)
  if (!subject) return { error: 'La asignatura de la hoja ya no existe.' }

  const scopeKey = `${meta.subjectId}|${meta.courseOrientationId ?? ''}|${meta.orientationId ?? ''}`
  if (!ctx.resolvedBySubject.has(scopeKey)) {
    const filter: ScopeFilter = {
      courseOfferingId: ctx.offering.id,
      subjectId: meta.subjectId,
      courseOrientationId: meta.courseOrientationId ?? undefined,
      orientationId: meta.orientationId ?? undefined,
    }
    ctx.resolvedBySubject.set(scopeKey, await resolveSubjectCourse(ctx.offering, subject, filter, ctx.orientationName))
  }
  const resolved = ctx.resolvedBySubject.get(scopeKey) ?? null
  if (!resolved) return { error: NOT_SYNCED_MESSAGE }

  let assignments = ctx.assignmentsByCourse.get(resolved.moodleCourseId)
  if (!assignments) {
    assignments = await listCourseAssignments(resolved.moodleCourseId)
    ctx.assignmentsByCourse.set(resolved.moodleCourseId, assignments)
  }
  const assignment = assignments.find((a) => a.id === meta.assignmentId)
  if (!assignment) return { error: 'La tarea no existe en el curso Moodle.' }
  if (assignment.gradeType !== 'point') {
    return { error: 'La tarea no usa calificación numérica (escala/rúbrica); no se admite carga por planilla.' }
  }
  return { assignment }
}

/** Metadatos de fallback para planillas viejas sin celda embebida: los filtros del request. */
function fallbackMeta(body: z.infer<typeof uploadBody>): GradeSheetMeta | null {
  if (!body.subjectId || body.assignmentId == null) return null
  return {
    subjectId: body.subjectId,
    assignmentId: body.assignmentId,
    courseOrientationId: body.courseOrientationId ?? null,
    orientationId: body.orientationId ?? null,
  }
}

type SheetOutcome = { processed: boolean; updated: number; errors: UploadError[] }

/** Procesa una hoja de la planilla: resuelve su tarea Moodle y escribe las filas con nota. */
async function pushSheet(
  ctx: UploadContext,
  sheet: ParsedGradeSheet,
  meta: GradeSheetMeta | null,
  sheetTag: string | undefined,
): Promise<SheetOutcome> {
  if (!meta) {
    return {
      processed: false,
      updated: 0,
      errors: [
        {
          sheet: sheetTag,
          message: 'No se pudo identificar la tarea de la hoja: descargá la planilla de nuevo o elegí asignatura y tarea.',
        },
      ],
    }
  }
  const target = await resolveSheetTarget(ctx, meta)
  if ('error' in target) {
    return { processed: false, updated: 0, errors: [{ sheet: sheetTag, message: target.error }] }
  }
  const outcomes = await mapWithConcurrency(sheet.rows, UPLOAD_CONCURRENCY, (row) =>
    pushGradeRow(row, target.assignment, meta.assignmentId),
  )
  return {
    processed: true,
    updated: outcomes.filter((o) => o.ok).length,
    errors: outcomes.flatMap((o) => (o.error ? [{ ...o.error, sheet: sheetTag }] : [])),
  }
}

// POST /grades/sheet/upload → parsea la planilla (una o varias hojas) y escribe las notas en
// Moodle. Cada hoja se identifica por sus metadatos embebidos; los filtros del request sólo se
// usan como fallback para planillas viejas sin metadatos. Tolerante a fallos por hoja y por fila.
r.post('/sheet/upload', authGuard, requirePermission('courses.manage', 'all'), async (req, res) => {
  const parsed = uploadBody.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Parámetros inválidos', errors: parsed.error.errors })
  }
  try {
    const offering = await loadOffering(parsed.data.courseOfferingId)
    const orientationName = await loadOrientationName(offering, parsed.data)
    const sheets = await parseGradeWorkbook(decodeBase64File(parsed.data.fileBase64))
    if (sheets.every((s) => s.rows.length === 0)) {
      throw new GradeBridgeError(400, 'La planilla no tiene filas de alumnos.')
    }

    const ctx: UploadContext = {
      offering,
      orientationName,
      subjects: new Map(),
      resolvedBySubject: new Map(),
      assignmentsByCourse: new Map(),
    }

    const errors: UploadError[] = []
    let updatedCount = 0
    let sheetsProcessed = 0
    const multiSheet = sheets.length > 1
    for (const sheet of sheets) {
      if (sheet.rows.length === 0) continue
      const sheetTag = multiSheet ? sheet.sheetName : undefined
      const outcome = await pushSheet(ctx, sheet, sheet.meta ?? fallbackMeta(parsed.data), sheetTag)
      if (outcome.processed) sheetsProcessed += 1
      updatedCount += outcome.updated
      errors.push(...outcome.errors)
    }

    recordAuditEvent({
      action: AuditAction.MOODLE_GRADES_PUSHED,
      actorUserId: (req as Request & { user?: { id?: string } }).user?.id ?? null,
      req,
      entityType: 'course-offering',
      entityId: offering.id,
      metadata: {
        courseOfferingId: offering.id,
        courseName: offering.courseName,
        subjectId: parsed.data.subjectId ?? null,
        sheetsProcessed,
        updatedCount,
        errorCount: errors.length,
      },
    })

    return res.json({ updatedCount, errors })
  } catch (error) {
    return handleError(res, error)
  }
})

export default r
