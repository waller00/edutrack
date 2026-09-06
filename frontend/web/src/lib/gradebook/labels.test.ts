import { describe, expect, it } from 'vitest'
import { gradeBookTitle, groupByCourse, studentFullName } from './labels'
import type { GradeBookHeader } from './types'

function header(over: Partial<GradeBookHeader> = {}): GradeBookHeader {
  return {
    id: 'gb-1',
    status: 'ACTIVE',
    schoolYear: { id: 'sy-1', code: 2026, label: '2026' },
    course: { id: 'c-1', name: '3 EMS', code: '3EMS', level: 'EMS' },
    courseOfferingId: 'off-1',
    orientation: null,
    subject: { id: 's-1', name: 'Matemática', code: 'MAT' },
    teacher: null,
    ...over,
  }
}

describe('gradeBookTitle', () => {
  it('sin orientación es asignatura y curso', () => {
    expect(gradeBookTitle(header())).toBe('Matemática · 3 EMS')
  })

  it('con orientación la incluye: es lo que distingue dos libretas del mismo curso', () => {
    const a = gradeBookTitle(header({ orientation: 'Ciencia y Tecnología' }))
    const b = gradeBookTitle(header({ orientation: 'Ciencias de la Vida' }))
    expect(a).toBe('Matemática · 3 EMS — Ciencia y Tecnología')
    expect(a).not.toBe(b)
  })
})

describe('studentFullName', () => {
  it('ordena apellido primero, como se lee la lista', () => {
    expect(studentFullName({ firstName: 'Ana', lastName: 'Benítez' })).toBe('Benítez, Ana')
  })
})

describe('groupByCourse', () => {
  it('junta las libretas del mismo curso conservando el orden de llegada', () => {
    const groups = groupByCourse([
      header({ id: '1', course: { id: 'c1', name: '7 EBI', code: null, level: 'EBI' } }),
      header({ id: '2', course: { id: 'c2', name: '3 EMS', code: null, level: 'EMS' } }),
      header({ id: '3', course: { id: 'c1', name: '7 EBI', code: null, level: 'EBI' } }),
    ])
    expect(groups.map((g) => g.course)).toEqual(['7 EBI', '3 EMS'])
    expect(groups[0].books.map((b) => b.id)).toEqual(['1', '3'])
  })

  it('con lista vacía devuelve lista vacía', () => {
    expect(groupByCourse([])).toEqual([])
  })
})
