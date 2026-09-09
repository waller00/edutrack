import ExcelJS from 'exceljs'
import { addNoDataRow, formatWorksheetForExport } from '../../analytics/exports/excel-format.js'
import { formatGradeValue } from '../../academic-config/grade-value.js'

/**
 * Exportaciones en Excel de la libreta (RF-120).
 *
 * Los valores se escriben como **número**, no como texto: una planilla de notas se ordena y se
 * promedia en Excel, y una columna de strings lo impide. El formato de celda respeta los decimales
 * de la escala.
 */

export type ExportStudent = { studentId: string; lastName: string; firstName: string; documentId: string | null }

export type ExportAssessment = {
  id: string
  title: string
  date: string
  periodName: string | null
  decimals: number
}

export type ExportGrade = {
  assessmentId: string
  studentId: string
  valueHundredths: number | null
  isAbsent: boolean
}

export type GradeBookMeta = {
  schoolYearLabel: string
  courseName: string
  orientationName: string | null
  subjectName: string
  teacherName: string | null
}

function numberFormatFor(decimals: number): string {
  return decimals > 0 ? `0.${'0'.repeat(decimals)}` : '0'
}

/** Encabezado común a todas las hojas: identifica la libreta sin depender del nombre del archivo. */
function writeMetaHeader(sheet: ExcelJS.Worksheet, meta: GradeBookMeta, title: string) {
  sheet.addRow([title])
  sheet.getRow(1).font = { bold: true, size: 14 }
  sheet.addRow([`${meta.subjectName} · ${meta.courseName}${meta.orientationName ? ` — ${meta.orientationName}` : ''}`])
  sheet.addRow([`Ciclo ${meta.schoolYearLabel}${meta.teacherName ? ` · Docente: ${meta.teacherName}` : ''}`])
  sheet.addRow([])
}

/** Valor de celda: número para poder operarlo, o el texto "Ausente" cuando no rindió. */
function gradeCell(grade: ExportGrade | undefined): number | string | null {
  if (!grade) return null
  if (grade.isAbsent) return 'Ausente'
  return grade.valueHundredths == null ? null : grade.valueHundredths / 100
}

/** Excel de calificaciones: una columna por evaluación (RF-120). */
export function buildGradesSheet(
  workbook: ExcelJS.Workbook,
  meta: GradeBookMeta,
  students: readonly ExportStudent[],
  assessments: readonly ExportAssessment[],
  grades: readonly ExportGrade[],
) {
  const sheet = workbook.addWorksheet('Calificaciones')
  writeMetaHeader(sheet, meta, 'Calificaciones')

  const headerRowNumber = 5
  sheet.addRow(['Estudiante', 'Documento', ...assessments.map((a) => `${a.title} (${a.date})`)])

  if (students.length === 0) {
    addNoDataRow(sheet, assessments.length + 2, 'El grupo no tiene estudiantes matriculados.')
  }

  const byKey = new Map(grades.map((g) => [`${g.assessmentId}::${g.studentId}`, g]))
  for (const student of students) {
    const row = sheet.addRow([
      `${student.lastName}, ${student.firstName}`,
      student.documentId ?? '',
      ...assessments.map((a) => gradeCell(byKey.get(`${a.id}::${student.studentId}`))),
    ])
    assessments.forEach((assessment, index) => {
      row.getCell(3 + index).numFmt = numberFormatFor(assessment.decimals)
    })
  }

  formatWorksheetForExport(sheet, { headerRow: headerRowNumber })
  return sheet
}

export type ExportClosureRow = {
  studentId: string
  lastName: string
  firstName: string
  documentId: string | null
  valueHundredths: number | null
  descriptorLabel: string | null
  conceptualJudgement: string | null
}

/** Excel de cierre: calificación general, descriptor y juicio conceptual (RF-120). */
export function buildClosureSheet(
  workbook: ExcelJS.Workbook,
  meta: GradeBookMeta,
  periodName: string,
  rows: readonly ExportClosureRow[],
  decimals: number,
) {
  const sheet = workbook.addWorksheet(`Cierre ${periodName}`.slice(0, 31))
  writeMetaHeader(sheet, meta, `Cierre de período — ${periodName}`)

  const headerRowNumber = 5
  sheet.addRow(['Estudiante', 'Documento', 'Calificación', 'Descriptor', 'Juicio conceptual'])

  if (rows.length === 0) {
    addNoDataRow(sheet, 5, 'No hay estudiantes con cierre cargado.')
  }

  for (const row of rows) {
    const added = sheet.addRow([
      `${row.lastName}, ${row.firstName}`,
      row.documentId ?? '',
      row.valueHundredths == null ? null : row.valueHundredths / 100,
      row.descriptorLabel ?? '',
      row.conceptualJudgement ?? '',
    ])
    added.getCell(3).numFmt = numberFormatFor(decimals)
  }

  formatWorksheetForExport(sheet, { headerRow: headerRowNumber })
  return sheet
}

export type ConsolidatedRow = {
  lastName: string
  firstName: string
  /** Calificación por asignatura, en centésimos; `null` es pendiente. */
  bySubject: Record<string, number | null>
  averageHundredths: number | null
}

/** Planilla consolidada del grupo: Estudiante × Asignatura (RF-120). */
export function buildConsolidatedSheet(
  workbook: ExcelJS.Workbook,
  title: string,
  subjects: readonly string[],
  rows: readonly ConsolidatedRow[],
  decimals: number,
) {
  const sheet = workbook.addWorksheet('Consolidado')
  sheet.addRow([title])
  sheet.getRow(1).font = { bold: true, size: 14 }
  sheet.addRow([])

  const headerRowNumber = 3
  sheet.addRow(['Estudiante', ...subjects, 'Promedio orientativo'])

  if (rows.length === 0) {
    addNoDataRow(sheet, subjects.length + 2, 'El grupo no tiene estudiantes matriculados.')
  }

  for (const row of rows) {
    const added = sheet.addRow([
      `${row.lastName}, ${row.firstName}`,
      ...subjects.map((subject) => {
        const value = row.bySubject[subject]
        return value == null ? null : value / 100
      }),
      row.averageHundredths == null ? null : row.averageHundredths / 100,
    ])
    for (let i = 0; i < subjects.length + 1; i++) {
      added.getCell(2 + i).numFmt = numberFormatFor(decimals)
    }
  }

  formatWorksheetForExport(sheet, { headerRow: headerRowNumber })
  return sheet
}

/** Texto del valor para el PDF, donde no hay formato de celda que valga. */
export function displayValue(valueHundredths: number | null, decimals: number): string {
  return formatGradeValue(valueHundredths, decimals) ?? '—'
}

export type StudentEvaluationExportRow = {
  periodName: string
  date: string | null
  concept: string
  valueHundredths: number | null
  isAbsent: boolean
  comment: string | null
  decimals: number
}

/**
 * Excel de evaluaciones de un solo alumno (vista tipo libreta de orales/escritos).
 * Una fila por calificación, ordenada por período y fecha.
 */
export function buildStudentEvaluationsSheet(
  workbook: ExcelJS.Workbook,
  meta: GradeBookMeta,
  student: ExportStudent,
  rows: readonly StudentEvaluationExportRow[],
) {
  const sheet = workbook.addWorksheet('Evaluaciones')
  writeMetaHeader(sheet, meta, `Evaluaciones: ${meta.subjectName}`)
  sheet.addRow([`${student.lastName}, ${student.firstName}${student.documentId ? ` · CI ${student.documentId}` : ''}`])
  sheet.addRow([])

  const headerRowNumber = 6
  sheet.addRow(['Apellidos', 'Nombres', 'Documento', 'Entrega', 'Fecha', 'Concepto', 'Nota/Inas', 'Juicio/Comentario'])

  if (rows.length === 0) {
    addNoDataRow(sheet, 8, 'El estudiante no tiene calificaciones en esta libreta.')
  }

  for (const row of rows) {
    const added = sheet.addRow([
      student.lastName,
      student.firstName,
      student.documentId ?? '',
      row.periodName,
      row.date ?? '',
      row.concept,
      row.isAbsent ? 'Ausente' : row.valueHundredths == null ? null : row.valueHundredths / 100,
      row.comment ?? '',
    ])
    if (!row.isAbsent && row.valueHundredths != null) {
      added.getCell(7).numFmt = numberFormatFor(row.decimals)
    }
  }

  formatWorksheetForExport(sheet, { headerRow: headerRowNumber })
  return sheet
}
