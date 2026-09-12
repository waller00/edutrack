import { describe, expect, it } from 'vitest'
import {
  completionRequestBody,
  sortByUrgency,
  summarize,
  type GradeBookCompleteness,
} from './completeness.js'

function row(over: Partial<GradeBookCompleteness> = {}): GradeBookCompleteness {
  return {
    gradeBookId: 'gb-1',
    subjectName: 'Matemática',
    courseName: '1 EMS',
    teacherUserId: 'u-1',
    teacherName: 'Ana Benítez',
    periodStatus: 'OPEN',
    rosterSize: 20,
    gradedCount: 20,
    judgedCount: 20,
    requiresJudgement: true,
    ...over,
  }
}

describe('summarize', () => {
  it('una libreta con todo cargado está completa', () => {
    expect(summarize(row())).toMatchObject({ missingGrades: 0, missingJudgements: 0, complete: true })
  })

  it('cuenta cuántos estudiantes faltan, no sólo que falta algo', () => {
    // Adscripción necesita el número para saber si es un olvido o la libreta entera sin tocar.
    const s = summarize(row({ gradedCount: 14, judgedCount: 11 }))
    expect(s.missingGrades).toBe(6)
    expect(s.missingJudgements).toBe(9)
    expect(s.complete).toBe(false)
  })

  it('el juicio no falta si el período no lo exige', () => {
    const s = summarize(row({ judgedCount: 0, requiresJudgement: false }))
    expect(s.missingJudgements).toBe(0)
    expect(s.complete).toBe(true)
  })

  it('un período cerrado cuenta como completo aunque los números no cierren', () => {
    // Si se cerró, pasó por las validaciones de cierre: reclamarle al docente sería ruido.
    expect(summarize(row({ periodStatus: 'CLOSED', gradedCount: 0 })).complete).toBe(true)
  })

  it('no da faltantes negativos si hay más notas que estudiantes del roster', () => {
    // Pasa cuando un alumno se dio de baja después de que le cargaron la nota.
    expect(summarize(row({ rosterSize: 18, gradedCount: 20 })).missingGrades).toBe(0)
  })
})

describe('sortByUrgency', () => {
  it('primero lo que más falta, y lo completo al final', () => {
    const rows = [
      summarize(row({ gradeBookId: 'ok' })),
      summarize(row({ gradeBookId: 'poco', gradedCount: 19, judgedCount: 20 })),
      summarize(row({ gradeBookId: 'mucho', gradedCount: 2, judgedCount: 2 })),
    ]
    expect(sortByUrgency(rows).map((r) => r.gradeBookId)).toEqual(['mucho', 'poco', 'ok'])
  })

  it('a igualdad de faltantes, ordena por asignatura', () => {
    const rows = [
      summarize(row({ gradeBookId: 'b', subjectName: 'Historia', gradedCount: 19, judgedCount: 20 })),
      summarize(row({ gradeBookId: 'a', subjectName: 'Biología', gradedCount: 19, judgedCount: 20 })),
    ]
    expect(sortByUrgency(rows).map((r) => r.subjectName)).toEqual(['Biología', 'Historia'])
  })
})

describe('completionRequestBody', () => {
  it('dice exactamente qué falta, no "revisá tu libreta"', () => {
    const s = summarize(row({ gradedCount: 14, judgedCount: 11 }))
    expect(completionRequestBody(s, 'Mayo')).toBe('Mayo: 6 sin calificación y 9 sin juicio conceptual.')
  })

  it('nombra sólo lo que falta', () => {
    expect(completionRequestBody(summarize(row({ gradedCount: 18 })), 'Mayo')).toBe(
      'Mayo: 2 sin calificación.',
    )
    expect(completionRequestBody(summarize(row({ judgedCount: 18 })), 'Mayo')).toBe(
      'Mayo: 2 sin juicio conceptual.',
    )
  })

  it('si no falta nada lo dice, en vez de mandar un aviso vacío', () => {
    expect(completionRequestBody(summarize(row()), 'Mayo')).toBe('Mayo: la libreta está completa.')
  })
})
