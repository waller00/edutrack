import { describe, expect, it } from 'vitest'
import { generateGradeBookPdf, generateStudentReportPdf } from './gradeBookPdf.js'

const META = {
  schoolYearLabel: '2026',
  courseName: '3 EMS',
  orientationName: null,
  subjectName: 'Matemática',
  teacherName: 'Ana G',
}

const STUDENT = {
  lastName: 'Benítez',
  firstName: 'Ana',
  documentId: '1.234.567-8',
  periods: [
    {
      periodName: 'Mayo',
      valueHundredths: 800,
      descriptorLabel: 'Logrado',
      conceptualJudgement: 'Progresa según lo esperado.',
      endorsementStatus: 'Visado',
    },
  ],
}

describe('generateGradeBookPdf', () => {
  it('produce un PDF válido', async () => {
    const buffer = await generateGradeBookPdf({ meta: META, students: [STUDENT], decimals: 0 })
    expect(buffer.length).toBeGreaterThan(500)
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('un grupo vacío igual genera el documento', async () => {
    const buffer = await generateGradeBookPdf({ meta: META, students: [], decimals: 0 })
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('muchos estudiantes no rompen la paginación', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ ...STUDENT, lastName: `Alumno${i}` }))
    const buffer = await generateGradeBookPdf({ meta: META, students: many, decimals: 0 })
    expect(buffer.length).toBeGreaterThan(2000)
  })
})

describe('generateStudentReportPdf', () => {
  it('produce el informe individual', async () => {
    const buffer = await generateStudentReportPdf({ meta: META, student: STUDENT, decimals: 0 })
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('un estudiante sin períodos cerrados no rompe el informe', async () => {
    const buffer = await generateStudentReportPdf({
      meta: META,
      student: { ...STUDENT, periods: [] },
      decimals: 0,
    })
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
  })
})
