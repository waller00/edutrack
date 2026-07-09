import { describe, it, expect } from 'vitest'
import { buildGradeSheet, parseGradeSheet, type GradeSheetStudent } from './gradeSheet.js'
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

describe('buildGradeSheet + parseGradeSheet', () => {
  it('round-trip: preserva idnumbers y notas cargadas', async () => {
    const buffer = await buildGradeSheet({ courseLabel: 'Matemática - 1A', assignment, students })

    // Simular la carga del docente: reabrir y escribir "Nota nueva".
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    const sheet = wb.worksheets[0]
    sheet.getRow(3).getCell(4).value = 95 // Ana
    sheet.getRow(4).getCell(4).value = 60 // Beto
    const filled = Buffer.from(await wb.xlsx.writeBuffer())

    const parsed = await parseGradeSheet(filled)

    expect(parsed).toHaveLength(3)
    expect(parsed[0]).toMatchObject({ idnumber: 'et-student-aaa', grade: 95 })
    expect(parsed[1]).toMatchObject({ idnumber: 'et-student-bbb', grade: 60 })
    // Cora quedó sin nota.
    expect(parsed[2]).toMatchObject({ idnumber: 'et-student-ccc', grade: null, raw: '' })
  })

  it('parsea coma decimal y marca no-numérico como null', async () => {
    const buffer = await buildGradeSheet({ courseLabel: 'X', assignment, students: [students[0]] })
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    wb.worksheets[0].getRow(3).getCell(4).value = '7,5'
    const filled = Buffer.from(await wb.xlsx.writeBuffer())

    const parsed = await parseGradeSheet(filled)
    expect(parsed[0].grade).toBe(7.5)
  })
})
