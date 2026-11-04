import { describe, expect, it } from 'vitest'
import { blockerText, blockerTitle, closeErrorText, fixedInGrades, openingMeeting, studentList, type Blocker } from './closure-blockers'

const b = (code: Blocker['code'], n = 1, slots?: number): Blocker => ({ code, studentIds: Array.from({ length: n }, (_, i) => `s${i}`), slots })

describe('lo que falta para cerrar', () => {
  it('cada faltante con su número', () => {
    expect(blockerText(b('MISSING_GRADES', 3))).toBe('3 sin R (rendimiento)')
    expect(blockerText(b('MISSING_CONDUCT'))).toBe('1 sin C (conducta)')
    expect(blockerText(b('MISSING_JUDGEMENT', 2))).toBe('2 sin informe o juicio')
    expect(blockerText(b('MISSING_GROUP_REPORT', 0))).toBe('falta el informe del grupo')
    expect(blockerText(b('NO_ASSESSMENTS', 0))).toBe('no hay evaluaciones en los tramos')
    expect(blockerText(b('STUDENTS_WITHOUT_GRADES', 2))).toBe('2 sin ninguna nota en el tramo')
    expect(blockerText(b('MISSING_ASSESSMENT_GRADES', 2, 5))).toBe('5 notas sin cargar en evaluaciones del grupo (2 estudiantes)')
    expect(blockerText(b('MISSING_ASSESSMENT_GRADES', 1))).toBe('1 nota sin cargar en evaluaciones del grupo (1 estudiante)')
  })

  it('títulos, y lo que se completa en Calificaciones', () => {
    expect(blockerTitle('MISSING_JUDGEMENT', 'Informe')).toBe('Informe')
    expect(blockerTitle('MISSING_JUDGEMENT', '  ')).toBe('Juicio')
    expect(['MISSING_GRADES', 'MISSING_CONDUCT', 'MISSING_GROUP_REPORT', 'NO_ASSESSMENTS', 'STUDENTS_WITHOUT_GRADES', 'MISSING_ASSESSMENT_GRADES'].map((c) => blockerTitle(c as never))).toEqual([
      'R (rendimiento)',
      'C (conducta)',
      'Informe del grupo',
      'Evaluaciones',
      'Sin notas en el tramo',
      'Notas de evaluaciones del grupo',
    ])
    expect(fixedInGrades('MISSING_ASSESSMENT_GRADES')).toBe(true)
    expect(fixedInGrades('MISSING_GRADES')).toBe(false)
  })

  it('el error del cierre dice todo lo que falta junto', () => {
    const err = { data: { message: 'x', detail: { blockers: [b('MISSING_CONDUCT'), b('MISSING_GROUP_REPORT', 0)] } } }
    expect(closeErrorText(err)).toBe('No se puede cerrar todavía: 1 sin C (conducta) · falta el informe del grupo.')
    expect(closeErrorText({ data: { message: 'Ya está cerrada.' } })).toBe('Ya está cerrada.')
    expect(closeErrorText(new Error('Sin conexión'))).toBe('Sin conexión')
    expect(closeErrorText(null)).toBe('No se pudo cerrar')
  })

  it('abre la reunión pedida; si no, la primera sin cerrar o la última', () => {
    const rows = [
      { periodId: 'a', status: 'CLOSED' },
      { periodId: 'b', status: 'OPEN' },
      { periodId: 'c', status: 'OPEN' },
    ]
    expect(openingMeeting(rows, 'c')?.periodId).toBe('c')
    expect(openingMeeting(rows, 'otra')?.periodId).toBe('b')
    expect(openingMeeting([{ periodId: 'a', status: 'CLOSED' }, { periodId: 'z', status: 'CLOSED' }])?.periodId).toBe('z')
    expect(openingMeeting([])).toBeNull()
  })

  it('los nombres, los primeros y cuántos más', () => {
    const students = [
      { studentId: 's0', lastName: 'Pérez', firstName: 'Ana' },
      { studentId: 's1', lastName: 'Gómez', firstName: 'Beto' },
    ]
    expect(studentList(['s0', 's1'], students)).toBe('Pérez, Ana · Gómez, Beto')
    expect(studentList(['s0', 's1', 'x'], students, 1)).toBe('Pérez, Ana y 2 más')
    expect(studentList(['x'], students)).toBe('Alumno')
  })
})
