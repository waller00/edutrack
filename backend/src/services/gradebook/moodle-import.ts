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

export async function buildImportPreview(
  gradeBook: GradeBookRef,
  rosterStudentIds: ReadonlySet<string>,
  db: PrismaClient = defaultPrisma,
): Promise<ImportPreview> {
  const { moodleCourseId, report } = await loadReport(gradeBook)
  const byMoodleUser = await mapMoodleUsersToStudents(report.grades, db)

  const existing = await db.assessment.findMany({
    where: { gradeBookId: gradeBook.id, moodleGradeItemId: { not: null }, deletedAt: null },
    select: { id: true, moodleGradeItemId: true },
  })
  const existingByItem = new Map(existing.map((row) => [row.moodleGradeItemId!, row.id]))

  const items: ImportPreviewItem[] = report.items.map((item) => {
    let matched = 0
    let unmatched = 0
    for (const grade of report.grades) {
      if (grade.itemId !== item.id || grade.raw == null) continue
      const studentId = byMoodleUser.get(grade.moodleUserId)
      if (studentId && rosterStudentIds.has(studentId)) matched++
      else unmatched++
    }
    return {
      moodleGradeItemId: item.id,
      name: item.name,
      moodleMin: item.gradeMin,
      moodleMax: item.gradeMax,
      existingAssessmentId: existingByItem.get(item.id) ?? null,
      matched,
      unmatched,
    }
  })

  const linkedStudentIds = new Set([...byMoodleUser.values()])
  const withoutAccount = [...rosterStudentIds].filter((id) => !linkedStudentIds.has(id)).length

  return { moodleCourseId, items, studentsWithoutMoodleAccount: withoutAccount }
}

export type ImportPlanEntry = {
  studentId: string
  valueHundredths: number
}

export type ImportPlan = {
  item: MoodleGradeItem
  entries: ImportPlanEntry[]
  skippedUnmatched: number
}

/**
 * Arma lo que se va a escribir para un ítem, ya convertido a la escala destino.
 *
 * Sólo entran los alumnos de la cohorte con nota efectiva en Moodle: quien no fue calificado allá
 * no se importa como cero ni como ausente, simplemente no se toca.
 */
export function buildImportPlan(params: {
  item: MoodleGradeItem
  grades: ReadonlyArray<{ moodleUserId: number; itemId: number; raw: number | null }>
  studentByMoodleUser: ReadonlyMap<number, string>
  rosterStudentIds: ReadonlySet<string>
  target: { minHundredths: number; maxHundredths: number }
}): ImportPlan {
  const entries: ImportPlanEntry[] = []
  let skippedUnmatched = 0

  for (const grade of params.grades) {
    if (grade.itemId !== params.item.id || grade.raw == null) continue
    const studentId = params.studentByMoodleUser.get(grade.moodleUserId)
    if (!studentId || !params.rosterStudentIds.has(studentId)) {
      skippedUnmatched++
      continue
    }
    entries.push({
      studentId,
      valueHundredths: rescaleToTarget(
        grade.raw,
        { min: params.item.gradeMin, max: params.item.gradeMax },
        params.target,
      ),
    })
  }

  return { item: params.item, entries, skippedUnmatched }
}

export { loadReport as loadMoodleReport }
