import { describe, expect, it } from 'vitest'
import {
  buildComparison,
  distributionByLevel,
  managementBlock,
  maxDrop,
  mean,
  median,
  performanceBlock,
  studentTrend,
  studentsBlock,
  triggeredAlerts,
  type AlertRule,
  type GradeBookState,
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
  it('cuenta evaluados, sin evaluar, en alerta y tendencias', () => {
    const block = studentsBlock(
      [
        student({ studentId: 's1', periodValues: [600, 900] }),
        student({ studentId: 's2', periodValues: [900, 600] }),
        student({ studentId: 's3', assessmentCount: 0, subjectValues: [], periodValues: [] }),
      ],
      [{ type: 'NO_ASSESSMENTS', threshold: 0 }],
      LEVELS,
    )
    expect(block).toEqual({ total: 3, evaluated: 2, withoutAssessments: 1, atRisk: 1, improved: 1, declined: 1 })
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

describe('managementBlock', () => {
  function state(over: Partial<GradeBookState> = {}): GradeBookState {
    return {
      gradeBookId: 'gb-1', gradedStudents: 10, rosterSize: 10,
      periodStatus: 'CLOSED', endorsed: true, closedLate: false,
      ...over,
    }
  }

  it('separa completas de incompletas', () => {
    const block = managementBlock([state(), state({ gradedStudents: 4 })])
    expect(block).toMatchObject({ gradeBooks: 2, complete: 1, incomplete: 1 })
  })

  it('un grupo vacío cuenta como completo: no tiene nada pendiente', () => {
    // Contarlo como incompleto inflaría el pendiente con grupos que no existen.
    expect(managementBlock([state({ gradedStudents: 0, rosterSize: 0 })]).complete).toBe(1)
  })

  it('cuenta cierres y visados pendientes por separado', () => {
    const block = managementBlock([
      state({ periodStatus: 'OPEN', endorsed: false }),
      state({ periodStatus: 'CLOSED', endorsed: false }),
      state(),
    ])
    expect(block.pendingClosures).toBe(1)
    expect(block.pendingEndorsements).toBe(1)
    expect(block.endorsedPercentage).toBeCloseTo(33.3, 1)
  })

  it('cuenta los cierres fuera de plazo', () => {
    expect(managementBlock([state({ closedLate: true }), state()]).lateClosures).toBe(1)
  })

  it('sin libretas no divide por cero', () => {
    expect(managementBlock([])).toMatchObject({ gradeBooks: 0, endorsedPercentage: 0, startedPercentage: 0 })
  })
})

describe('buildComparison', () => {
  it('arma la fila con promedio, mediana y % de alerta', () => {
    const rows = buildComparison(
      [{ key: '2026', label: '2026', values: [300, 700, 800], studentCount: 3 }],
      LEVELS,
    )
    expect(rows[0]).toMatchObject({ label: '2026', medianHundredths: 700, gradedCount: 3 })
    expect(rows[0].alertPercentage).toBeCloseTo(33.3, 1)
  })

  it('un grupo sin notas no rompe ni inventa un 0%', () => {
    const rows = buildComparison([{ key: 'x', label: 'X', values: [], studentCount: 5 }], LEVELS)
    expect(rows[0]).toMatchObject({ averageHundredths: null, alertPercentage: 0, gradedCount: 0 })
  })
})
