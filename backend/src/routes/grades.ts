import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { AuditAction } from '@prisma/client'
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
  buildGradeSheet,
  parseGradeSheet,
  type GradeSheetStudent,
  type ParsedGradeRow,
} from '../services/grades/gradeSheet.js'

/**
 * Puente de notas EduTrack↔Moodle: elegir una tarea (`mod_assign`) de un curso, bajar una planilla
 * con el roster + notas actuales, y subirla para escribir las notas de vuelta en Moodle. EduTrack no
 * almacena notas; Moodle es la fuente de verdad. Sólo admin (`courses.manage` / scope ALL).
 */

const r = Router()

const scopeQuery = z.object({
  courseOfferingId: z.string().uuid(),
  subjectId: z.string().uuid(),
  orientationId: z.string().uuid().optional(),
  courseOrientationId: z.string().uuid().optional(),
})

type ScopeInput = z.infer<typeof scopeQuery>

type ResolvedScope = {
  moodleCourseId: number
  courseLabel: string
  input: ScopeInput
}

class GradeBridgeError extends Error {
  constructor(
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message)
  }
}

/** Resuelve el curso Moodle (por asignatura/orientación) y una etiqueta legible, o lanza un error HTTP. */
async function resolveScope(input: ScopeInput): Promise<ResolvedScope> {
  if (!isMoodleIntegrationEnabled()) {
    throw new GradeBridgeError(409, 'La integración con Moodle no está configurada.')
  }

  const offering = await prisma.courseOffering.findUnique({
    where: { id: input.courseOfferingId },
    select: {
      schoolYearId: true,
      course: { select: { name: true } },
      schoolYear: { select: { label: true } },
    },
  })
  if (!offering) throw new GradeBridgeError(404, 'Oferta de curso no encontrada.')

  const subject = await prisma.subject.findUnique({
    where: { id: input.subjectId },
    select: { name: true },
  })
  if (!subject) throw new GradeBridgeError(404, 'Asignatura no encontrada.')

  const scope = resolveMoodleAcademicScope({
    schoolYearId: offering.schoolYearId,
    courseOfferingId: input.courseOfferingId,
    subjectId: input.subjectId,
    orientationId: input.orientationId ?? null,
    courseOrientationId: input.courseOrientationId ?? null,
  })
  if (!scope) throw new GradeBridgeError(400, 'No se pudo resolver el curso Moodle para ese alcance.')

  const moodleCourseId = await getMappedId('SUBJECT_COURSE', scope.idnumber)
  if (moodleCourseId == null) {
    throw new GradeBridgeError(
      409,
      'El curso todavía no está sincronizado con Moodle. Ejecutá la reconciliación e intentá de nuevo.',
    )
  }

  const courseLabel = `${subject.name} - ${offering.course.name} (${offering.schoolYear.label})`
  return { moodleCourseId, courseLabel, input }
}

/** Roster de la tarea: alumnos ACTIVE de la oferta, con su nota actual y estado de cuenta Moodle. */
async function buildRoster(
  resolved: ResolvedScope,
  currentGrades: Map<number, number>,
): Promise<GradeSheetStudent[]> {
  const enrolments = await prisma.studentEnrollment.findMany({
    where: { courseOfferingId: resolved.input.courseOfferingId, enrollmentStatus: 'ACTIVE' },
    select: { student: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: [{ student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }],
  })

  const enrolledInMoodle = await getEnrolledUserIds(resolved.moodleCourseId)

  const roster: GradeSheetStudent[] = []
  for (const en of enrolments) {
    const s = en.student
    const moodleUserId = await getMappedId('STUDENT', s.id)
    const hasMoodleAccount = moodleUserId != null && enrolledInMoodle.has(moodleUserId)
    roster.push({
      name: `${s.lastName}, ${s.firstName}`.trim(),
      idnumber: studentIdnumber(s.id),
      currentGrade: moodleUserId != null ? (currentGrades.get(moodleUserId) ?? null) : null,
      hasMoodleAccount,
    })
  }
  return roster
}

async function resolveAssignment(
  moodleCourseId: number,
  assignmentId: number,
): Promise<MoodleAssignment> {
  const assignments = await listCourseAssignments(moodleCourseId)
  const assignment = assignments.find((a) => a.id === assignmentId)
  if (!assignment) throw new GradeBridgeError(404, 'La tarea no existe en el curso Moodle.')
  return assignment
}

function handleError(res: Response, error: unknown) {
  if (error instanceof GradeBridgeError) {
    return res.status(error.httpStatus).json({ message: error.message })
  }
  const message = error instanceof Error ? error.message : String(error)
  return res.status(502).json({ message: 'Error comunicándose con Moodle.', error: message })
}

// GET /grades/activities → lista las tareas del curso Moodle del alcance dado.
r.get('/activities', authGuard, requirePermission('courses.manage', 'all'), async (req, res) => {
  const parsed = scopeQuery.safeParse(req.query)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Parámetros inválidos', errors: parsed.error.errors })
  }
  try {
    const resolved = await resolveScope(parsed.data)
    const assignments = await listCourseAssignments(resolved.moodleCourseId)
    return res.json({ courseLabel: resolved.courseLabel, assignments })
  } catch (error) {
    return handleError(res, error)
  }
})

// GET /grades/sheet → descarga el .xlsx con roster + notas actuales.
r.get('/sheet', authGuard, requirePermission('courses.manage', 'all'), async (req, res) => {
  const parsed = scopeQuery.extend({ assignmentId: z.coerce.number().int().positive() }).safeParse(req.query)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Parámetros inválidos', errors: parsed.error.errors })
  }
  try {
    const { assignmentId, ...scopeInput } = parsed.data
    const resolved = await resolveScope(scopeInput)
    const assignment = await resolveAssignment(resolved.moodleCourseId, assignmentId)
    const currentGrades = await getAssignmentGrades(assignmentId)
    const students = await buildRoster(resolved, currentGrades)
    const buffer = await buildGradeSheet({ courseLabel: resolved.courseLabel, assignment, students })

    const filename = `Notas_${assignment.name}`.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`)
    return res.send(buffer)
  } catch (error) {
    return handleError(res, error)
  }
})

const uploadBody = scopeQuery.extend({
  assignmentId: z.number().int().positive(),
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

/** Escrituras concurrentes a Moodle: la planilla puede tener decenas de alumnos y `api()` del
 *  front aborta a los 12s. Un pool acotado preserva el orden y no satura el WS de Moodle. */
const UPLOAD_CONCURRENCY = 5

type RowOutcome = { ok: boolean; error?: { row: number; message: string } }

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

// POST /grades/sheet/upload → parsea la planilla y escribe las notas en Moodle (por fila, tolerante a fallos).
r.post('/sheet/upload', authGuard, requirePermission('courses.manage', 'all'), async (req, res) => {
  const parsed = uploadBody.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Parámetros inválidos', errors: parsed.error.errors })
  }
  try {
    const { assignmentId, fileBase64, ...scopeInput } = parsed.data
    const resolved = await resolveScope(scopeInput)
    const assignment = await resolveAssignment(resolved.moodleCourseId, assignmentId)

    if (assignment.gradeType !== 'point') {
      throw new GradeBridgeError(
        422,
        'La tarea no usa calificación numérica (escala/rúbrica); no se admite carga por planilla.',
      )
    }

    const rows = await parseGradeSheet(decodeBase64File(fileBase64))
    const outcomes = await mapWithConcurrency(rows, UPLOAD_CONCURRENCY, (row) =>
      pushGradeRow(row, assignment, assignmentId),
    )
    const errors = outcomes.flatMap((o) => (o.error ? [o.error] : []))
    const updatedCount = outcomes.filter((o) => o.ok).length

    recordAuditEvent({
      action: AuditAction.MOODLE_GRADES_PUSHED,
      actorUserId: (req as Request & { user?: { id?: string } }).user?.id ?? null,
      req,
      entityType: 'moodle-assignment',
      entityId: String(assignmentId),
      metadata: {
        courseLabel: resolved.courseLabel,
        assignmentName: assignment.name,
        courseOfferingId: scopeInput.courseOfferingId,
        subjectId: scopeInput.subjectId,
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
