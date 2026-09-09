import { apiBaseUrl } from '@/lib/api/client'
import { formatHundredths } from '@/lib/academic-config/grade-value'
import type { ActivityCategory } from '@/lib/gradebook/activity-category'
import { ACTIVITY_CATEGORY_LABEL } from '@/lib/gradebook/activity-category'
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

/**
 * Abre una ventana imprimible con el informe de evaluaciones del alumno
 * (orales / escritos / otras actividades), alineado al formato de la libreta de referencia.
 */
export function printStudentEvaluations(input: {
  detail: GradeBookDetail
  student: RosterStudent
  index: number
  libretaLabel: string
  rows: readonly PrintGradeRow[]
  photoUrl: string | null
}): void {
  const { detail, student, index, libretaLabel, rows, photoUrl } = input
  const byPeriod = new Map<string, PrintGradeRow[]>()
  for (const row of rows) {
    const bucket = byPeriod.get(row.periodName)
    if (bucket) bucket.push(row)
    else byPeriod.set(row.periodName, [row])
  }

  const periodsHtml = [...byPeriod.entries()]
    .map(([periodName, periodRows]) => {
      const avg = (cat: ActivityCategory) => {
        const vals = periodRows
          .filter((r) => r.category === cat && !r.isAbsent && r.valueHundredths != null)
          .map((r) => r.valueHundredths as number)
        if (vals.length === 0) return '—'
        const mean = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
        return formatHundredths(mean, periodRows[0]?.decimals ?? 0)
      }
      const all = periodRows
        .filter((r) => !r.isAbsent && r.valueHundredths != null)
        .map((r) => r.valueHundredths as number)
      const result =
        all.length === 0
          ? '—'
          : formatHundredths(Math.round(all.reduce((a, b) => a + b, 0) / all.length), periodRows[0]?.decimals ?? 0)

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

      return `<section class="period">
        <h2>${escapeHtml(periodName)}</h2>
        <table class="summary">
          <thead><tr>
            <th>${ACTIVITY_CATEGORY_LABEL.oral}</th>
            <th>${ACTIVITY_CATEGORY_LABEL.written}</th>
            <th>${ACTIVITY_CATEGORY_LABEL.other}</th>
            <th>R</th>
            <th>J.</th><th>NJ.</th><th>Fictas</th>
          </tr></thead>
          <tbody><tr>
            <td>${avg('oral')}</td><td>${avg('written')}</td><td>${avg('other')}</td><td>${result}</td>
            <td></td><td></td><td>${student.absences ?? ''}</td>
          </tr></tbody>
        </table>
        <table class="detail">
          <thead><tr><th>Fecha</th><th>Tipo</th><th>Calificación</th><th>Comentario</th></tr></thead>
          <tbody>${detailRows || '<tr><td colspan="4">Sin calificaciones</td></tr>'}</tbody>
        </table>
      </section>`
    })
    .join('')

  const photo = photoUrl
    ? `<img src="${photoUrl}" alt="" width="96" height="120" style="object-fit:cover;border:1px solid #ccc" />`
    : `<div style="width:96px;height:120px;border:1px dashed #999;background:#f5f5f5"></div>`

  const html = `<!doctype html>
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

  // Blob URL: evita `about:blank` vacío. Con `noopener` en window.open('', ...) el handle
  // vuelve null y no se puede escribir el HTML.
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const win = window.open(url, '_blank')
  if (!win) {
    URL.revokeObjectURL(url)
    throw new Error('El navegador bloqueó la ventana de impresión. Permití pop-ups para localhost.')
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
