// Tipos del endpoint GET /attendance/summary (espejo de PayrollPersonReport del backend)
// y utilidades de presentación compartidas por el panel por persona, el heatmap y "Mis Asistencias".

export type AttendanceSummaryRow = {
  fecha: string // YYYY-MM-DD
  evento: string
  tipoEvento: string
  horaPlanIn: string
  horaPlanOut: string
  horaRealIn: string
  horaRealOut: string
  estado: string
  minTarde: number
  horasTrab: number
  licencia: 'SI' | 'NO'
  observaciones: string
}

export type AttendanceSummaryStats = {
  esperadas: number
  presente: number
  tarde: number
  ausenteJustificado: number
  ausenteNoJustificado: number
  suplido: number
  cobertura: number
  pctPuntualidad: number
  pctAsistencia: number
  pctAusentismo: number
  horasTrabajadas: number
  horasPlanificadas: number
  deltaHoras: number
  minTardeAcumulados: number
  minTardePromedio: number
}

export type AttendanceSummaryPerson = {
  userId: string
  nombre: string
  rol: string
  email: string
  rows: AttendanceSummaryRow[]
  stats: AttendanceSummaryStats
}

export type AttendanceSummaryResponse = {
  from: string
  to: string
  person?: AttendanceSummaryPerson | null
  persons?: AttendanceSummaryPerson[]
}

export type HeatmapCategory = 'present' | 'late' | 'absent' | 'justified' | 'substituted' | 'none'

/** Traduce la etiqueta de estado del payroll a una categoría de color. */
export function estadoToCategory(estado: string): HeatmapCategory {
  const e = estado.toLowerCase()
  if (e.includes('no justificado')) return 'absent'
  if (e.includes('justificad')) return 'justified' // "ausente justificado"
  if (e.includes('tarde')) return 'late'
  if (e.includes('suplido') || e.includes('cobertura')) return 'substituted'
  if (e.includes('presente')) return 'present'
  return 'none'
}

const CATEGORY_SEVERITY: Record<HeatmapCategory, number> = {
  absent: 5,
  late: 4,
  justified: 3,
  substituted: 2,
  present: 1,
  none: 0,
}

export const HEATMAP_CATEGORY_STYLE: Record<HeatmapCategory, { box: string; label: string }> = {
  present: { box: 'bg-emerald-500', label: 'Presente' },
  late: { box: 'bg-amber-400', label: 'Tarde' },
  absent: { box: 'bg-red-500', label: 'Falta sin justificar' },
  justified: { box: 'bg-blue-400', label: 'Falta justificada' },
  substituted: { box: 'bg-rose-300', label: 'Suplida' },
  none: { box: 'bg-slate-100', label: 'Sin actividad' },
}

/** Categoría dominante (peor estado) de un conjunto de filas del mismo día. */
export function dominantCategory(rows: Pick<AttendanceSummaryRow, 'estado'>[]): HeatmapCategory {
  let best: HeatmapCategory = 'none'
  for (const row of rows) {
    const cat = estadoToCategory(row.estado)
    if (CATEGORY_SEVERITY[cat] > CATEGORY_SEVERITY[best]) best = cat
  }
  return best
}

/** Agrupa filas por fecha (YYYY-MM-DD). */
export function groupRowsByDate(rows: AttendanceSummaryRow[]): Map<string, AttendanceSummaryRow[]> {
  const map = new Map<string, AttendanceSummaryRow[]>()
  for (const row of rows) {
    const key = row.fecha
    const list = map.get(key)
    if (list) list.push(row)
    else map.set(key, [row])
  }
  return map
}
