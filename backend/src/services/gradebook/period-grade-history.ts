import type { GradeRevisionOrigin, Prisma } from '@prisma/client'
import { periodGradePatch, type PeriodGradeInput } from './period-closure.js'

/**
 * Escritura de C, R, conducta e informe con historial (§6.2).
 *
 * Antes el cierre hacía un `upsert` y listo: la R —la nota oficial— se podía cambiar sin dejar
 * rastro. Ahora cada guardado que corrige algo deja una `PeriodGradeRevision` con lo anterior y
 * lo nuevo.
 */

type Stored = {
  valueHundredths: number | null
  meetingValueHundredths: number | null
  conductValueHundredths: number | null
  conceptualJudgement: string | null
}

export type PeriodGradeRevisionData = {
  previousValueHundredths?: number | null
  newValueHundredths?: number | null
  previousMeetingValueHundredths?: number | null
  newMeetingValueHundredths?: number | null
  previousConductValueHundredths?: number | null
  newConductValueHundredths?: number | null
  judgementChanged: boolean
  previousJudgement?: string | null
  newJudgement?: string | null
}

const NUMERIC_FIELDS = [
  ['valueHundredths', 'previousValueHundredths', 'newValueHundredths'],
  ['meetingValueHundredths', 'previousMeetingValueHundredths', 'newMeetingValueHundredths'],
  ['conductValueHundredths', 'previousConductValueHundredths', 'newConductValueHundredths'],
] as const

const textOf = (value: string | null | undefined) => (value ?? '').trim()

/**
 * Qué del guardado es una corrección: un campo que **ya tenía dato** y cambió (o se borró).
 * Poner un dato por primera vez es cargarlo, no corregirlo, igual que con las notas, donde la
 * primera carga no genera revisión. `null` si no hubo correcciones.
 */
export function periodGradeRevision(previous: Stored | null, patch: PeriodGradeInput): PeriodGradeRevisionData | null {
  if (!previous) return null
  const data: PeriodGradeRevisionData = { judgementChanged: false }
  let changed = false
  for (const [field, before, after] of NUMERIC_FIELDS) {
    if (patch[field] === undefined) continue
    const old = previous[field]
    const next = patch[field] ?? null
    if (old == null || old === next) continue
    data[before] = old
    data[after] = next
    changed = true
  }
  if (patch.conceptualJudgement !== undefined) {
    const old = textOf(previous.conceptualJudgement)
    const next = textOf(patch.conceptualJudgement)
    if (old !== '' && old !== next) {
      data.judgementChanged = true
      data.previousJudgement = previous.conceptualJudgement
      data.newJudgement = patch.conceptualJudgement ?? null
      changed = true
    }
  }
  return changed ? data : null
}

export type PeriodGradeWrite = {
  student: { studentId: string; lastName: string; firstName: string; documentId: string | null }
  entry: PeriodGradeInput
}

/**
 * Guarda las filas de un período dentro de la transacción del llamador, con su historial.
 * Devuelve cuántas correcciones quedaron registradas.
 */
export async function writePeriodGrades(
  tx: Prisma.TransactionClient,
  params: {
    gradeBookPeriodId: string
    rows: readonly PeriodGradeWrite[]
    actorUserId: string | null
    origin: GradeRevisionOrigin
  },
): Promise<number> {
  const existing = await tx.periodGrade.findMany({
    where: { gradeBookPeriodId: params.gradeBookPeriodId, studentId: { in: params.rows.map((r) => r.student.studentId) } },
    select: {
      studentId: true,
      valueHundredths: true,
      meetingValueHundredths: true,
      conductValueHundredths: true,
      conceptualJudgement: true,
    },
  })
  const byStudent = new Map(existing.map((row) => [row.studentId, row]))

  let revisions = 0
  for (const { student, entry } of params.rows) {
    // Parcial: guardar sólo R no borra la C que ya estaba.
    const patch = periodGradePatch(entry)
    const data = { ...patch, updatedByUserId: params.actorUserId }
    await tx.periodGrade.upsert({
      where: { gradeBookPeriodId_studentId: { gradeBookPeriodId: params.gradeBookPeriodId, studentId: student.studentId } },
      update: data,
      create: {
        gradeBookPeriodId: params.gradeBookPeriodId,
        studentId: student.studentId,
        // Snapshot de identidad, igual que en las calificaciones parciales.
        studentLastName: student.lastName,
        studentFirstName: student.firstName,
        studentDocumentId: student.documentId,
        ...data,
      },
    })
    const revision = periodGradeRevision(byStudent.get(student.studentId) ?? null, patch)
    if (!revision) continue
    await tx.periodGradeRevision.create({
      data: {
        gradeBookPeriodId: params.gradeBookPeriodId,
        studentId: student.studentId,
        origin: params.origin,
        changedByUserId: params.actorUserId,
        ...revision,
      },
    })
    revisions += 1
  }
  return revisions
}
