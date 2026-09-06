import type { GradeRevisionOrigin, PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../db/prisma.js'
import { resolveLevel } from '../academic-config/grade-value.js'

/**
 * Escritura de calificaciones (RF-042, RF-043) con historial de cambios (§6.2, §6.3).
 *
 * Regla central: **nada se sobrescribe en silencio**. Toda escritura que cambie un valor ya
 * cargado deja una fila en `GradeRevision` con el valor anterior, el nuevo, el autor y el origen.
 * El primer registro no genera revisión: no hay nada que reescribir.
 */

export class GradingError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
  }
}

export type IncomingGrade = {
  studentId: string
  /** Valor en centésimos; `null` borra la calificación dejándola "sin calificar". */
  valueHundredths?: number | null
  scaleLevelId?: string | null
  isAbsent?: boolean
  comment?: string | null
}

export type RosterEntry = {
  studentId: string
  studentEnrollmentId: string
  firstName: string
  lastName: string
  documentId: string | null
}

export type ScaleLevelRow = {
  id: string
  minValueHundredths: number
  maxValueHundredths: number
}

export type SaveGradesParams = {
  assessmentId: string
  entries: readonly IncomingGrade[]
  roster: readonly RosterEntry[]
  scale: {
    id: string
    kind: 'NUMERIC' | 'ORDINAL'
    minValueHundredths: number | null
    maxValueHundredths: number | null
    levels: readonly ScaleLevelRow[]
  }
  actorUserId: string
  origin: GradeRevisionOrigin
  /** Motivo de la corrección; obligatorio cuando la escritura es de administración. */
  reason?: string | null
}

export type SaveGradesResult = {
  created: number
  updated: number
  unchanged: number
  revisions: number
}

/**
 * Valida un valor contra la escala de la evaluación.
 *
 * En una escala ordinal (semáforo) el valor tiene que caer exactamente en un tramo; en una
 * numérica alcanza con estar dentro del rango declarado. Un valor fuera de escala no es un
 * detalle cosmético: rompe el descriptor automático y los umbrales de alerta.
 */
export function assertValueWithinScale(
  valueHundredths: number,
  scale: SaveGradesParams['scale'],
): void {
  if (scale.minValueHundredths != null && valueHundredths < scale.minValueHundredths) {
    throw new GradingError(400, 'VALUE_OUT_OF_SCALE', 'La calificación está por debajo del mínimo de la escala.')
  }
  if (scale.maxValueHundredths != null && valueHundredths > scale.maxValueHundredths) {
    throw new GradingError(400, 'VALUE_OUT_OF_SCALE', 'La calificación supera el máximo de la escala.')
  }
  if (scale.kind === 'ORDINAL' && !resolveLevel(valueHundredths, scale.levels)) {
    throw new GradingError(400, 'VALUE_NOT_A_LEVEL', 'La escala sólo admite los valores de sus niveles.')
  }
}

/** Nadie puede calificar a quien no está en el grupo (espeja `STUDENT_NOT_IN_ROSTER` del pase de lista). */
export function assertStudentsInRoster(
  entries: readonly IncomingGrade[],
  roster: readonly RosterEntry[],
): void {
  const allowed = new Set(roster.map((r) => r.studentId))
  const strangers = entries.filter((e) => !allowed.has(e.studentId)).map((e) => e.studentId)
  if (strangers.length > 0) {
    throw new GradingError(
      409,
      'STUDENT_NOT_IN_ROSTER',
      'Hay estudiantes que no pertenecen al grupo de esta libreta.',
      { studentIds: strangers },
    )
  }
}

type ExistingGrade = {
  id: string
  valueHundredths: number | null
  scaleLevelId: string | null
  isAbsent: boolean
}

/** Valores ya resueltos que se van a guardar (con el tramo derivado, no el que mandó el cliente). */
export type ResolvedGrade = {
  valueHundredths: number | null
  scaleLevelId: string | null
  isAbsent: boolean
}

/**
 * ¿Cambia algo respecto de lo guardado? Sin cambio no se escribe ni se deja revisión.
 *
 * Compara contra los valores **ya resueltos**, no contra lo que mandó el cliente: en una escala
 * numérica el front no envía `scaleLevelId` (se deriva del valor), así que comparar el campo
 * crudo daría "cambió" siempre y llenaría el historial de revisiones que no cambian nada.
 */
export function hasChanges(existing: ExistingGrade, resolved: ResolvedGrade): boolean {
  return (
    existing.valueHundredths !== resolved.valueHundredths ||
    existing.scaleLevelId !== resolved.scaleLevelId ||
    existing.isAbsent !== resolved.isAbsent
  )
}

/**
 * Resuelve el tramo que corresponde a un valor numérico, para no depender del cliente.
 * En escalas ordinales el tramo viene explícito; en numéricas se deriva de la escala.
 */
function levelIdFor(incoming: IncomingGrade, scale: SaveGradesParams['scale']): string | null {
  if (incoming.scaleLevelId !== undefined && incoming.scaleLevelId !== null) return incoming.scaleLevelId
  const value = incoming.valueHundredths
  if (value == null) return null
  return resolveLevel(value, scale.levels)?.id ?? null
}

function validateEntries(params: SaveGradesParams): void {
  assertStudentsInRoster(params.entries, params.roster)
  for (const entry of params.entries) {
    if (entry.valueHundredths != null) assertValueWithinScale(entry.valueHundredths, params.scale)
    if (entry.valueHundredths != null && entry.isAbsent) {
      throw new GradingError(
        400,
        'ABSENT_WITH_VALUE',
        'Un estudiante marcado como ausente no puede llevar calificación.',
      )
    }
  }
}

/**
 * Guarda el lote de calificaciones de una evaluación.
 *
 * Va en una transacción: la planilla es una unidad de trabajo del docente, y una escritura a
 * medias dejaría una parte del grupo calificada y la otra no, sin forma de saber cuál.
 */
export async function saveGrades(
  params: SaveGradesParams,
  db: PrismaClient = defaultPrisma,
): Promise<SaveGradesResult> {
  validateEntries(params)

  const rosterById = new Map(params.roster.map((r) => [r.studentId, r]))
  const result: SaveGradesResult = { created: 0, updated: 0, unchanged: 0, revisions: 0 }

  await db.$transaction(async (tx) => {
    const existing = await tx.assessmentGrade.findMany({
      where: { assessmentId: params.assessmentId, studentId: { in: params.entries.map((e) => e.studentId) } },
      select: { id: true, studentId: true, valueHundredths: true, scaleLevelId: true, isAbsent: true },
    })
    const byStudent = new Map(existing.map((row) => [row.studentId, row]))

    for (const entry of params.entries) {
      const student = rosterById.get(entry.studentId)!
      const current = byStudent.get(entry.studentId)
      const data = {
        valueHundredths: entry.valueHundredths ?? null,
        scaleLevelId: levelIdFor(entry, params.scale),
        isAbsent: entry.isAbsent ?? false,
        comment: entry.comment ?? null,
        gradedByUserId: params.actorUserId,
        gradedAt: new Date(),
      }

      if (!current) {
        await tx.assessmentGrade.create({
          data: {
            assessmentId: params.assessmentId,
            studentId: entry.studentId,
            studentEnrollmentId: student.studentEnrollmentId,
            // Snapshot: una baja posterior no reescribe esta calificación.
            studentLastName: student.lastName,
            studentFirstName: student.firstName,
            studentDocumentId: student.documentId,
            ...data,
          },
        })
        result.created++
        continue
      }

      if (!hasChanges(current, data)) {
        result.unchanged++
        continue
      }

      await tx.assessmentGrade.update({ where: { id: current.id }, data })
      await tx.gradeRevision.create({
        data: {
          assessmentGradeId: current.id,
          previousValueHundredths: current.valueHundredths,
          newValueHundredths: data.valueHundredths,
          previousScaleLevelId: current.scaleLevelId,
          newScaleLevelId: data.scaleLevelId,
          previousIsAbsent: current.isAbsent,
          newIsAbsent: data.isAbsent,
          reason: params.reason ?? null,
          origin: params.origin,
          changedByUserId: params.actorUserId,
        },
      })
      result.updated++
      result.revisions++
    }
  })

  return result
}
