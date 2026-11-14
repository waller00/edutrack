import { describe, expect, it } from 'vitest'
import type { ReportDoc, TableBlock, TilesBlock } from '../reports/model.js'
import {
  buildStudentReport,
  cohortLabel,
  comparisonTable,
  lowGradeRows,
  monthLabel,
  presentDays,
  riskTable,
  trajectoryHeadline,
  type StudentReportData,
} from './report-sections.js'
import { emptyCounts } from './trajectory.js'

const YEAR = { id: 'sy-2026', code: 2026, label: 'Ciclo 2026', status: 'ACTIVE' }
const PREVIOUS = { id: 'sy-2025', code: 2025, label: 'Ciclo 2025', status: 'CLOSED' }

const riskRow = (over: Record<string, unknown> = {}) => ({
  studentId: 's1',
  firstName: 'Ana',
  lastName: 'Pérez',
  courseName: '1.º A',
  level: 'EBI',
  grades: { lowSubjects: 3, subjects: ['Inglés', 'Matemática', 'Física'], periodName: '2.ª Entrega' },
  absenceHundredths: 1950,
  absenceThreshold: 1800,
  streak: { days: 4, from: '2026-10-01' },
  carried: 1,
  reasons: ['GRADES', 'CARRIED', 'ABSENCES', 'STREAK'],
  families: ['NOTAS', 'FALTAS'],
  ...over,
})

function data(over: Partial<StudentReportData> = {}): StudentReportData {
  const total = { ...emptyCounts(), enrolled: 40, promoted: 20, repeated: 5, graduated: 12, leftWithdrawn: 1, notReenrolled: 2 }
  return {
    access: { analytics: true, reports: true },
    year: { id: YEAR.id, label: YEAR.label },
    period: { id: 'p2', name: '2.ª Entrega', level: 'EBI' },
    generatedAt: new Date('2026-11-13T17:00:00.000Z'),
    risk: {
      schoolYear: YEAR,
      enrolled: 88,
      threshold: 3,
      references: [{ level: 'EBI', period: { id: 'p2', name: '2.ª Entrega' } }],
      counts: { students: 2, grades: 1, absences: 2, both: 1 },
      rows: [riskRow(), riskRow({ studentId: 's2', firstName: 'Luis', lastName: 'Suárez', grades: null, carried: 0, streak: null, reasons: ['ABSENCES'], families: ['FALTAS'] })],
    } as StudentReportData['risk'],
    trend: {
      schoolYear: YEAR,
      months: ['2026-03', '2026-04'],
      byCourse: [
        {
          courseOfferingId: 'o1',
          courseName: '1.º A',
          level: 'EBI',
          months: [
            { month: '2026-03', studentDays: 100, absentDays: 6, justifiedDays: 2, lateDays: 3 },
            { month: '2026-04', studentDays: 0, absentDays: 0, justifiedDays: 0, lateDays: 0 },
          ],
          total: { studentDays: 100, absentDays: 6, justifiedDays: 2, lateDays: 3 },
        },
      ],
      total: {
        studentDays: 200,
        absentDays: 10,
        justifiedDays: 4,
        lateDays: 5,
        months: [
          { month: '2026-03', studentDays: 120, absentDays: 6, justifiedDays: 2, lateDays: 3 },
          { month: '2026-04', studentDays: 80, absentDays: 4, justifiedDays: 2, lateDays: 2 },
        ],
      },
    } as StudentReportData['trend'],
    streaks: [
      { studentId: 's1', firstName: 'Ana', lastName: 'Pérez', courseName: '1.º A', from: '2026-10-01', to: '2026-10-06', days: 4, open: true },
      { studentId: 's3', firstName: 'Eva', lastName: 'Gómez', courseName: '2.º B', from: '2026-05-02', to: '2026-05-06', days: 3, open: false },
    ],
    thresholds: [
      { studentId: 's2', firstName: 'Luis', lastName: 'Suárez', courseName: '1.º A', absenceHundredths: 2550, threshold: 2500, reached: [1800, 2500] },
      { studentId: 's1', firstName: 'Ana', lastName: 'Pérez', courseName: '1.º A', absenceHundredths: 1950, threshold: 1800, reached: [1800] },
    ],
    subjectsApe: {
      requestedYear: YEAR,
      focusYear: PREVIOUS,
      students: { referred: 10, clearedByFebruary: 6, clearedLater: 1, stillOwing: 3 },
      byCourse: [{ courseId: 'c1', courseName: '3.º A', position: 3, referred: 14, december: 6, february: 3, previa: 1, owed: 4, studentsReferred: 10 }],
      rows: [{ courseId: 'c1', courseName: '3.º A', position: 3, subjectId: 'm', subjectName: 'Matemática', referred: 14, december: 6, february: 3, previa: 1, owed: 4 }],
      carriedOver: { students: 4, subjects: 6 },
    } as StudentReportData['subjectsApe'],
    lowGrades: {
      period: { id: 'p2', name: '2.ª Entrega', level: 'EBI' },
      rows: [
        { courseOfferingId: 'o1', courseName: '1.º A', orientationName: null, subjectName: 'Inglés', graded: 30, low: 3, percent: 10, pending: 0 },
        { courseOfferingId: 'o1', courseName: '1.º A', orientationName: null, subjectName: 'Matemática', graded: 30, low: 9, percent: 30, pending: 2 },
        { courseOfferingId: 'o1', courseName: '1.º A', orientationName: null, subjectName: 'Dibujo', graded: 30, low: 0, percent: 0, pending: 0 },
      ],
      courses: [{ courseOfferingId: 'o1', courseName: '1.º A', graded: 30, low: 10, percent: 33.3 }],
    },
    drops: {
      period: { id: 'p2', name: '2.ª Entrega', level: 'EBI' },
      previous: { id: 'p1', name: '1.ª Entrega' },
      rows: [{ studentId: 's1', firstName: 'Ana', lastName: 'Pérez', courseName: '1.º A', subjectId: 'm', subjectName: 'Matemática', previous: 700, current: 450 }],
    },
    dashboard: {
      schoolYearId: YEAR.id,
      level: 'EBI',
      scale: { name: 'Escala EBI', minValueHundredths: 100, maxValueHundredths: 1000, decimals: 0 },
      referencePeriod: { id: 'p2', name: '2.ª Entrega' },
      students: { total: 30, atRisk: 3, improved: 10, declined: 5, compared: 25 },
      performance: {
        averageHundredths: 700,
        medianHundredths: 750,
        gradedCount: 90,
        distribution: [
          { levelId: 'bajo', label: 'Insuficiente', colorToken: null, iconToken: null, isAlert: true, count: 12, percentage: 13.3 },
          { levelId: 'alto', label: 'Logrado', colorToken: null, iconToken: null, isAlert: false, count: 78, percentage: 86.7 },
        ],
      },
      lowSubjects: { graded: 30, none: 20, one: 5, two: 2, threeOrMore: 3 },
      rules: [{ type: 'ALERT_SUBJECTS', threshold: 3 }],
      disclaimer: 'Las alertas tienen finalidad informativa.',
    },
    comparisons: {
      SUBJECT: {
        dimension: 'SUBJECT',
        level: 'EBI',
        data: [
          { key: 'a', label: 'Inglés', averageHundredths: 780, medianHundredths: 800, gradedCount: 30, studentCount: 30, alertCount: 3, alertPercentage: 10 },
          { key: 'b', label: 'Matemática', averageHundredths: 600, medianHundredths: 650, gradedCount: 30, studentCount: 30, alertCount: 9, alertPercentage: 30 },
        ],
      },
    },
    trajectory: {
      requestedYear: YEAR,
      focusYear: PREVIOUS,
      byCourse: [
        { ...emptyCounts(), courseId: 'c1', courseName: '1.º', level: 'EBI', position: 1, enrolled: 25, promoted: 20, repeated: 5 },
        { ...emptyCounts(), courseId: 'c3', courseName: '3.º', level: 'EBI', position: 3, enrolled: 15, graduated: 12, leftWithdrawn: 1, notReenrolled: 2 },
      ],
      total,
      byYear: [{ ...YEAR, ...emptyCounts(), enrolled: 40, inProgress: 40 }],
      cohorts: [{ level: 'EBI', entryYear: 2023, entrants: 30, graduatedOnTime: 20, graduatedLate: 2, onTrack: 0, behind: 3, left: 4, unknown: 1, timeline: [] }],
    },
    ...over,
  }
}

const sectionIds = (report: ReportDoc) => report.sections.map((section) => section.id)
const tablesOf = (report: ReportDoc) => report.sections.flatMap((s) => s.blocks).filter((b): b is TableBlock => b.kind === 'table')
const table = (report: ReportDoc, title: string) => tablesOf(report).find((t) => t.title === title)!
const tilesOf = (report: ReportDoc, id: string) =>
  report.sections.find((s) => s.id === id)!.blocks.filter((b): b is TilesBlock => b.kind === 'tiles').flatMap((b) => b.tiles)

describe('las secciones son las que esa persona ve en la pantalla', () => {
  it('con los dos permisos, todas y en el orden de la pantalla', () => {
    expect(sectionIds(buildStudentReport(data()))).toEqual(['resumen', 'rendimiento', 'materias', 'asistencia', 'trayectoria', 'riesgo'])
  })

  it('con sólo los reportes (Adscripción): sin Rendimiento ni Trayectoria, y el Resumen con sus dos mosaicos', () => {
    const report = buildStudentReport(data({ access: { analytics: false, reports: true }, dashboard: null, comparisons: null, trajectory: null }))
    expect(sectionIds(report)).toEqual(['resumen', 'materias', 'asistencia', 'riesgo'])
    expect(tilesOf(report, 'resumen').map((t) => t.label)).toEqual(['Necesitan atención', 'Asistencia del año'])
  })

  it('con sólo los indicadores académicos: Rendimiento y Trayectoria, sin nombres de la lista de atención', () => {
    const report = buildStudentReport(
      data({ access: { analytics: true, reports: false }, risk: null, trend: null, streaks: null, thresholds: null, subjectsApe: null, lowGrades: null, drops: null }),
    )
    expect(sectionIds(report)).toEqual(['resumen', 'rendimiento', 'trayectoria'])
    expect(tilesOf(report, 'resumen').map((t) => t.label)).toEqual(['Con materias bajas en el boletín', 'Promoción del último año cerrado'])
    expect(JSON.stringify(report)).not.toContain('Pérez')
  })

  it('encabezado, filtros y nombre de archivo', () => {
    const report = buildStudentReport(data())
    expect(report.subtitle).toBe('Ciclo 2026 · notas (R) de 2.ª Entrega')
    expect(report.filters).toEqual(['Ciclo lectivo: Ciclo 2026', 'Boletín de referencia: 2.ª Entrega (ciclo básico)'])
    expect(report.filename).toBe('Indicadores de estudiantes Ciclo 2026 - 2.ª Entrega')
  })
})

describe('Resumen', () => {
  it('cada número con su base', () => {
    const tiles = tilesOf(buildStudentReport(data()), 'resumen')
    expect(tiles[0]).toEqual({ label: 'Necesitan atención', value: '2', detail: '2 de 88 (2,3 %) estudiantes del ciclo. 1 por notas, 2 por faltas y 1 por las dos.' })
    expect(tiles[1].value).toBe('95 %')
    expect(tiles[1].detail).toBe('190 de 200 días con lista, sin falta. Llegar tarde cuenta como que vino.')
    expect(tiles[2].detail).toBe('10 de 30 (33,3 %) estudiantes con notas tienen al menos una materia baja en 2.ª Entrega.')
    expect(tiles[3].detail).toBe('32 de 40 (80 %) matriculados en Ciclo 2025 promovieron o egresaron. 5 repitieron y 3 dejaron el liceo.')
  })

  it('"Para mirar primero" va en el PDF; en el Excel está la lista entera', () => {
    const first = table(buildStudentReport(data()), 'Para mirar primero')
    expect(first.pdfOnly).toBe(true)
    expect(first.rows).toHaveLength(2)
  })

  it('sin listas pasadas ni boletines lo dice en vez de inventar un 0 %', () => {
    const report = buildStudentReport(data({ trend: { ...data().trend!, total: { ...data().trend!.total, studentDays: 0 } }, dashboard: null }))
    const tiles = tilesOf(report, 'resumen')
    expect(tiles[1]).toMatchObject({ value: '—', detail: 'Todavía no hay listas pasadas en el ciclo.' })
    expect(tiles[2]).toMatchObject({ value: '—', detail: 'Todavía no hay notas de boletín.' })
  })
})

describe('Rendimiento', () => {
  it('promedio con un decimal, notas bajas con su base, y las tres comparaciones', () => {
    const report = buildStudentReport(data())
    const tiles = tilesOf(report, 'rendimiento')
    expect(tiles.map((t) => t.value)).toEqual(['7,0', '7,5', '13,3 %'])
    expect(tiles[2].detail).toBe('12 de 90 notas en Insuficiente.')
    expect(tablesOf(report).map((t) => t.title)).toEqual(
      expect.arrayContaining(['Comparar por asignatura', 'Comparar por curso', 'Comparar por año lectivo', 'Quiénes bajaron en alguna materia respecto del boletín anterior']),
    )
  })

  it('las comparaciones van de más a menos notas bajas', () => {
    const subject = comparisonTable('SUBJECT', data().comparisons!.SUBJECT)
    expect(subject.rows.map((row) => row[0])).toEqual(['Matemática', 'Inglés'])
    expect(subject.rows[0]).toEqual(['Matemática', { part: 9, total: 30 }, 6, 6.5, 30])
    expect(comparisonTable('YEAR', undefined).rows).toEqual([])
  })

  it('sin notas de boletín, una nota en vez de tablas vacías', () => {
    const report = buildStudentReport(data({ dashboard: null }))
    expect(report.sections.find((s) => s.id === 'rendimiento')!.blocks).toEqual([{ kind: 'note', lines: ['Todavía no hay notas de boletín en este ciclo.'] }])
  })

  it('el primer boletín no tiene con qué comparar', () => {
    const report = buildStudentReport(data({ drops: { ...data().drops!, previous: null, rows: [] } }))
    expect(table(report, 'Quiénes bajaron en alguna materia respecto del boletín anterior').empty).toBe(
      'Es el primer boletín: no hay uno anterior con qué comparar.',
    )
  })
})

describe('Materias y APE, Asistencia y Trayectoria', () => {
  it('materias con notas bajas: todas las que tienen alguna, de más a menos', () => {
    expect(lowGradeRows(data().lowGrades!).map((row) => row.subjectName)).toEqual(['Matemática', 'Inglés'])
  })

  it('asistencia: tiles, meses y listas completas', () => {
    const report = buildStudentReport(data())
    const tiles = tilesOf(report, 'asistencia')
    expect(tiles.find((t) => t.label === '18 faltas o más')).toEqual({ label: '18 faltas o más', value: '2', detail: '2 de 88 (2,3 %) estudiantes del ciclo. 1 con 25 o más.' })
    expect(tiles.find((t) => t.label === 'Faltas seguidas que siguen')!.value).toBe('1')
    expect(table(report, 'Asistencia por curso y mes').rows[0]).toEqual(['1.º A', { part: 94, total: 100 }, { part: 0, total: 0 }, { part: 94, total: 100 }])
    expect(table(report, 'Faltas seguidas').rows).toHaveLength(2)
    expect(table(report, '18 y 25 faltas').rows[0]).toEqual(['Suárez, Luis', '1.º A', 25.5, 'Pasó las 25'])
  })

  it('trayectoria: el último año cerrado, año a año y cada generación', () => {
    const report = buildStudentReport(data())
    expect(tilesOf(report, 'trayectoria').find((t) => t.label === 'Egresaron')!.detail).toBe('12 de 15 (80 %) matriculados en el último grado.')
    expect(table(report, 'Qué pasó con cada generación').rows[0]).toEqual(['Ingreso 2023 (ciclo básico)', 30, 20, 2, 0, 3, 4, 1])
  })
})

describe('Quién necesita atención', () => {
  it('la lista entera, con cada motivo en su columna', () => {
    const t = riskTable(data().risk!.rows)
    expect(t.rows[0]).toEqual(['Pérez, Ana', '1.º A', 'Notas y faltas', 3, 'Inglés, Matemática, Física', 1, 19.5, 4])
    expect(t.rows[1]).toEqual(['Suárez, Luis', '1.º A', 'Faltas', null, null, 0, 19.5, null])
  })

  it('nada en técnico', () => {
    expect(JSON.stringify(buildStudentReport(data()))).not.toMatch(/"(NOTAS|FALTAS|GRADES|ABSENCES|STREAK|CARRIED|EBI|EMS|SUBJECT|COURSE|YEAR)"/)
  })
})

describe('las cuentas son las de la pantalla', () => {
  it('días que vino, meses y generaciones', () => {
    expect(presentDays({ studentDays: 20, absentDays: 3, justifiedDays: 1, lateDays: 2 })).toBe(17)
    expect(monthLabel('2026-03')).toBe('Mar')
    expect(monthLabel('2026-09')).toBe('Set')
    expect(cohortLabel({ entryYear: 2024, level: 'EMS' })).toBe('Ingreso 2024 (bachillerato)')
    expect(cohortLabel({ entryYear: 2024, level: null })).toBe('Ingreso 2024')
  })

  it('el egreso se cuenta sobre los matriculados en el último grado de cada nivel', () => {
    const t = data().trajectory!
    expect(trajectoryHeadline(t.total, t.byCourse)).toMatchObject({ enrolled: 40, promoted: 20, graduated: 12, finalEnrolled: 15, left: 3, leftDuringYear: 1, notReenrolled: 2 })
  })
})
