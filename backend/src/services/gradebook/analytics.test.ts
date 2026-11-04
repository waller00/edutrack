import { describe, expect, it } from 'vitest'
import {
  buildComparison,
  distributionByLevel,
  lowSubjectsHistogram,
  referencePeriod,
  studentSnapshots,
  valuesAt,
  type AnalyticsState,
  maxDrop,
  mean,
  median,
  performanceBlock,
  studentTrend,
  studentsBlock,
  triggeredAlerts,
  type AlertRule,
  type LevelRow,
  type StudentSnapshot,
} from './analytics.js'

const LEVELS: LevelRow[] = [
  { id: 'bajo', label: 'Insuficiente', minValueHundredths: 100, maxValueHundredths: 599, colorToken: 'red', iconToken: 'alert-triangle', isPassing: false, isAlert: true },
  { id: 'medio', label: 'Aceptable', minValueHundredths: 600, maxValueHundredths: 899, colorToken: 'green', iconToken: 'check', isPassing: true, isAlert: false },
  { id: 'alto', label: 'Destacado', minValueHundredths: 900, maxValueHundredths: 1200, colorToken: 'emerald', iconToken: 'star', isPassing: true, isAlert: false },
]

function student(over: Partial<StudentSnapshot> = {}): StudentSnapshot {
  return {
    studentId: 's1', lastName: 'B', firstName: 'Ana',
    subjectValues: [700, 800], periodValues: [700, 800], assessmentCount: 3,
    ...over,
  }
}

describe('mean y median', () => {
  it('promedian y ordenan en centésimos', () => {
    expect(mean([600, 700, 800])).toBe(700)
    expect(median([600, 700, 800])).toBe(700)
  })

  it('la mediana con cantidad par promedia los dos centrales', () => {
    expect(median([600, 700, 800, 900])).toBe(750)
  })

  it('la mediana NO se mueve con un valor extremo, el promedio sí', () => {
    // Es justamente por eso que el pliego pide las dos.
    expect(median([700, 700, 700, 700, 100])).toBe(700)
    expect(mean([700, 700, 700, 700, 100])).toBe(580)
  })

  it('sin datos devuelven null, no cero', () => {
    expect(mean([])).toBeNull()
    expect(median([])).toBeNull()
  })
})

describe('distributionByLevel', () => {
  it('cuenta y porcentúa por tramo', () => {
    const dist = distributionByLevel([300, 700, 700, 1000], LEVELS)
    expect(dist.map((d) => d.count)).toEqual([1, 2, 1])
    expect(dist.map((d) => d.percentage)).toEqual([25, 50, 25])
  })

  it('devuelve TODOS los tramos, incluso los vacíos', () => {
    // Un histograma sin las barras en cero miente sobre la forma de la distribución.
    const dist = distributionByLevel([700], LEVELS)
    expect(dist).toHaveLength(3)
    expect(dist[0].count).toBe(0)
  })

  it('ignora valores fuera de toda escala sin romper los porcentajes', () => {
    const dist = distributionByLevel([700, 9999], LEVELS)
    expect(dist.find((d) => d.levelId === 'medio')?.percentage).toBe(100)
  })

  it('sin datos no divide por cero', () => {
    expect(distributionByLevel([], LEVELS).every((d) => d.percentage === 0)).toBe(true)
  })
})

describe('studentTrend', () => {
  it('compara punta a punta', () => {
    expect(studentTrend([600, 500, 900])).toBe('IMPROVED')
    expect(studentTrend([900, 950, 600])).toBe('DECLINED')
    expect(studentTrend([700, 700])).toBe('STABLE')
  })

  it('con un solo punto no hay tendencia', () => {
    expect(studentTrend([700])).toBe('NO_DATA')
    expect(studentTrend([null, 700])).toBe('NO_DATA')
  })

  it('la tolerancia evita marcar oscilaciones mínimas', () => {
    expect(studentTrend([700, 710], 50)).toBe('STABLE')
    expect(studentTrend([700, 800], 50)).toBe('IMPROVED')
  })

  it('los huecos no cuentan como puntos', () => {
    expect(studentTrend([600, null, 900])).toBe('IMPROVED')
  })
})

describe('maxDrop', () => {
  it('encuentra la mayor caída entre períodos consecutivos', () => {
    expect(maxDrop([900, 700, 650])).toBe(200)
  })

  it('una serie que sube no tiene caída', () => {
    expect(maxDrop([600, 800])).toBe(0)
  })
})

describe('triggeredAlerts', () => {
  const rules: AlertRule[] = [
    { type: 'ALERT_SUBJECTS', threshold: 3 },
    { type: 'SCORE_DROP', threshold: 200 },
    { type: 'NO_ASSESSMENTS', threshold: 0 },
  ]

  it('dispara por cantidad de asignaturas en alerta', () => {
    const fired = triggeredAlerts(student({ subjectValues: [300, 400, 500, 900] }), rules, LEVELS)
    expect(fired).toContainEqual({ type: 'ALERT_SUBJECTS', detail: 3 })
  })

  it('por debajo del umbral no dispara', () => {
    const fired = triggeredAlerts(student({ subjectValues: [300, 400, 900] }), rules, LEVELS)
    expect(fired.some((f) => f.type === 'ALERT_SUBJECTS')).toBe(false)
  })

  it('dispara por caída de dos o más puntos entre períodos', () => {
    const fired = triggeredAlerts(student({ periodValues: [900, 600] }), rules, LEVELS)
    expect(fired).toContainEqual({ type: 'SCORE_DROP', detail: 300 })
  })

  it('dispara por ausencia de evaluaciones', () => {
    const fired = triggeredAlerts(student({ assessmentCount: 0 }), rules, LEVELS)
    expect(fired.some((f) => f.type === 'NO_ASSESSMENTS')).toBe(true)
  })

  it('devuelve la lista de lo disparado, no un veredicto', () => {
    // El pliego prohíbe que la alerta genere sola decisiones administrativas.
    const fired = triggeredAlerts(student({ subjectValues: [300, 300, 300], periodValues: [900, 500] }), rules, LEVELS)
    expect(fired).toHaveLength(2)
  })

  it('un umbral distinto cambia el resultado: no está clavado', () => {
    const snapshot = student({ subjectValues: [300, 400] })
    expect(triggeredAlerts(snapshot, [{ type: 'ALERT_SUBJECTS', threshold: 3 }], LEVELS)).toHaveLength(0)
    expect(triggeredAlerts(snapshot, [{ type: 'ALERT_SUBJECTS', threshold: 2 }], LEVELS)).toHaveLength(1)
  })
})

describe('studentsBlock', () => {
  it('cuenta en alerta y tendencias, y cuántos tienen con qué compararse', () => {
    const block = studentsBlock(
      [
        student({ studentId: 's1', periodValues: [600, 900] }),
        student({ studentId: 's2', periodValues: [900, 600] }),
        student({ studentId: 's3', assessmentCount: 0, subjectValues: [], periodValues: [] }),
      ],
      [{ type: 'NO_ASSESSMENTS', threshold: 0 }],
      LEVELS,
    )
    expect(block).toEqual({ total: 3, atRisk: 1, improved: 1, declined: 1, compared: 2 })
  })
})

describe('lowSubjectsHistogram', () => {
  it('reparte a los estudiantes con nota según cuántas materias tienen en alerta', () => {
    const histogram = lowSubjectsHistogram(
      [
        student({ subjectValues: [700, 800] }),
        student({ subjectValues: [300, 800] }),
        student({ subjectValues: [300, 400, 900] }),
        student({ subjectValues: [300, 400, 500, 900] }),
        // Sin ninguna nota en la reunión: no entra en la cuenta.
        student({ subjectValues: [null, null] }),
      ],
      LEVELS,
    )
    expect(histogram).toEqual({ graded: 4, none: 1, one: 1, two: 1, threeOrMore: 1 })
  })
})

describe('performanceBlock', () => {
  it('junta promedio, mediana y distribución', () => {
    const block = performanceBlock([300, 700, 1000], LEVELS)
    expect(block.averageHundredths).toBe(667)
    expect(block.medianHundredths).toBe(700)
    expect(block.gradedCount).toBe(3)
    expect(block.distribution).toHaveLength(3)
  })
})

describe('buildComparison', () => {
  it('arma la fila con promedio, mediana y % de alerta', () => {
    const rows = buildComparison(
      [{ key: '2026', label: '2026', values: [300, 700, 800], studentCount: 3 }],
      LEVELS,
    )
    expect(rows[0]).toMatchObject({ label: '2026', medianHundredths: 700, gradedCount: 3 })
    expect(rows[0]).toMatchObject({ alertCount: 1, gradedCount: 3 })
    expect(rows[0].alertPercentage).toBeCloseTo(33.3, 1)
  })

  it('un grupo sin notas no rompe ni inventa un 0%', () => {
    const rows = buildComparison([{ key: 'x', label: 'X', values: [], studentCount: 5 }], LEVELS)
    expect(rows[0]).toMatchObject({ averageHundredths: null, alertCount: 0, alertPercentage: 0, gradedCount: 0 })
  })
})

describe('instantánea por reunión', () => {
  const P1 = { id: 'p-1', name: '1.ª Entrega', sortOrder: 10, reportCard: true }
  const P2 = { id: 'p-2', name: '2.ª Entrega', sortOrder: 20, reportCard: true }
  const APE = { id: 'p-ape', name: 'APE Febrero', sortOrder: 120, reportCard: false }
  const state = (gradeBookId: string, period: typeof P1, grades: Array<[string, number | null]>): AnalyticsState => ({
    gradeBookId,
    period,
    grades: grades.map(([studentId, value]) => ({ studentId, lastName: studentId, firstName: studentId, value })),
  })

  it('la reunión de referencia es la elegida o la última con notas', () => {
    const states = [state('gb', P1, [['a', 700]]), state('gb', P2, [['a', null]])]
    expect(referencePeriod(states)).toEqual(P1)
    expect(referencePeriod(states, 'p-2')).toEqual(P2)
    expect(referencePeriod(states, 'p-x')).toBeNull()
    // Sin ninguna nota, la última que exista.
    expect(referencePeriod([state('gb', P1, [['a', null]]), state('gb', P2, [])])).toEqual(P2)
    expect(referencePeriod([])).toBeNull()
  })

  it('sin elegir, prefiere el último boletín con notas antes que una APE', () => {
    // En un año cerrado la última reunión con notas es la APE de febrero: sólo tienen nota los que fueron.
    const states = [state('gb', P2, [['a', 700]]), state('gb', APE, [['a', 500]])]
    expect(referencePeriod(states)).toEqual(P2)
    // Si sólo la APE tiene notas, es la que hay.
    expect(referencePeriod([state('gb', P2, [['a', null]]), state('gb', APE, [['a', 500]])])).toEqual(APE)
    // Sin ninguna nota, el último boletín.
    expect(referencePeriod([state('gb', P2, []), state('gb', APE, [])])).toEqual(P2)
  })

  it('la serie es el promedio por reunión, hasta la de referencia', () => {
    const states = [
      state('mat', P1, [['a', 400]]),
      state('art', P1, [['a', 1000]]),
      state('mat', P2, [['a', 800]]),
    ]
    const [only] = studentSnapshots({
      states,
      subjectOf: new Map([['mat', 's-mat'], ['art', 's-art']]),
      reference: P1,
      assessmentsOf: (books) => books.size,
    })
    expect(only.periodValues).toEqual([700])
    expect([...only.subjectValues].sort((x, y) => (x ?? 0) - (y ?? 0))).toEqual([400, 1000])
    expect(only.assessmentCount).toBe(2)
  })

  it('las notas son las de la reunión de referencia', () => {
    const states = [state('mat', P1, [['a', 400], ['b', null]]), state('mat', P2, [['a', 900]])]
    expect(valuesAt(states, P1)).toEqual([400])
    expect(valuesAt(states, null)).toEqual([])
  })
})
