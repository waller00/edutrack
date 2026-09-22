import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import {
  buildClosureSheet,
  buildConsolidatedSheet,
  buildGradesSheet,
  buildPlanillaSheet,
  displayValue,
  planillaColumns,
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
  it('lleva C, R, descriptor y el texto del período con su nombre', () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = buildClosureSheet(workbook, META, '1.ª Entrega', [
      {
        studentId: 's1', lastName: 'Benítez', firstName: 'Ana', documentId: null,
        valueHundredths: 750, meetingValueHundredths: 800, descriptorLabel: 'Muy bueno',
        conceptualJudgement: 'Progresa bien.',
      },
    ], 1, 'Informe de actuación')

    expect(sheet.getRow(5).values).toEqual([
      undefined, 'Estudiante', 'Documento', 'C (calificación)', 'R (reunión)', 'Descriptor', 'Informe de actuación',
    ])
    expect(cellAt(sheet, 6, 3)).toBe(7.5)
    expect(cellAt(sheet, 6, 4)).toBe(8)
    expect(cellAt(sheet, 6, 5)).toBe('Muy bueno')
    expect(cellAt(sheet, 6, 6)).toBe('Progresa bien.')
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

describe('hoja Planilla', () => {
  const PERIODS = [
    { id: 'diag', name: 'Diagnóstico', kind: 'DIAGNOSTICO' as const, judgementLabel: 'Diagnóstico' },
    { id: 'jul', name: 'Julio', kind: 'TRAMO' as const, judgementLabel: null },
    { id: 'e2', name: '2.ª Entrega', kind: 'ENTREGA' as const, judgementLabel: 'Informe de actuación' },
  ]
  const GRADES = [
    { periodId: 'jul', studentId: 's1', category: 'ORAL' as const, valueHundredths: 700, isAbsent: false },
    { periodId: 'jul', studentId: 's1', category: 'ORAL' as const, valueHundredths: 900, isAbsent: false },
    { periodId: 'jul', studentId: 's1', category: 'PRUEBA' as const, valueHundredths: null, isAbsent: true },
  ]

  it('arma las columnas de cada bloque como la planilla, con Prueba sólo si la hubo', () => {
    expect(planillaColumns(PERIODS, GRADES).map((c) => `${c.periodId}:${c.label}`)).toEqual([
      'diag:Diagnóstico',
      'jul:Or', 'jul:Otras', 'jul:Ev', 'jul:Prueba', 'jul:C', 'jul:R',
      'e2:Informe de actuación', 'e2:C', 'e2:R',
    ])
    expect(planillaColumns(PERIODS, []).some((c) => c.label === 'Prueba')).toBe(false)
  })

  it('las notas sueltas van juntas y sin promediar; C y R como número', () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = buildPlanillaSheet(workbook, META, STUDENTS.slice(0, 1), PERIODS, GRADES, [
      { periodId: 'e2', studentId: 's1', valueHundredths: 700, meetingValueHundredths: 800, conceptualJudgement: 'Avanza.' },
    ], 0)

    expect(cellAt(sheet, 5, 5)).toBe('Julio')
    expect(cellAt(sheet, 6, 1)).toBe('Nº')
    expect(cellAt(sheet, 7, 1)).toBe(1)
    expect(cellAt(sheet, 7, 5)).toBe('7 · 9')
    expect(cellAt(sheet, 7, 8)).toBe('Aus')
    expect(cellAt(sheet, 7, 11)).toBe('Avanza.')
    expect(cellAt(sheet, 7, 12)).toBe(7)
    expect(cellAt(sheet, 7, 13)).toBe(8)
  })
})
