import { formatHundredths } from '@/lib/academic-config/grade-value'
import { ACTIVITY_CATEGORY_LABEL, ACTIVITY_CATEGORY_ORDER, type ActivityCategory } from '@/lib/gradebook/activity-category'
import type { GradeBookDetail, RosterStudent } from '@/lib/gradebook/types'

export type ClosurePrintPeriod = {
  name: string
  status: string
  /** C: la calificación del docente. */
  valueHundredths: number | null
  /** R: la nota de reunión. */
  meetingValueHundredths: number | null
  judgementLabel: string
  conceptualJudgement: string | null
  meetingJudgement: string | null
  /** Notas sueltas por columna, ya formateadas ("7 · 9"); vacío si el período no las admite. */
  notes: Partial<Record<ActivityCategory, string>>
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Imprime el cierre de promedios del alumno (carta + minis + juicios), estilo Libro del Profesor.
 */
export function printStudentClosure(input: {
  detail: GradeBookDetail
  student: RosterStudent
  index: number
  libretaLabel: string
  courseLabel: string
  photoUrl: string | null
  periods: readonly ClosurePrintPeriod[]
}): void {
  const { detail, student, index, libretaLabel, courseLabel, photoUrl, periods } = input

  const cell = (v: number | null) => escapeHtml(formatHundredths(v, 0))
  const minis = periods
    .map((period) => {
      const categories = ACTIVITY_CATEGORY_ORDER.filter((cat) => period.notes[cat] !== undefined)
      return `<div class="mini">
        <p class="mini-title">${escapeHtml(period.name)}</p>
        <table><thead><tr>
          ${categories.map((cat) => `<th>${ACTIVITY_CATEGORY_LABEL[cat]}</th>`).join('')}
          <th>C</th><th>R</th>
        </tr></thead>
        <tbody><tr>
          ${categories.map((cat) => `<td>${escapeHtml(period.notes[cat] ?? '—')}</td>`).join('')}
          <td>${cell(period.valueHundredths)}</td>
          <td><strong>${cell(period.meetingValueHundredths)}</strong></td>
        </tr></tbody></table>
      </div>`
    })
    .join('')

  const rows = periods
    .map((period) => {
      const text = period.conceptualJudgement?.trim()
      return `<tr>
        <td>${escapeHtml(period.name)}${period.status === 'CLOSED' ? ' <em>(cerrado)</em>' : ''}</td>
        <td>${cell(period.valueHundredths)}</td>
        <td><strong>${cell(period.meetingValueHundredths)}</strong></td>
        <td>${text ? `<em>${escapeHtml(period.judgementLabel)}:</em> ${escapeHtml(text)}` : '—'}</td>
        <td>${escapeHtml(period.meetingJudgement?.trim() || '—')}</td>
      </tr>`
    })
    .join('')

  const photo = photoUrl
    ? `<img src="${photoUrl}" alt="" width="96" height="120" style="object-fit:cover;border:1px solid #ccc" />`
    : `<div style="width:96px;height:120px;border:1px dashed #999;background:#f5f5f5"></div>`

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8" />
<title>Cierre — ${escapeHtml(student.lastName)}, ${escapeHtml(student.firstName)}</title>
<style>
  body { font-family: Georgia, "Times New Roman", serif; color: #111; margin: 24px; }
  h1 { font-size: 16px; text-transform: uppercase; letter-spacing: .04em; margin: 0 0 8px; }
  .meta { font-size: 13px; color: #333; margin-bottom: 16px; }
  .head { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 16px; }
  .head dl { margin: 0; font-size: 13px; }
  .head dt { display: inline; color: #666; }
  .head dd { display: inline; margin: 0 12px 0 4px; font-weight: 600; }
  .minis { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
  .mini { border: 1px solid #e2b56f; width: 11rem; font-size: 11px; }
  .mini-title { margin: 0; background: #f6e2b8; text-align: center; padding: 4px; font-weight: 700; }
  .mini table { width: 100%; border-collapse: collapse; }
  .mini th, .mini td { border-top: 1px solid #f0d6a0; padding: 3px; text-align: center; }
  table.judgements { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.judgements th, table.judgements td { border: 1px solid #ddd; padding: 6px 8px; vertical-align: top; }
  table.judgements th { background: #f6e2b8; text-align: left; }
  .print-link { float: right; font-family: system-ui, sans-serif; font-size: 13px; color: #0369a1; }
  @media print { .print-link, button { display: none; } }
</style></head><body>
  <a class="print-link" href="#" onclick="window.print();return false">(Imprimir)</a>
  <h1>Cierre por alumno</h1>
  <p class="meta">${escapeHtml(libretaLabel)} · ${escapeHtml(courseLabel)} · Ciclo ${escapeHtml(String(detail.schoolYear.label))}</p>
  <div class="head">
    ${photo}
    <dl>
      <div><dt>N.º</dt><dd>${index + 1}</dd></div>
      <div><dt>Apellidos:</dt><dd>${escapeHtml(student.lastName)}</dd>
      <dt>Nombres:</dt><dd>${escapeHtml(student.firstName)}</dd></div>
      <div><dt>Documento:</dt><dd>${escapeHtml(student.documentId || '—')}</dd></div>
      <div><dt>Curso/Asig:</dt><dd>${escapeHtml(courseLabel)}</dd></div>
    </dl>
  </div>
  <div class="minis">${minis}</div>
  <h2 style="font-size:14px;margin:0 0 8px">Calificaciones y juicios</h2>
  <table class="judgements">
    <thead><tr>
      <th>Período</th><th>C</th><th>R</th><th>Informe / juicio</th><th>Juicio reunión</th>
    </tr></thead>
    <tbody>${rows || '<tr><td colspan="5">Sin períodos</td></tr>'}</tbody>
  </table>
  <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250))</script>
</body></html>`

  // Blob URL: evita `about:blank` vacío. Con `noopener` en window.open('', ...) el handle
  // vuelve null / la pestaña queda en blanco y no se puede escribir el HTML.
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const win = window.open(url, '_blank')
  if (!win) {
    URL.revokeObjectURL(url)
    throw new Error('El navegador bloqueó la ventana de impresión. Permití pop-ups para este sitio.')
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
