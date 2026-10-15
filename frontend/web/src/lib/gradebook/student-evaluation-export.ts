import { apiBaseUrl } from '@/lib/api/client'
import { formatHundredths } from '@/lib/academic-config/grade-value'
import type { ActivityCategory } from '@/lib/gradebook/activity-category'
import { ACTIVITY_CATEGORY_LABEL } from '@/lib/gradebook/activity-category'
import { blockCategories, formatGradeList } from '@/lib/gradebook/period-blocks'
import type { GradeBookDetail, RosterStudent } from '@/lib/gradebook/types'

export type PrintGradeRow = {
  date: string
  typeName: string
  valueHundredths: number | null
  isAbsent: boolean
  comment: string | null
  periodName: string
  decimals: number
  category: ActivityCategory
}

/** `2026-04-22` → `22/04/26`. */
export function formatYmdShort(ymd: string): string {
  const [y, m, d] = ymd.split('-')
  if (!y || !m || !d) return ymd
  return `${d}/${m}/${y.slice(2)}`
}

export function gradeTooltipLine(row: {
  date: string
  comment: string | null
  title: string
}): string {
  const label = (row.comment || row.title || '').trim() || 'Sin comentario'
  return `${formatYmdShort(row.date)} - ${label}`
}

export async function downloadStudentEvaluationsXlsx(
  gradeBookId: string,
  studentId: string,
): Promise<void> {
  const res = await fetch(
    `${apiBaseUrl()}/gradebook/${gradeBookId}/exports/students/${studentId}/xlsx`,
    { credentials: 'include', cache: 'no-store' },
  )
  if (!res.ok) {
    const message =
      res.status === 403
        ? 'No tenés permiso para exportar esta libreta.'
        : `No se pudo generar el Excel (${res.status})`
    throw new Error(message)
  }
  const blob = await res.blob()
  const disposition = res.headers.get('Content-Disposition') ?? ''
  const match = /filename="([^"]+)"/.exec(disposition)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = match?.[1] ?? 'evaluaciones.xlsx'
  link.click()
  URL.revokeObjectURL(url)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export type PrintPeriodResult = {
  c: number | null
  r: number | null
  /** Juicio o informe del período, si se cargó. */
  judgement?: string | null
}

export type PrintStudentEvaluationsInput = {
  detail: GradeBookDetail
  student: RosterStudent
  index: number
  libretaLabel: string
  rows: readonly PrintGradeRow[]
  photoUrl: string | null
  /**
   * Períodos de la libreta, en orden. Sin ellos sólo salían los que tienen notas sueltas: las
   * entregas y el diagnóstico (que no admiten evaluaciones) se imprimían sin su C ni su R.
   */
  periods?: readonly { name: string }[]
  /** C, R y juicio de cada período, por nombre de período. */
  periodResults?: Record<string, PrintPeriodResult>
  /** Decimales de la escala del nivel, para los períodos sin notas sueltas. */
  decimals?: number
}

function hasPeriodResult(result: PrintPeriodResult | undefined): boolean {
  return Boolean(result && (result.c != null || result.r != null || result.judgement?.trim()))
}

/** Los períodos a imprimir, en el orden de la libreta: los que tienen notas sueltas, C, R o juicio. */
export function printablePeriods(
  input: Pick<PrintStudentEvaluationsInput, 'rows' | 'periods' | 'periodResults'>,
): Array<{ name: string; rows: PrintGradeRow[] }> {
  const byPeriod = new Map<string, PrintGradeRow[]>()
  for (const period of input.periods ?? []) byPeriod.set(period.name, [])
  for (const row of input.rows) {
    const bucket = byPeriod.get(row.periodName)
    if (bucket) bucket.push(row)
    else byPeriod.set(row.periodName, [row])
  }
  return [...byPeriod.entries()]
    .filter(([name, rows]) => rows.length > 0 || hasPeriodResult(input.periodResults?.[name]))
    .map(([name, rows]) => ({ name, rows }))
}

function periodSectionHtml(
  periodName: string,
  periodRows: readonly PrintGradeRow[],
  result: PrintPeriodResult,
  student: RosterStudent,
  fallbackDecimals: number,
): string {
  // Las notas sueltas de cada columna, como en la planilla: nunca un promedio.
  const decimals = periodRows[0]?.decimals ?? fallbackDecimals
  const categories = periodRows.length > 0 ? blockCategories(periodRows) : []
  const notes = (cat: ActivityCategory) =>
    escapeHtml(formatGradeList(periodRows.filter((r) => r.category === cat), decimals))
  // Faltas sólo donde hay clases evaluadas; en una entrega sin notas sueltas no aplican.
  const attendanceHeads = periodRows.length > 0 ? '<th>J.</th><th>NJ.</th><th>Fictas</th>' : ''
  const attendanceCells = periodRows.length > 0 ? `<td></td><td></td><td>${student.absences ?? ''}</td>` : ''

  const detailRows = periodRows
    .map(
      (r) => `<tr>
            <td>${escapeHtml(formatYmdShort(r.date))}</td>
            <td>${escapeHtml(r.typeName)}</td>
            <td>${r.isAbsent ? 'Ausente' : escapeHtml(formatHundredths(r.valueHundredths, r.decimals))}</td>
            <td>${escapeHtml(r.comment || '')}</td>
          </tr>`,
    )
    .join('')
  const detailTable = periodRows.length > 0
    ? `<table class="detail">
          <thead><tr><th>Fecha</th><th>Tipo</th><th>Calificación</th><th>Comentario</th></tr></thead>
          <tbody>${detailRows}</tbody>
        </table>`
    : ''
  const judgement = result.judgement?.trim()
    ? `<p class="judgement"><strong>Juicio:</strong> ${escapeHtml(result.judgement.trim())}</p>`
    : ''

  return `<section class="period">
        <h2>${escapeHtml(periodName)}</h2>
        <table class="summary">
          <thead><tr>
            ${categories.map((cat) => `<th>${ACTIVITY_CATEGORY_LABEL[cat]}</th>`).join('')}
            <th>C</th><th>R</th>
            ${attendanceHeads}
          </tr></thead>
          <tbody><tr>
            ${categories.map((cat) => `<td>${notes(cat)}</td>`).join('')}
            <td>${escapeHtml(formatHundredths(result.c, decimals))}</td>
            <td><strong>${escapeHtml(formatHundredths(result.r, decimals))}</strong></td>
            ${attendanceCells}
          </tr></tbody>
        </table>
        ${judgement}
        ${detailTable}
      </section>`
}

/** HTML del informe de evaluaciones del alumno, tal como se imprime. */
export function buildStudentEvaluationsHtml(input: PrintStudentEvaluationsInput): string {
  const { detail, student, index, libretaLabel, photoUrl, periodResults = {}, decimals = 0 } = input
  const periodsHtml = printablePeriods(input)
    .map(({ name, rows }) =>
      periodSectionHtml(name, rows, periodResults[name] ?? { c: null, r: null }, student, decimals),
    )
    .join('')

  const photo = photoUrl
    ? `<img src="${photoUrl}" alt="" width="96" height="120" style="object-fit:cover;border:1px solid #ccc" />`
    : `<div style="width:96px;height:120px;border:1px dashed #999;background:#f5f5f5"></div>`

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8" />
<title>Evaluaciones — ${escapeHtml(student.lastName)}</title>
<style>
  body{font-family:system-ui,Segoe UI,sans-serif;color:#111;margin:24px;font-size:12px}
  h1{font-size:16px;text-align:center;text-decoration:underline;margin:0 0 16px}
  .header{display:flex;gap:16px;align-items:flex-start;margin-bottom:16px}
  .meta dt{color:#555;font-size:11px} .meta dd{margin:0 0 4px;font-weight:600}
  .period{margin-top:18px;page-break-inside:avoid}
  .period h2{font-size:13px;margin:0 0 6px;border-bottom:1px solid #333;padding-bottom:2px}
  table{border-collapse:collapse;width:100%;margin-bottom:8px}
  th,td{border:1px solid #999;padding:3px 6px;text-align:left}
  th{background:#f3f3f3}
  .summary th,.summary td{text-align:center}
  .judgement{margin:0 0 8px}
  @media print{body{margin:12px} button{display:none}}
</style></head><body>
  <button type="button" onclick="window.print()">Imprimir</button>
  <h1>Evaluaciones: ${escapeHtml(libretaLabel)}</h1>
  <div class="header">
    ${photo}
    <dl class="meta">
      <dt>N°</dt><dd>${index + 1}</dd>
      <dt>Apellido</dt><dd>${escapeHtml(student.lastName)}</dd>
      <dt>Nombre</dt><dd>${escapeHtml(student.firstName)}</dd>
      <dt>Documento</dt><dd>${escapeHtml(student.documentId || '—')}</dd>
      <dt>Curso / Asignatura</dt><dd>${escapeHtml(detail.course.name)} · ${escapeHtml(detail.subject.name)}</dd>
    </dl>
  </div>
  ${periodsHtml || '<p>Sin calificaciones registradas.</p>'}
  <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250))</script>
</body></html>`
}

/**
 * Abre una ventana imprimible con el informe de evaluaciones del alumno
 * (orales / escritos / otras actividades, y C, R y juicio de cada período).
 */
export function printStudentEvaluations(input: PrintStudentEvaluationsInput): void {
  const html = buildStudentEvaluationsHtml(input)

  // Blob URL: evita `about:blank` vacío. Con `noopener` en window.open('', ...) el handle
  // vuelve null y no se puede escribir el HTML.
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const win = window.open(url, '_blank')
  if (!win) {
    URL.revokeObjectURL(url)
    throw new Error('El navegador bloqueó la ventana de impresión. Permití las ventanas emergentes para este sitio.')
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
