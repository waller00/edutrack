import { describe, it, expect } from 'vitest'
import {
  buildGradeWorkbook,
  parseGradeWorkbook,
  type GradeSheetMeta,
  type GradeSheetStudent,
  type GradeWorkbookEntry,
} from './gradeSheet.js'
import type { MoodleAssignment } from '../../integrations/moodle/grades.js'

const assignment: MoodleAssignment = {
  id: 5,
  cmid: 50,
  name: 'Prueba 1',
  maxGrade: 100,
  gradeType: 'point',
}

const students: GradeSheetStudent[] = [
  { name: 'Ana Pérez', idnumber: 'et-student-aaa', currentGrade: 80, hasMoodleAccount: true },
  { name: 'Beto Díaz', idnumber: 'et-student-bbb', currentGrade: null, hasMoodleAccount: true },
  { name: 'Cora Ruiz', idnumber: 'et-student-ccc', currentGrade: null, hasMoodleAccount: false },
]

const meta: GradeSheetMeta = {
  subjectId: 'sub-1',
  assignmentId: 5,
  courseOrientationId: null,
  orientationId: null,
}

function entry(overrides: Partial<GradeWorkbookEntry> = {}): GradeWorkbookEntry {
  return { courseLabel: 'Matemática - 1A', assignment, students, meta, sheetTitle: assignment.name, ...overrides }
}

describe('buildGradeWorkbook + parseGradeWorkbook', () => {
  it('round-trip: preserva metadatos, idnumbers y notas cargadas', async () => {
    const buffer = await buildGradeWorkbook([entry()])

    // Simular la carga del docente: reabrir y escribir "Nota nueva".
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    const sheet = wb.worksheets[0]
    sheet.getRow(3).getCell(4).value = 95 // Ana
    sheet.getRow(4).getCell(4).value = 60 // Beto
    const filled = Buffer.from(await wb.xlsx.writeBuffer())

    const parsed = await parseGradeWorkbook(filled)

    expect(parsed).toHaveLength(1)
    expect(parsed[0].meta).toEqual(meta)
    expect(parsed[0].rows).toHaveLength(3)
    expect(parsed[0].rows[0]).toMatchObject({ idnumber: 'et-student-aaa', grade: 95 })
    expect(parsed[0].rows[1]).toMatchObject({ idnumber: 'et-student-bbb', grade: 60 })
    // Cora quedó sin nota.
    expect(parsed[0].rows[2]).toMatchObject({ idnumber: 'et-student-ccc', grade: null, raw: '' })
  })

  it('varias hojas: nombres únicos y metadatos propios (incl. orientación)', async () => {
    const second: MoodleAssignment = { ...assignment, id: 6, name: 'Prueba 1' }
    const metaB: GradeSheetMeta = { subjectId: 'sub-2', assignmentId: 6, courseOrientationId: 'co-1', orientationId: null }
    const buffer = await buildGradeWorkbook([
      entry(),
      entry({ assignment: second, meta: metaB, sheetTitle: second.name }),
    ])

    const parsed = await parseGradeWorkbook(buffer)
    expect(parsed).toHaveLength(2)
    expect(parsed[0].sheetName).not.toBe(parsed[1].sheetName)
    expect(parsed[0].meta).toEqual(meta)
    expect(parsed[1].meta).toEqual(metaB)
  })

  it('sanea títulos con caracteres inválidos para Excel', async () => {
    const buffer = await buildGradeWorkbook([entry({ sheetTitle: 'Física: repartido [2/3]?*' })])
    const parsed = await parseGradeWorkbook(buffer)
    expect(parsed[0].sheetName).toBe('Física repartido 2 3')
  })

  it('parsea coma decimal y marca no-numérico como null', async () => {
    const buffer = await buildGradeWorkbook([entry({ students: [students[0]] })])
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    wb.worksheets[0].getRow(3).getCell(4).value = '7,5'
    const filled = Buffer.from(await wb.xlsx.writeBuffer())

    const parsed = await parseGradeWorkbook(filled)
    expect(parsed[0].rows[0].grade).toBe(7.5)
  })

  it('planilla externa sin celda de metadatos → meta null, filas igual legibles', async () => {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    const sheet = wb.addWorksheet('Notas')
    sheet.addRow(['Alumno', 'idnumber', 'Nota actual', 'Nota nueva'])
    sheet.addRow(['Ana', 'et-student-aaa', 80, 91])
    const buffer = Buffer.from(await wb.xlsx.writeBuffer())

    const parsed = await parseGradeWorkbook(buffer)
    expect(parsed[0].meta).toBeNull()
    expect(parsed[0].rows[0]).toMatchObject({ idnumber: 'et-student-aaa', grade: 91 })
  })
})
