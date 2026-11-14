import { ROLE_LABELS } from '../../identity/profile-permissions-defaults.js'
import { formatCount, formatDecimal, formatPercent, formatPointsChange, formatRatio, formatShare, formatYmd } from '../reports/format.js'
import { share, type Column, type Part, type ReportDoc, type ReportSection, type TableBlock, type Tile } from '../reports/model.js'
import { EVENT_TYPE_BREAKDOWN_LABELS, ROLE_BREAKDOWN_LABELS } from './metrics.js'
import type { DashboardBreakdownRow, DashboardTopRiskEvent, DashboardTopRiskPerson, RangeCounts, SeriesGranularity } from './models.js'
import type { StaffDashboardBody } from './staff-dashboard.js'

/**
 * Informe de Indicadores del personal: lo que muestra la pantalla (Resumen, Tendencias,
 * Seguimiento) con los mismos números, más todas las personas del período. Cada porcentaje lleva
 * su base («412 de 452 entradas») y nada habla en técnico (ni KPI, ni AOP, ni códigos de estado).
 */

export type StaffReportInput = {
  body: StaffDashboardBody
  /** Todas las personas del período, como las cuenta "Personas para revisar". */
  people: readonly DashboardTopRiskPerson[]
  /** Nombre de la persona del filtro, si se eligió una. */
  personName: string | null
  schoolYearLabel: string | null
  generatedAt: Date
}

const STATUS_LABELS: Record<string, string> = {
  PRESENT: 'Presente',
  LATE: 'Tarde',
  ABSENT_NOT_JUSTIFIED: 'Ausente no justificado',
  ABSENT_JUSTIFIED: 'Ausente justificado',
}

const GRANULARITY_NAMES: Record<SeriesGranularity, string> = { day: 'día', week: 'semana', month: 'mes' }

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre']

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

const roleName = (code: string) => ROLE_LABELS[code as keyof typeof ROLE_LABELS] ?? code

const activityName = (code: string) => EVENT_TYPE_BREAKDOWN_LABELS[code] ?? code

// ─── Encabezado ─────────────────────────────────────────────────────────────

function whoText(input: StaffReportInput): string {
  if (input.personName) return `Persona: ${input.personName}`
  const role = input.body.meta.roleFilter
  return role ? `Personas: ${ROLE_BREAKDOWN_LABELS[role] ?? role}` : 'Personas: todos los roles'
}

function yearText(input: StaffReportInput): string | null {
  if (input.body.meta.allYears) return 'Ciclo lectivo: todos los ciclos'
  return input.schoolYearLabel ? `Ciclo lectivo: ${input.schoolYearLabel}` : null
}

export function staffReportFilters(input: StaffReportInput): string[] {
  const { meta } = input.body
  return [
    `Período: del ${formatYmd(meta.rangeFrom)} al ${formatYmd(meta.rangeTo)}`,
    whoText(input),
    meta.eventTypeFilter ? `Actividades: ${activityName(meta.eventTypeFilter)}` : 'Actividades: todas',
    yearText(input),
  ].filter((text): text is string => Boolean(text))
}

const fileDate = (ymd: string) => formatYmd(ymd).replaceAll('/', '-')

function filename(input: StaffReportInput): string {
  const { rangeFrom, rangeTo } = input.body.meta
  const base = `Indicadores del personal ${fileDate(rangeFrom)} a ${fileDate(rangeTo)}`
  return input.personName ? `${base} - ${input.personName}` : base
}

// ─── Resumen ────────────────────────────────────────────────────────────────

/** « Subió 1,2 puntos respecto del período anterior.», o nada si no se comparó. */
function change(delta: number | undefined): string {
  return delta === undefined ? '' : ` ${capitalize(formatPointsChange(delta))} respecto del período anterior.`
}

function hoursValue(counts: RangeCounts, deltaPct: number): string {
  if (counts.plannedMinutes <= 0) return '—'
  return `${deltaPct > 0 ? '+' : ''}${formatPercent(deltaPct)}`
}

function hoursDetail(counts: RangeCounts): string {
  if (counts.plannedMinutes <= 0) return 'No hay horario planificado con hora de inicio y de fin.'
  return `Se registraron ${formatDecimal(counts.actualMinutes / 60)} h de ${formatDecimal(counts.plannedMinutes / 60)} h planificadas.`
}

export function summaryTiles(body: StaffDashboardBody): Tile[] {
  const c = body.counts
  const deltas = body.comparison?.deltas
  return [
    {
      label: 'Puntualidad',
      value: formatRatio(c.onTime, c.present),
      detail: `${formatShare(c.onTime, c.present)} entradas registradas fueron a tiempo.${change(deltas?.M1_PUNCTUALITY_pct)}`,
    },
    {
      label: 'Llegadas tarde',
      value: formatRatio(c.late, c.present),
      detail: `${formatShare(c.late, c.present)} entradas registradas fueron tarde.${change(deltas?.M2_LATE_RATE_pct)}`,
    },
    {
      label: 'Ausentismo',
      value: formatRatio(c.absent, c.planned),
      detail: `${formatShare(c.absent, c.planned)} registros planificados, contando las ausencias justificadas.${change(deltas?.M4_AOP_pct)}`,
    },
    {
      label: 'Cobertura de asistencia',
      value: formatRatio(c.present, c.planned),
      detail: `${formatShare(c.present, c.planned)} registros planificados con presencia.${change(deltas?.M6_COVERAGE_CP_pct)}`,
    },
    { label: 'Desvío de horas', value: hoursValue(c, body.kpis.M8_HOURS_DELTA_pct), detail: hoursDetail(c) },
    { label: 'Licencias inactivas', value: formatCount(body.kpis.PC_count), detail: 'Licencias dadas de baja que coinciden con el período.' },
  ]
}

const HOW_IT_IS_CALCULATED = [
  'Puntualidad: entradas a tiempo sobre las entradas registradas (a tiempo o tarde).',
  'Llegadas tarde: entradas tarde sobre las entradas registradas.',
  'Ausentismo: ausencias, también las justificadas, sobre los registros planificados. La clase que cubrió un suplente es ausencia del titular.',
  'Cobertura de asistencia: registros con presencia (a tiempo o tarde) sobre los planificados.',
  'Desvío de horas: diferencia entre el tiempo registrado y el planificado.',
  'Los registros planificados salen del horario de cada persona en el período (clases, jornadas, reuniones). Las ausencias sin marca se calculan: no hace falta cargarlas.',
]

function summarySection(input: StaffReportInput): ReportSection {
  const { body } = input
  const comparison = body.comparison
  const intro = [
    `${formatCount(body.counts.planned)} registros planificados en el período.`,
    comparison
      ? `Las variaciones comparan con el ${formatYmd(comparison.previousFrom)} al ${formatYmd(comparison.previousTo)} (un período del mismo largo), en puntos porcentuales.`
      : '',
  ]
  return {
    id: 'resumen',
    title: 'Resumen',
    intro: intro.filter(Boolean).join(' '),
    blocks: [
      { kind: 'tiles', tiles: summaryTiles(body) },
      { kind: 'note', title: 'Lectura del período', lines: body.signals },
      { kind: 'note', title: 'Cómo se calcula', lines: HOW_IT_IS_CALCULATED },
    ],
  }
}

// ─── Tendencias ─────────────────────────────────────────────────────────────

/** Cómo se nombra cada período de la evolución: «Semana del 02/03/2026», «Marzo 2026», «05/03/2026». */
export function bucketLabel(period: string, granularity: SeriesGranularity): string {
  if (granularity === 'month') return `${MONTHS[Number(period.slice(5, 7)) - 1] ?? period} ${period.slice(0, 4)}`
  if (granularity === 'week') return `Semana del ${formatYmd(period)}`
  return formatYmd(period)
}

const RATE_COLUMNS: Column[] = [
  { header: 'Puntualidad', kind: 'share' },
  { header: 'Llegadas tarde', kind: 'share' },
  { header: 'Ausentismo', kind: 'share' },
  { header: 'Cobertura', kind: 'share' },
]

const rateCells = (c: RangeCounts) => [share(c.onTime, c.present), share(c.late, c.present), share(c.absent, c.planned), share(c.present, c.planned)]

function evolutionTable(body: StaffDashboardBody): TableBlock {
  const granularity = body.meta.granularity as SeriesGranularity
  const rows = (body.seriesMulti ?? []).filter((point) => point.counts.planned > 0)
  return {
    kind: 'table',
    title: `Evolución por ${GRANULARITY_NAMES[granularity]}`,
    sheet: 'Evolución',
    description: 'Puntualidad y tardanzas sobre las entradas registradas; ausentismo y cobertura sobre lo planificado. Sólo los períodos con registros.',
    columns: [{ header: 'Período', weight: 2.2 }, { header: 'Registros', kind: 'count' }, ...RATE_COLUMNS],
    rows: rows.map((point) => [bucketLabel(point.period, granularity), point.counts.planned, ...rateCells(point.counts)]),
    empty: 'No hay registros planificados en el período.',
  }
}

export function distributionParts(body: StaffDashboardBody): Part[] {
  const { rows, totalPlanned } = body.statusDistribution
  const parts: Part[] = rows.map((row) => ({ label: STATUS_LABELS[row.status] ?? row.status, value: row.count }))
  const others = totalPlanned - rows.reduce((acc, row) => acc + row.count, 0)
  if (others > 0) parts.push({ label: 'Otros estados', value: others, muted: true })
  return parts
}

function breakdownTable(title: string, sheet: string, groupHeader: string, rows: readonly DashboardBreakdownRow[]): TableBlock {
  return {
    kind: 'table',
    title,
    sheet,
    columns: [{ header: groupHeader, weight: 2.4 }, { header: 'Registros', kind: 'count' }, ...RATE_COLUMNS],
    rows: rows.map((row) => [row.label, row.plannedCount, ...rateCells(row.counts)]),
    empty: 'No hay registros para comparar.',
  }
}

function trendsSection(body: StaffDashboardBody): ReportSection {
  const breakdowns = body.breakdowns
  return {
    id: 'tendencias',
    title: 'Tendencias',
    blocks: [
      evolutionTable(body),
      {
        kind: 'parts',
        title: 'Distribución de asistencias',
        description: 'Cada registro planificado según cómo terminó la entrada.',
        parts: distributionParts(body),
      },
      breakdownTable('Comparar por rol', 'Por rol', 'Rol', breakdowns.byRole),
      breakdownTable('Comparar por tipo de actividad', 'Por actividad', 'Actividad', breakdowns.byEventType),
      breakdownTable('Comparar por curso', 'Por curso', 'Curso', breakdowns.byCourse),
    ],
  }
}

// ─── Seguimiento ────────────────────────────────────────────────────────────

const personRow = (person: DashboardTopRiskPerson) => [
  person.displayName,
  roleName(person.role),
  person.plannedCount,
  person.lateCount,
  person.absentNotJustifiedCount,
  person.absentJustifiedCount,
  person.riskScore,
]

const PERSON_COLUMNS: Column[] = [
  { header: 'Persona', weight: 2.6 },
  { header: 'Rol', weight: 1.4 },
  { header: 'Registros', kind: 'count' },
  { header: 'Llegadas tarde', kind: 'count' },
  { header: 'Ausencias sin justificar', kind: 'count' },
  { header: 'Ausencias justificadas', kind: 'count' },
  { header: 'Prioridad', kind: 'count' },
]

function eventRow(event: DashboardTopRiskEvent) {
  return [event.title, activityName(event.eventType), event.plannedCount, share(event.counts.late, event.counts.present), share(event.counts.absent, event.counts.planned), event.focusScore]
}

function followUpSection(body: StaffDashboardBody): ReportSection {
  const people = body.topLists.topRiskPeople.filter((person) => person.riskScore > 0)
  const events = body.topLists.topRiskEvents.filter((event) => event.focusScore > 0)
  return {
    id: 'seguimiento',
    title: 'Seguimiento',
    intro: 'Estas listas ayudan a revisar casos. Los puntajes no generan sanciones automáticas.',
    blocks: [
      {
        kind: 'table',
        title: 'Personas para revisar',
        sheet: 'Personas para revisar',
        description: 'Prioridad: llegadas tarde + ausencias sin justificar × 2. Hasta 10 personas, de más a menos.',
        columns: PERSON_COLUMNS,
        rows: people.map(personRow),
        empty: 'Nadie tiene llegadas tarde ni ausencias sin justificar en el período.',
      },
      {
        kind: 'table',
        title: 'Actividades para revisar',
        sheet: 'Actividades para revisar',
        description: 'Índice: porcentaje de llegadas tarde + porcentaje de ausencias. Hasta 10 actividades, de más a menos.',
        columns: [
          { header: 'Actividad', weight: 2.6 },
          { header: 'Tipo', weight: 1.3 },
          { header: 'Registros', kind: 'count' },
          { header: 'Llegadas tarde', kind: 'share' },
          { header: 'Ausencias', kind: 'share' },
          { header: 'Índice', kind: 'decimal', digits: 2 },
        ],
        rows: events.map(eventRow),
        empty: 'Ninguna actividad tiene llegadas tarde ni ausencias en el período.',
      },
    ],
  }
}

function peopleSection(people: readonly DashboardTopRiskPerson[]): ReportSection {
  const sorted = [...people].sort((a, b) => a.displayName.localeCompare(b.displayName, 'es'))
  return {
    id: 'personas',
    title: 'Por persona',
    intro: 'Todas las personas con registros planificados en el período, en orden alfabético.',
    blocks: [
      {
        kind: 'table',
        title: 'Todas las personas',
        sheet: 'Por persona',
        columns: [...PERSON_COLUMNS.slice(0, 3), { header: 'Presencias', kind: 'share' }, ...PERSON_COLUMNS.slice(3)],
        rows: sorted.map((person) => {
          const [name, role, planned, ...rest] = personRow(person)
          return [name, role, planned, share(person.presentCount, person.plannedCount), ...rest]
        }),
        empty: 'Nadie tiene registros planificados en el período.',
      },
    ],
  }
}

// ─── Informe ────────────────────────────────────────────────────────────────

export function buildStaffReport(input: StaffReportInput): ReportDoc {
  const { body } = input
  const subtitle = `Del ${formatYmd(body.meta.rangeFrom)} al ${formatYmd(body.meta.rangeTo)}${input.personName ? ` · ${input.personName}` : ''}`
  const base = { title: 'Indicadores del personal', subtitle, filters: staffReportFilters(input), filename: filename(input), generatedAt: input.generatedAt }
  if (body.counts.planned === 0) {
    return {
      ...base,
      sections: [{ id: 'resumen', title: 'Resumen', blocks: [{ kind: 'note', lines: ['No hay registros planificados para estos filtros.'] }] }],
    }
  }
  return { ...base, sections: [summarySection(input), trendsSection(body), followUpSection(body), peopleSection(input.people)] }
}
