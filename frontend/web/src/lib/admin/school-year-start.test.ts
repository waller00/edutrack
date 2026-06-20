import { describe, expect, it } from 'vitest'
import {
  buildTargetOptionsForPlan,
  countStudentsWithoutTarget,
  courseLabel,
  filterStartStudents,
  orientationKey,
  parseTargetValue,
  sourceGroupKey,
  studentHasValidTarget,
  suggestTargetForAction,
  summarizeClosures,
  summarizeDestinationCounts,
  targetValue,
  type StartDecision,
  type StartPlanPayload,
  type StartPlanStudent,
  type TargetOption,
} from './school-year-start'

const year = (over: Partial<{ id: string; code: number }> = {}) =>
  ({
    id: over.id ?? 'y1',
    code: over.code ?? 2027,
    label: 'Ciclo',
    startsOn: null,
    endsOn: null,
    status: 'PLANNED',
    createdAt: '',
    updatedAt: '',
  }) as StartPlanPayload['target']

const plan: StartPlanPayload = {
  target: year(),
  source: null,
  sourceYears: [],
  courses: [
    {
      id: 'c1',
      name: '1ro',
      code: 'A',
      level: null,
      sortOrder: 0,
      targetOffered: false,
      sourceOffered: true,
      recommended: true,
      orientations: [
        { orientationId: 'o1', name: 'Cs', code: null, sortOrder: 0, targetOffered: false, sourceOffered: true, recommended: true },
      ],
    },
    {
      id: 'c2',
      name: '2do',
      code: 'B',
      level: null,
      sortOrder: 1,
      targetOffered: false,
      sourceOffered: true,
      recommended: true,
      orientations: [],
    },
  ],
  students: [],
}

const student = (over: Partial<StartPlanStudent>): StartPlanStudent => ({
  studentId: over.studentId ?? 's1',
  firstName: over.firstName ?? 'Ana',
  lastName: over.lastName ?? 'García',
  documentId: over.documentId ?? '12345',
  sourceCourseId: over.sourceCourseId ?? 'c1',
  sourceCourseName: over.sourceCourseName ?? '1ro',
  sourceCourseCode: over.sourceCourseCode ?? 'A',
  sourceOrientationId: over.sourceOrientationId ?? null,
  sourceOrientationName: over.sourceOrientationName ?? null,
  sourceOrientationCode: over.sourceOrientationCode ?? null,
  enrollmentStatus: over.enrollmentStatus ?? 'ACTIVE',
})

const options: TargetOption[] = buildTargetOptionsForPlan(plan, new Set(['c1', 'c2']), new Set(['c1:o1']))

describe('targetValue / parseTargetValue', () => {
  it('serializa y parsea ida y vuelta', () => {
    expect(targetValue('c1', 'o1')).toBe('c1:o1')
    expect(targetValue('c2')).toBe('c2')
    expect(targetValue()).toBe('')
    expect(parseTargetValue('c1:o1')).toEqual({ targetCourseId: 'c1', targetOrientationId: 'o1' })
    expect(parseTargetValue('')).toEqual({})
  })
})

describe('courseLabel / orientationKey', () => {
  it('antepone el código si existe, si no usa solo el nombre', () => {
    expect(courseLabel({ name: '1ro', code: 'A' })).toBe('A · 1ro')
    expect(courseLabel({ name: '1ro', code: null })).toBe('1ro')
  })
  it('orientationKey combina curso y orientación', () => {
    expect(orientationKey('c1', 'o1')).toBe('c1:o1')
  })
})

describe('sourceGroupKey · bordes', () => {
  it('usa centinelas cuando faltan curso u orientación', () => {
    expect(sourceGroupKey({ sourceCourseId: null, sourceOrientationId: null })).toBe('none:')
    expect(sourceGroupKey({ sourceCourseId: 'c1', sourceOrientationId: 'o1' })).toBe('c1:o1')
  })
})

describe('buildTargetOptionsForPlan', () => {
  it('genera opción por orientación seleccionada y por curso sin orientación', () => {
    expect(options.map((o) => o.value)).toEqual(['c1:o1', 'c2'])
    expect(options[0].label).toBe('A · 1ro - Cs')
    expect(options[1].label).toBe('B · 2do')
  })
})

describe('suggestTargetForAction', () => {
  it('sugiere el curso siguiente para Pasa y mantiene editable el valor como decisión común', () => {
    expect(suggestTargetForAction(student({ sourceCourseId: 'c1' }), 'PROMOTE', plan, options)).toEqual({
      targetCourseId: 'c2',
    })
  })

  it('sugiere el mismo curso y orientación para Repite', () => {
    expect(
      suggestTargetForAction(student({ sourceCourseId: 'c1', sourceOrientationId: 'o1' }), 'REPEAT', plan, options),
    ).toEqual({ targetCourseId: 'c1', targetOrientationId: 'o1' })
  })

  it('no inventa un destino al promover desde el último curso', () => {
    expect(suggestTargetForAction(student({ sourceCourseId: 'c2' }), 'PROMOTE', plan, options)).toEqual({})
  })
})

describe('filterStartStudents', () => {
  const students = [
    student({ studentId: 's1', lastName: 'García', sourceCourseId: 'c1' }),
    student({ studentId: 's2', lastName: 'Pérez', firstName: 'Beto', documentId: '999', sourceCourseId: 'c2', sourceCourseName: '2do' }),
  ]
  it('filtra por grupo de origen', () => {
    const g = sourceGroupKey(students[1])
    expect(filterStartStudents(students, g, '').map((s) => s.studentId)).toEqual(['s2'])
  })
  it('filtra por búsqueda libre (nombre/documento), case-insensitive', () => {
    expect(filterStartStudents(students, '', 'pérez').map((s) => s.studentId)).toEqual(['s2'])
    expect(filterStartStudents(students, '', '999').map((s) => s.studentId)).toEqual(['s2'])
    expect(filterStartStudents(students, '', '').length).toBe(2)
  })
  it('soporta estudiantes sin documento al buscar', () => {
    const sinDoc = [student({ studentId: 's3', lastName: 'Lopez', documentId: null })]
    expect(filterStartStudents(sinDoc, '', 'lopez').map((s) => s.studentId)).toEqual(['s3'])
    expect(filterStartStudents(sinDoc, '', 'zzz')).toEqual([])
  })
})

describe('studentHasValidTarget / countStudentsWithoutTarget', () => {
  it('las acciones terminales no requieren destino', () => {
    expect(studentHasValidTarget({ action: 'GRADUATED' }, options)).toBe(true)
  })
  it('promover sin destino válido es pendiente', () => {
    expect(studentHasValidTarget({ action: 'PROMOTE' }, options)).toBe(false)
    expect(studentHasValidTarget({ action: 'PROMOTE', targetCourseId: 'c2' }, options)).toBe(true)
    expect(studentHasValidTarget(undefined, options)).toBe(false)
  })
  it('cuenta los pendientes', () => {
    const students = [student({ studentId: 's1' }), student({ studentId: 's2' })]
    const decisions: Record<string, StartDecision> = {
      s1: { action: 'PROMOTE', targetCourseId: 'c2' },
      s2: { action: 'PROMOTE' },
    }
    expect(countStudentsWithoutTarget(students, decisions, options)).toBe(1)
  })
})

describe('summarizeDestinationCounts', () => {
  it('agrupa por clase destino y descarta acciones terminales', () => {
    const students = [student({ studentId: 's1' }), student({ studentId: 's2' }), student({ studentId: 's3' })]
    const decisions: Record<string, StartDecision> = {
      s1: { action: 'PROMOTE', targetCourseId: 'c2' },
      s2: { action: 'REPEAT', targetCourseId: 'c2' },
      s3: { action: 'GRADUATED' },
    }
    const summary = summarizeDestinationCounts(students, decisions, options)
    expect(summary).toEqual([{ value: 'c2', label: 'B · 2do', count: 2 }])
  })
  it('ignora destinos fuera de las opciones y estudiantes sin decisión', () => {
    const students = [student({ studentId: 's1' }), student({ studentId: 's2' })]
    const decisions: Record<string, StartDecision> = {
      s1: { action: 'PROMOTE', targetCourseId: 'cX' }, // destino que no está entre las opciones
    }
    expect(summarizeDestinationCounts(students, decisions, options)).toEqual([])
  })
})

describe('summarizeClosures', () => {
  it('lista solo terminales, ordenados por nombre', () => {
    const students = [
      student({ studentId: 's1', lastName: 'Zeta' }),
      student({ studentId: 's2', lastName: 'Alfa' }),
      student({ studentId: 's3', lastName: 'Beta' }),
    ]
    const decisions: Record<string, StartDecision> = {
      s1: { action: 'WITHDRAWN' },
      s2: { action: 'GRADUATED' },
      s3: { action: 'PROMOTE', targetCourseId: 'c2' },
    }
    const closures = summarizeClosures(students, decisions)
    expect(closures.map((c) => c.name)).toEqual(['Alfa, Ana', 'Zeta, Ana'])
    expect(closures[0].actionLabel).toBe('Egresa')
  })
  it('omite estudiantes sin decisión', () => {
    const students = [student({ studentId: 's1', lastName: 'Sola' })]
    expect(summarizeClosures(students, {})).toEqual([])
  })
})
