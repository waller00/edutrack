import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../db/prisma.js'
import { isMoodleIntegrationEnabled } from '../../integrations/moodle/client.js'
import { getMappedId } from '../../integrations/moodle/object-map.js'
import { resolveMoodleAcademicScope } from '../../integrations/moodle/scope.js'
import { fetchCourseGradeReport, type MoodleGradeItem } from '../../integrations/moodle/gradebook.js'
import { GradingError } from './grading.js'

/**
 * Importación Moodle → libreta.
 *
 * EduTrack es la fuente de verdad: Moodle **aporta** notas, nunca las pisa. Por eso el circuito es
 * en dos pasos —previsualizar y confirmar— y nunca toca un período cerrado.
 */

/**
 * Qué le pasa a la nota de un alumno al importar.
 *
 * - `NEW`: no tenía nota en la evaluación; se crea.
 * - `UPDATE`: la nota es la que trajo Moodle y allá cambió; se actualiza.
 * - `UNCHANGED`: ya tiene ese valor.
 * - `EDITED_IN_EDUTRACK`: alguien la corrigió en la libreta después de importar; no se toca.
 */
export type ImportRowStatus = 'NEW' | 'UPDATE' | 'UNCHANGED' | 'EDITED_IN_EDUTRACK'

export type ImportRow = {
  studentId: string
  /** Nota cruda en Moodle, en la escala del ítem. */
  moodleRaw: number
  /** La misma nota convertida a la escala destino, en centésimos. */
  valueHundredths: number
  /** Lo que tiene hoy en la libreta (`null` si no tiene nota). */
  currentValueHundredths: number | null
  status: ImportRowStatus
}

export type ImportPreviewRow = ImportRow & { studentName: string }

export type ImportSummary = { new: number; update: number; unchanged: number; editedInEduTrack: number }

export type ImportPreviewItem = {
  moodleGradeItemId: number
  name: string
  moodleMin: number
  moodleMax: number
  /** Evaluación existente que este ítem ya generó (reimportación). */
  existingAssessmentId: string | null
  /** Alumnos con nota en Moodle que existen en la cohorte. */
  matched: number
  /** Notas de Moodle que no se pudieron mapear a un estudiante del grupo. */
  unmatched: number
  /** Sólo con escala destino: alumno por alumno, lo mismo que va a hacer la importación. */
  rows?: ImportPreviewRow[]
  summary?: ImportSummary
}

export type ImportPreview = {
  moodleCourseId: number
  items: ImportPreviewItem[]
  /** Alumnos del grupo sin cuenta Moodle sincronizada. */
  studentsWithoutMoodleAccount: number
}

/**
 * Convierte una nota de la escala de Moodle a la de la evaluación.
 *
 * Moodle suele puntuar sobre 100 y la libreta sobre 12 o 10, así que copiar el crudo daría un 80
 * en una escala de 1 a 12. La conversión es **lineal y proporcional**, y el docente la ve en la
 * previsualización antes de confirmar: es una sugerencia, no una decisión del sistema.
 */
export function rescaleToTarget(
  raw: number,
  source: { min: number; max: number },
  target: { minHundredths: number; maxHundredths: number },
): number {
  const span = source.max - source.min
  // Un ítem sin rango (min = max) no se puede proyectar: se lleva al mínimo del destino.
  if (span <= 0) return target.minHundredths
  const ratio = (raw - source.min) / span
  const clamped = Math.min(Math.max(ratio, 0), 1)
  return Math.round(target.minHundredths + clamped * (target.maxHundredths - target.minHundredths))
}

/** Curso Moodle de la libreta, o `null` si esa asignatura no está sincronizada. */
export async function resolveMoodleCourseId(gradeBook: {
  schoolYearId: string
  courseOfferingId: string
  subjectId: string
  orientationId: string | null
  courseOrientationId: string | null
}): Promise<number | null> {
  const scope = resolveMoodleAcademicScope(gradeBook)
  if (!scope) return null
  return getMappedId('SUBJECT_COURSE', scope.idnumber)
}

/** `et-student-<uuid>` → `<uuid>`. Es el idnumber que escribe `student-users.ts`. */
export function studentIdFromIdnumber(idnumber: string | null): string | null {
  if (!idnumber) return null
  const match = /^et-student-(.+)$/.exec(idnumber)
  return match ? match[1] : null
}

/**
 * Mapea los usuarios Moodle del reporte a estudiantes de EduTrack.
 *
 * Se prefiere el `idnumber` (`et-student-<uuid>`) porque viaja en la misma respuesta y evita una
 * consulta; el mapeo persistente queda como respaldo para las cuentas que lo perdieron.
 */
export async function mapMoodleUsersToStudents(
  rows: ReadonlyArray<{ moodleUserId: number; idnumber: string | null }>,
  db: PrismaClient = defaultPrisma,
): Promise<Map<number, string>> {
  const byMoodleUser = new Map<number, string>()
  const pending: number[] = []

  for (const row of rows) {
    if (byMoodleUser.has(row.moodleUserId)) continue
    const fromIdnumber = studentIdFromIdnumber(row.idnumber)
    if (fromIdnumber) byMoodleUser.set(row.moodleUserId, fromIdnumber)
    else pending.push(row.moodleUserId)
  }

  if (pending.length > 0) {
    const mappings = await db.moodleObjectMap.findMany({
      where: { objectType: 'STUDENT', moodleId: { in: pending } },
      select: { localId: true, moodleId: true },
    })
    for (const mapping of mappings) byMoodleUser.set(mapping.moodleId, mapping.localId)
  }

  return byMoodleUser
}

export type GradeBookRef = {
  id: string
  schoolYearId: string
  courseOfferingId: string
  subjectId: string
  orientationId: string | null
  courseOrientationId: string | null
}

async function loadReport(gradeBook: GradeBookRef) {
  if (!isMoodleIntegrationEnabled()) {
    throw new GradingError(409, 'MOODLE_DISABLED', 'La integración con Moodle no está configurada.')
  }
  const moodleCourseId = await resolveMoodleCourseId(gradeBook)
  if (moodleCourseId == null) {
    throw new GradingError(
      409,
      'MOODLE_COURSE_NOT_SYNCED',
      'Esta asignatura todavía no tiene curso en Moodle. Corré la reconciliación.',
    )
  }
  return { moodleCourseId, report: await fetchCourseGradeReport(moodleCourseId) }
}

/** Nota de una evaluación ya importada, con lo necesario para saber si se corrigió en la libreta. */
export type ExistingImportedGrade = {
  valueHundredths: number | null
  isAbsent: boolean
  comment: string | null
  importedValueHundredths: number | null
  createdAt: Date
  /** Tiene alguna revisión que no vino de Moodle (la corrigió el docente o administración). */
  hasNonMoodleRevision: boolean
}

/** La evaluación que un ítem de Moodle ya generó y sus notas, por alumno. */
export type ImportedAssessment = {
  createdAt: Date
  grades: ReadonlyMap<string, ExistingImportedGrade>
  /** Alumnos cuya nota alguien borró en la libreta: reimportar no se la vuelve a poner. */
  deletedStudentIds: ReadonlySet<string>
}

/** Las notas que se crearon junto con la evaluación vinieron de esa misma importación. */
const SAME_IMPORT_WINDOW_MS = 5 * 60 * 1000

/**
 * ¿Alguien corrigió esta nota en la libreta después de importarla?
 *
 * Con `importedValueHundredths` es directo: si el valor ya no es el que trajo Moodle (o la marcaron
 * ausente), se corrigió. Las notas importadas antes de que existiera ese campo sólo se toman como de
 * Moodle si se crearon con la evaluación y nadie las cambió desde la libreta; ante la duda, son del
 * docente y no se pisan.
 */
export function isEditedInEduTrack(existing: ExistingImportedGrade, assessmentCreatedAt: Date): boolean {
  if (existing.importedValueHundredths != null) {
    return existing.isAbsent || existing.valueHundredths !== existing.importedValueHundredths
  }
  const createdWithAssessment =
    Math.abs(existing.createdAt.getTime() - assessmentCreatedAt.getTime()) <= SAME_IMPORT_WINDOW_MS
  return !createdWithAssessment || existing.hasNonMoodleRevision
}

export function classifyImportRow(
  studentId: string,
  valueHundredths: number,
  current: ImportedAssessment | null | undefined,
): ImportRowStatus {
  if (!current) return 'NEW'
  const existing = current.grades.get(studentId)
  // Una nota borrada en la libreta tampoco vuelve: borrarla fue corregirla.
  if (!existing) return current.deletedStudentIds.has(studentId) ? 'EDITED_IN_EDUTRACK' : 'NEW'
  if (isEditedInEduTrack(existing, current.createdAt)) return 'EDITED_IN_EDUTRACK'
  return existing.valueHundredths === valueHundredths ? 'UNCHANGED' : 'UPDATE'
}

/** Las evaluaciones que ya generaron estos ítems, con sus notas. Una consulta para todos. */
export async function loadImportedAssessments(
  gradeBookId: string,
  moodleGradeItemIds: readonly number[],
  db: PrismaClient = defaultPrisma,
): Promise<Map<number, ImportedAssessment>> {
  // Sin filtrar `deletedAt`: reimportar revive la evaluación borrada con sus notas.
  const assessments = await db.assessment.findMany({
    where: { gradeBookId, moodleGradeItemId: { in: [...moodleGradeItemIds] } },
    select: {
      id: true,
      moodleGradeItemId: true,
      createdAt: true,
      grades: {
        select: {
          studentId: true,
          valueHundredths: true,
          isAbsent: true,
          comment: true,
          importedValueHundredths: true,
          createdAt: true,
          revisions: { where: { origin: { not: 'MOODLE_IMPORT' } }, select: { id: true }, take: 1 },
        },
      },
    },
  })

  const deleted = await loadDeletedStudentIds(assessments.map((a) => a.id), db)

  const byItem = new Map<number, ImportedAssessment>()
  for (const assessment of assessments) {
    const grades = new Map<string, ExistingImportedGrade>()
    for (const { revisions, studentId, ...grade } of assessment.grades) {
      grades.set(studentId, { ...grade, hasNonMoodleRevision: revisions.length > 0 })
    }
    byItem.set(assessment.moodleGradeItemId!, {
      createdAt: assessment.createdAt,
      grades,
      deletedStudentIds: deleted.get(assessment.id) ?? new Set(),
    })
  }
  return byItem
}

/**
 * Notas borradas en la libreta, por evaluación. Borrar una nota deja su revisión (con evaluación y
 * alumno) y la fila desaparece, así que la revisión queda sin `assessmentGradeId`.
 */
async function loadDeletedStudentIds(
  assessmentIds: readonly string[],
  db: PrismaClient,
): Promise<Map<string, Set<string>>> {
  const byAssessment = new Map<string, Set<string>>()
  if (assessmentIds.length === 0) return byAssessment
  const revisions = await db.gradeRevision.findMany({
    where: { assessmentId: { in: [...assessmentIds] }, assessmentGradeId: null, origin: { not: 'MOODLE_IMPORT' } },
    select: { assessmentId: true, studentId: true },
  })
  for (const { assessmentId, studentId } of revisions) {
    if (!assessmentId || !studentId) continue
    const students = byAssessment.get(assessmentId) ?? new Set<string>()
    students.add(studentId)
    byAssessment.set(assessmentId, students)
  }
  return byAssessment
}

export type ScaleRange = { minHundredths: number; maxHundredths: number }

export type PreviewStudent = { studentId: string; firstName: string; lastName: string }

function summarize(rows: readonly ImportRow[]): ImportSummary {
  const summary: ImportSummary = { new: 0, update: 0, unchanged: 0, editedInEduTrack: 0 }
  for (const row of rows) {
    if (row.status === 'NEW') summary.new++
    else if (row.status === 'UPDATE') summary.update++
    else if (row.status === 'UNCHANGED') summary.unchanged++
    else summary.editedInEduTrack++
  }
  return summary
}

/** Alumno por alumno, con el mismo plan que usa la importación: lo que se ve es lo que se escribe. */
function previewRows(params: {
  item: MoodleGradeItem
  report: { grades: ReadonlyArray<{ moodleUserId: number; itemId: number; raw: number | null }> }
  studentByMoodleUser: ReadonlyMap<number, string>
  students: readonly PreviewStudent[]
  target: ScaleRange
  current: ImportedAssessment | null
}): Pick<ImportPreviewItem, 'rows' | 'summary'> {
  const names = new Map(params.students.map((s) => [s.studentId, `${s.lastName}, ${s.firstName}`]))
  const plan = buildImportPlan({
    item: params.item,
    grades: params.report.grades,
    studentByMoodleUser: params.studentByMoodleUser,
    rosterStudentIds: new Set(names.keys()),
    target: params.target,
    current: params.current,
  })
  const rows = plan.rows
    .map((row) => ({ ...row, studentName: names.get(row.studentId) ?? '' }))
    .sort((a, b) => a.studentName.localeCompare(b.studentName, 'es'))
  return { rows, summary: summarize(plan.rows) }
}

/**
 * Qué traería la importación. Con `target` (la escala destino) trae además cada nota convertida y
 * qué le pasaría; sin escala sólo los conteos.
 */
export async function buildImportPreview(
  gradeBook: GradeBookRef,
  students: readonly PreviewStudent[],
  target: ScaleRange | null,
  db: PrismaClient = defaultPrisma,
): Promise<ImportPreview> {
  const { moodleCourseId, report } = await loadReport(gradeBook)
  const byMoodleUser = await mapMoodleUsersToStudents(report.grades, db)
  const rosterStudentIds = new Set(students.map((s) => s.studentId))
  const imported = target
    ? await loadImportedAssessments(gradeBook.id, report.items.map((item) => item.id), db)
    : new Map<number, ImportedAssessment>()

  const existing = await db.assessment.findMany({
    where: { gradeBookId: gradeBook.id, moodleGradeItemId: { not: null }, deletedAt: null },
    select: { id: true, moodleGradeItemId: true },
  })
  const existingByItem = new Map(existing.map((row) => [row.moodleGradeItemId!, row.id]))

  const items: ImportPreviewItem[] = report.items.map((item) => ({
    moodleGradeItemId: item.id,
    name: item.name,
    moodleMin: item.gradeMin,
    moodleMax: item.gradeMax,
    existingAssessmentId: existingByItem.get(item.id) ?? null,
    ...countMatches(item.id, report.grades, byMoodleUser, rosterStudentIds),
    ...(target
      ? previewRows({
          item,
          report,
          studentByMoodleUser: byMoodleUser,
          students,
          target,
          current: imported.get(item.id) ?? null,
        })
      : {}),
  }))

  const linkedStudentIds = new Set([...byMoodleUser.values()])
  const withoutAccount = [...rosterStudentIds].filter((id) => !linkedStudentIds.has(id)).length

  return { moodleCourseId, items, studentsWithoutMoodleAccount: withoutAccount }
}

function countMatches(
  itemId: number,
  grades: ReadonlyArray<{ moodleUserId: number; itemId: number; raw: number | null }>,
  byMoodleUser: ReadonlyMap<number, string>,
  rosterStudentIds: ReadonlySet<string>,
): { matched: number; unmatched: number } {
  let matched = 0
  let unmatched = 0
  for (const grade of grades) {
    if (grade.itemId !== itemId || grade.raw == null) continue
    const studentId = byMoodleUser.get(grade.moodleUserId)
    if (studentId && rosterStudentIds.has(studentId)) matched++
    else unmatched++
  }
  return { matched, unmatched }
}

export type ImportPlanEntry = {
  studentId: string
  valueHundredths: number
  importedValueHundredths: number
  /** Al actualizar una nota ya importada: el comentario que tiene, para no borrarlo. */
  comment?: string | null
  isAbsent?: boolean
}

export type ImportPlan = {
  item: MoodleGradeItem
  /** Cada alumno del grupo con nota en Moodle y qué le pasa (lo muestra la previsualización). */
  rows: ImportRow[]
  /** Lo que se escribe: las notas nuevas y las que se actualizan. */
  entries: ImportPlanEntry[]
  skippedUnmatched: number
  /** Notas que no se importan porque el ítem no tiene rango (mínimo = máximo) y no hay cómo convertirlas. */
  skippedNoRange: number
  /** Notas corregidas en la libreta después de importar: Moodle no las pisa. */
  skippedEditedInEduTrack: number
}

type PlanParams = {
  item: MoodleGradeItem
  grades: ReadonlyArray<{ moodleUserId: number; itemId: number; raw: number | null }>
  studentByMoodleUser: ReadonlyMap<number, string>
  rosterStudentIds: ReadonlySet<string>
  target: ScaleRange
  /** La evaluación que el ítem ya generó, si se importó antes. */
  current?: ImportedAssessment | null
}

function planRow(studentId: string, raw: number, params: PlanParams): ImportRow {
  const valueHundredths = rescaleToTarget(raw, { min: params.item.gradeMin, max: params.item.gradeMax }, params.target)
  const existing = params.current?.grades.get(studentId)
  return {
    studentId,
    moodleRaw: raw,
    valueHundredths,
    currentValueHundredths: existing?.valueHundredths ?? null,
    status: classifyImportRow(studentId, valueHundredths, params.current),
  }
}

function addEntry(plan: ImportPlan, row: ImportRow, existing: ExistingImportedGrade | undefined): void {
  if (row.status === 'EDITED_IN_EDUTRACK') {
    plan.skippedEditedInEduTrack++
    return
  }
  // Sin cambio de nota sólo se escribe para guardar el valor importado en una fila que no lo tenía.
  if (row.status === 'UNCHANGED' && existing?.importedValueHundredths === row.valueHundredths) return
  plan.entries.push({
    studentId: row.studentId,
    valueHundredths: row.valueHundredths,
    importedValueHundredths: row.valueHundredths,
    // Una nota de Moodle no trae comentario: actualizarla no puede borrar el que puso el docente.
    ...(existing ? { comment: existing.comment, isAbsent: false } : {}),
  })
}

/**
 * Arma lo que se va a escribir para un ítem, ya convertido a la escala destino.
 *
 * Sólo entran los alumnos de la cohorte con nota efectiva en Moodle: quien no fue calificado allá
 * no se importa como cero ni como ausente, simplemente no se toca. Y en una reimportación, la nota
 * que alguien corrigió en la libreta tampoco: Moodle aporta notas, nunca pisa las de EduTrack.
 */
export function buildImportPlan(params: PlanParams): ImportPlan {
  const plan: ImportPlan = {
    item: params.item,
    rows: [],
    entries: [],
    skippedUnmatched: 0,
    skippedNoRange: 0,
    skippedEditedInEduTrack: 0,
  }
  const graded = params.grades.filter((g) => g.itemId === params.item.id && g.raw != null)

  // Sin rango no hay conversión posible. Antes se importaba como la nota mínima para todo el grupo:
  // un 1 a cada alumno por un ítem que en Moodle quizá ni era numérico. Mejor no tocar nada.
  if (params.item.gradeMax <= params.item.gradeMin) {
    plan.skippedNoRange = graded.length
    return plan
  }

  for (const grade of graded) {
    const studentId = params.studentByMoodleUser.get(grade.moodleUserId)
    if (!studentId || !params.rosterStudentIds.has(studentId)) {
      plan.skippedUnmatched++
      continue
    }
    const row = planRow(studentId, grade.raw!, params)
    plan.rows.push(row)
    addEntry(plan, row, params.current?.grades.get(studentId))
  }

  return plan
}

export { loadReport as loadMoodleReport }
