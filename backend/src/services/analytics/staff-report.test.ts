import { describe, expect, it } from 'vitest'
import type { RangeCounts } from './models.js'
import type { StaffDashboardBody } from './staff-dashboard.js'
import { bucketLabel, buildStaffReport, distributionParts, staffReportFilters, summaryTiles, type StaffReportInput } from './staff-report.js'
import type { ReportDoc, TableBlock } from '../reports/model.js'

const counts = (over: Partial<RangeCounts> = {}): RangeCounts => ({
  planned: 460,
  present: 452,
  onTime: 412,
  late: 40,
  absent: 8,
  plannedMinutes: 78_000,
  actualMinutes: 73_800,
  ...over,
})

const kpis = { M1_PUNCTUALITY_pct: 91.15, M2_LATE_RATE_pct: 8.85, M4_AOP_pct: 1.74, M6_COVERAGE_CP_pct: 98.26, M8_HOURS_DELTA_pct: -5.38, PC_count: 1 }

function body(over: Partial<StaffDashboardBody> = {}): StaffDashboardBody {
  const row = (key: string, label: string) => ({
    key,
    label,
    plannedCount: 230,
    punctualityPct: 90,
    lateRatePct: 10,
    aopPct: 2,
    coveragePct: 98,
    counts: counts({ planned: 230, present: 226, onTime: 206, late: 20, absent: 4 }),
  })
  return {
    meta: {
      resolvedInstanceCount: 460,
      rangeFrom: '2026-09-01',
      rangeTo: '2026-09-30',
      roleFilter: 'TEACHER',
      eventTypeFilter: 'CLASE',
      schoolYearId: 'sy-1',
      allYears: false,
      granularity: 'week',
      generatedAt: '2026-11-13T17:00:00.000Z',
    },
    kpis,
    counts: counts(),
    series: { lateRateByPeriod: [], aopByPeriod: [] },
    seriesMulti: [
      { period: '2026-08-31', lateRate: 8, aop: 2, coverage: 98, counts: counts({ planned: 115, present: 113, onTime: 104, late: 9, absent: 2 }) },
      { period: '2026-09-07', lateRate: 0, aop: 0, coverage: 0, counts: counts({ planned: 0, present: 0, onTime: 0, late: 0, absent: 0 }) },
    ],
    breakdowns: { byRole: [row('TEACHER', 'Docentes')], byEventType: [row('CLASE', 'Clase')], byCourse: [] },
    statusDistribution: {
      totalPlanned: 460,
      rows: [
        { status: 'PRESENT', count: 412, pct: 89.57 },
        { status: 'LATE', count: 40, pct: 8.7 },
        { status: 'ABSENT_NOT_JUSTIFIED', count: 5, pct: 1.09 },
      ],
    },
    comparison: {
      previousFrom: '2026-08-02',
      previousTo: '2026-08-31',
      current: kpis,
      previous: kpis,
      deltas: { M1_PUNCTUALITY_pct: 1.2, M2_LATE_RATE_pct: -1.2, M4_AOP_pct: 0, M6_COVERAGE_CP_pct: 0.4, M8_HOURS_DELTA_pct: 0, PC_count: 0 },
      previousCounts: counts(),
    },
    topLists: {
      topRiskPeople: [
        { userId: 'u1', displayName: 'Ana Pérez', role: 'TEACHER', plannedCount: 40, presentCount: 37, lateCount: 6, absentNotJustifiedCount: 3, absentJustifiedCount: 0, riskScore: 12 },
        { userId: 'u2', displayName: 'Bruno Díaz', role: 'TEACHER', plannedCount: 40, presentCount: 40, lateCount: 0, absentNotJustifiedCount: 0, absentJustifiedCount: 0, riskScore: 0 },
      ],
      topRiskEvents: [
        {
          eventId: 'e1',
          title: 'Matemática 1.º A',
          eventType: 'CLASE',
          plannedCount: 12,
          lateRatePct: 25,
          absentOverPlanPct: 8.33,
          focusScore: 33.33,
          counts: counts({ planned: 12, present: 11, onTime: 8, late: 3, absent: 1 }),
        },
      ],
    },
    signals: ['Muestra amplia: 460 registros planificados. Las tendencias son más estables.'],
    ...over,
  } as StaffDashboardBody
}

function input(over: Partial<StaffReportInput> = {}): StaffReportInput {
  const b = body()
  return {
    body: b,
    people: [b.topLists.topRiskPeople[1], b.topLists.topRiskPeople[0]],
    personName: null,
    schoolYearLabel: 'Ciclo 2026',
    generatedAt: new Date('2026-11-13T17:05:00.000Z'),
    ...over,
  }
}

const tables = (report: ReportDoc) => report.sections.flatMap((s) => s.blocks).filter((b): b is TableBlock => b.kind === 'table')
const allText = (report: ReportDoc) => JSON.stringify(report)

describe('informe del personal', () => {
  it('las secciones de la pantalla y todas las personas', () => {
    const report = buildStaffReport(input())
    expect(report.title).toBe('Indicadores del personal')
    expect(report.subtitle).toBe('Del 01/09/2026 al 30/09/2026')
    expect(report.sections.map((s) => s.title)).toEqual(['Resumen', 'Tendencias', 'Seguimiento', 'Por persona'])
    expect(report.filename).toBe('Indicadores del personal 01-09-2026 a 30-09-2026')
  })

  it('los filtros en palabras', () => {
    expect(staffReportFilters(input())).toEqual([
      'Período: del 01/09/2026 al 30/09/2026',
      'Personas: Docentes',
      'Actividades: Clase',
      'Ciclo lectivo: Ciclo 2026',
    ])
    const one = input({ personName: 'Ana Pérez', body: body({ meta: { ...body().meta, roleFilter: null, eventTypeFilter: null, allYears: true } }) })
    expect(staffReportFilters(one)).toEqual(['Período: del 01/09/2026 al 30/09/2026', 'Persona: Ana Pérez', 'Actividades: todas', 'Ciclo lectivo: todos los ciclos'])
    expect(buildStaffReport(one).filename).toBe('Indicadores del personal 01-09-2026 a 30-09-2026 - Ana Pérez')
  })

  it('cada indicador con su base y la variación en palabras', () => {
    const tiles = summaryTiles(body())
    expect(tiles[0]).toEqual({
      label: 'Puntualidad',
      value: '91,2 %',
      detail: '412 de 452 (91,2 %) entradas registradas fueron a tiempo. Subió 1,2 puntos respecto del período anterior.',
    })
    expect(tiles[1].detail).toContain('Bajó 1,2 puntos')
    expect(tiles[2]).toMatchObject({ label: 'Ausentismo', value: '1,7 %' })
    expect(tiles[2].detail).toContain('8 de 460 (1,7 %)')
    expect(tiles[2].detail).toContain('Sin cambios')
    expect(tiles[4]).toEqual({ label: 'Desvío de horas', value: '-5,4 %', detail: 'Se registraron 1.230 h de 1.300 h planificadas.' })
  })

  it('sin comparación no inventa variaciones', () => {
    const tiles = summaryTiles(body({ comparison: null }))
    expect(tiles[0].detail).toBe('412 de 452 (91,2 %) entradas registradas fueron a tiempo.')
  })

  it('la evolución deja afuera los períodos sin registros', () => {
    const evolution = tables(buildStaffReport(input()))[0]
    expect(evolution.title).toBe('Evolución por semana')
    expect(evolution.rows).toHaveLength(1)
    expect(evolution.rows[0].slice(0, 3)).toEqual(['Semana del 31/08/2026', 115, { part: 104, total: 113 }])
  })

  it('la distribución suma todos los registros: lo que no es presente, tarde ni ausente va en "Otros"', () => {
    expect(distributionParts(body())).toEqual([
      { label: 'Presente', value: 412 },
      { label: 'Tarde', value: 40 },
      { label: 'Ausente no justificado', value: 5 },
      { label: 'Otros estados', value: 3, muted: true },
    ])
  })

  it('seguimiento sólo con quienes tienen algo para revisar; por persona, todos en orden alfabético', () => {
    const report = buildStaffReport(input())
    const byTitle = new Map(tables(report).map((t) => [t.title, t]))
    expect(byTitle.get('Personas para revisar')!.rows).toEqual([['Ana Pérez', 'Docente', 40, 6, 3, 0, 12]])
    expect(byTitle.get('Actividades para revisar')!.rows[0]).toEqual(['Matemática 1.º A', 'Clase', 12, { part: 3, total: 11 }, { part: 1, total: 12 }, 33.33])
    expect(byTitle.get('Todas las personas')!.rows.map((row) => row[0])).toEqual(['Ana Pérez', 'Bruno Díaz'])
    expect(byTitle.get('Todas las personas')!.rows[0][3]).toEqual({ part: 37, total: 40 })
  })

  it('nada en técnico', () => {
    expect(allText(buildStaffReport(input()))).not.toMatch(/KPI|AOP|\bLATE\b|M\d_|ABSENT_|TEACHER|CLASE\b/)
  })

  it('sin registros lo dice, sin tablas vacías', () => {
    const empty = buildStaffReport(input({ body: body({ counts: counts({ planned: 0, present: 0, onTime: 0, late: 0, absent: 0 }) }) }))
    expect(empty.sections).toEqual([{ id: 'resumen', title: 'Resumen', blocks: [{ kind: 'note', lines: ['No hay registros planificados para estos filtros.'] }] }])
  })
})

describe('nombre de cada período de la evolución', () => {
  it('día, semana o mes', () => {
    expect(bucketLabel('2026-03-05', 'day')).toBe('05/03/2026')
    expect(bucketLabel('2026-03-02', 'week')).toBe('Semana del 02/03/2026')
    expect(bucketLabel('2026-09-01', 'month')).toBe('Setiembre 2026')
  })
})
