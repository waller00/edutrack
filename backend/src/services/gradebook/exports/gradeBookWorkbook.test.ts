import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import {
  buildClosureSheet,
  buildConsolidatedSheet,
  buildGradesSheet,
  displayValue,
} from './gradeBookWorkbook.js'

const META = {
  schoolYearLabel: '2026',
  courseName: '3 EMS',
  orientationName: 'Ciencias de la Vida',
  subjectName: 'Matemática',
  teacherName: 'Ana G',
}

const STUDENTS = [
  { studentId: 's1', lastName: 'Benítez', firstName: 'Ana', documentId: '1.234.567-8' },
  { studentId: 's2', lastName: 'Cardozo', firstName: 'Beto', documentId: null },
]

const ASSESSMENTS = [
  { id: 'a1', title: 'Escrito 1', date: '2026-05-10', periodName: 'Mayo', decimals: 0 },
  { id: 'a2', title: 'Oral', date: '2026-05-20', periodName: 'Mayo', decimals: 1 },
]

function cellAt(sheet: ExcelJS.Worksheet, row: number, col: number) {
  return sheet.getRow(row).getCell(col).value
}

describe('buildGradesSheet', () => {
  const workbook = new ExcelJS.Workbook()
  const sheet = buildGradesSheet(workbook, META, STUDENTS, ASSESSMENTS, [
    { assessmentId: 'a1', studentId: 's1', valueHundredths: 800, isAbsent: false },
    { assessmentId: 'a2', studentId: 's1', valueHundredths: null, isAbsent: true },
  ])

  it('identifica la libreta en el encabezado, sin depender del nombre del archivo', () => {
    expect(String(cellAt(sheet, 2, 1))).toContain('Matemática · 3 EMS — Ciencias de la Vida')
    expect(String(cellAt(sheet, 3, 1))).toContain('Ciclo 2026')
  })

  it('una columna por evaluación, con su fecha', () => {
    expect(cellAt(sheet, 5, 3)).toBe('Escrito 1 (2026-05-10)')
    expect(cellAt(sheet, 5, 4)).toBe('Oral (2026-05-20)')
  })

  it('la nota va como NÚMERO, para poder ordenar y promediar en Excel', () => {
    expect(cellAt(sheet, 6, 3)).toBe(8)
    expect(typeof cellAt(sheet, 6, 3)).toBe('number')
  })

  it('el ausente se distingue del sin calificar', () => {
    expect(cellAt(sheet, 6, 4)).toBe('Ausente')
    expect(cellAt(sheet, 7, 3)).toBeNull()
  })

  it('respeta los decimales declarados por cada evaluación', () => {
    expect(sheet.getRow(6).getCell(3).numFmt).toBe('0')
    expect(sheet.getRow(6).getCell(4).numFmt).toBe('0.0')
  })

  it('un grupo vacío explica por qué, en vez de dejar la hoja en blanco', () => {
    const wb = new ExcelJS.Workbook()
    const empty = buildGradesSheet(wb, META, [], ASSESSMENTS, [])
    expect(String(cellAt(empty, 6, 1))).toContain('no tiene estudiantes')
  })
})

describe('buildClosureSheet', () => {
  it('lleva calificación, descriptor y juicio conceptual', () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = buildClosureSheet(workbook, META, 'Mayo', [
      {
        studentId: 's1', lastName: 'Benítez', firstName: 'Ana', documentId: null,
        valueHundredths: 750, descriptorLabel: 'Logrado', conceptualJudgement: 'Progresa bien.',
      },
    ], 1)

    expect(cellAt(sheet, 5, 3)).toBe('Calificación')
    expect(cellAt(sheet, 6, 3)).toBe(7.5)
    expect(cellAt(sheet, 6, 4)).toBe('Logrado')
    expect(cellAt(sheet, 6, 5)).toBe('Progresa bien.')
  })

  it('el nombre de la hoja respeta el límite de Excel', () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = buildClosureSheet(workbook, META, 'Un período con un nombre larguísimo', [], 0)
    expect(sheet.name.length).toBeLessThanOrEqual(31)
  })
})

describe('buildConsolidatedSheet', () => {
  it('arma la matriz Estudiante × Asignatura con el promedio', () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = buildConsolidatedSheet(workbook, '3 EMS — Mayo', ['Matemática', 'Historia'], [
      { lastName: 'B', firstName: 'Ana', bySubject: { 'Matemática': 800, Historia: null }, averageHundredths: 800 },
    ], 0)

    expect(cellAt(sheet, 3, 2)).toBe('Matemática')
    expect(cellAt(sheet, 3, 4)).toBe('Promedio orientativo')
    expect(cellAt(sheet, 4, 2)).toBe(8)
    // Una asignatura pendiente queda vacía, no en cero.
    expect(cellAt(sheet, 4, 3)).toBeNull()
    expect(cellAt(sheet, 4, 4)).toBe(8)
  })
})

describe('displayValue', () => {
  it('formatea con coma y marca el vacío', () => {
    expect(displayValue(750, 1)).toBe('7,5')
    expect(displayValue(null, 0)).toBe('—')
  })
})
