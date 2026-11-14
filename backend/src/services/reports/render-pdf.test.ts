import { describe, expect, it } from 'vitest'
import { share, type ReportDoc, type TableBlock } from './model.js'
import { cellText, renderReportPdf, winAnsi } from './render-pdf.js'

/** Hojas del PDF: pdfkit escribe un objeto `/Type /Page` por cada una. */
const pageCount = (pdf: Buffer) => pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0
const images = (pdf: Buffer) => pdf.toString('latin1').match(/\/Subtype \/Image/g)?.length ?? 0

// PNG de 1×1: alcanza para ver que el logo se incrusta.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

function people(count: number): TableBlock {
  return {
    kind: 'table',
    title: 'Por persona',
    sheet: 'Por persona',
    description: 'Todas las personas del período.',
    columns: [{ header: 'Persona' }, { header: 'Planificadas', kind: 'count' }, { header: 'Puntualidad', kind: 'share' }, { header: 'Promedio', kind: 'decimal' }],
    rows: Array.from({ length: count }, (_, i) => [`Persona ${i + 1}`, 20 + i, share(i % 20, 20), 7.5]),
    empty: 'Nadie en el período.',
  }
}

function report(sections: ReportDoc['sections']): ReportDoc {
  return {
    title: 'Indicadores del personal',
    subtitle: 'Del 01/03/2026 al 13/11/2026',
    filters: ['Personas: Docentes', 'Actividades: Todas'],
    sections,
    filename: 'Indicadores del personal',
    generatedAt: new Date('2026-11-13T17:05:00.000Z'),
  }
}

const everyBlock = report([
  {
    id: 'resumen',
    title: 'Resumen',
    intro: 'Cómo viene el período.',
    blocks: [
      {
        kind: 'tiles',
        tiles: [
          { label: 'Puntualidad', value: '91,2 %', detail: '412 de 452 entradas a tiempo. Subió 1,2 puntos.' },
          { label: 'Ausentismo', value: '4,1 %', detail: '19 de 460 registros planificados.' },
          { label: 'Cobertura', value: '95,9 %', detail: '441 de 460.' },
        ],
      },
      {
        kind: 'parts',
        title: 'Distribución',
        parts: [
          { label: 'Presentes', value: 380 },
          { label: 'Llegadas tarde', value: 40 },
          { label: 'Ausencias sin justificar', value: 12, alert: true },
          { label: 'Sin dato', value: 3, muted: true },
        ],
      },
      { kind: 'note', title: 'Lectura del período', lines: ['Primera señal.', 'Segunda señal.'] },
    ],
  },
  {
    id: 'tendencias',
    title: 'Tendencias',
    blocks: [
      {
        kind: 'bars',
        title: 'Asistencia por mes',
        bars: [
          { label: 'Mar', value: 94.2, text: '94,2 %' },
          { label: 'Abr', value: null, text: '—' },
          { label: 'May', value: 88, text: '88 %' },
        ],
        min: 80,
        max: 100,
        axis: 'Escala: de 80 % a 100 %.',
      },
      people(3),
      { ...people(0), title: 'Vacía', sheet: 'Vacía' },
    ],
  },
])

describe('texto que Helvetica puede dibujar', () => {
  it('conserva tildes, ñ, comillas latinas, guiones y puntos', () => {
    expect(winAnsi('Ñandú – «hola» · 3… — 1.º')).toBe('Ñandú – «hola» · 3… — 1.º')
  })

  it('cambia lo que saldría como basura', () => {
    expect(winAnsi('Notas ▲ alerta')).toBe('Notas  alerta')
    expect(winAnsi('−5')).toBe('-5')
    expect(winAnsi('listo ✓')).toBe('listo ?')
  })
})

describe('celdas', () => {
  it('parte sobre total, cantidades, decimales y vacíos', () => {
    expect(cellText(share(34, 88), { header: 'x', kind: 'share' })).toBe('34 de 88 (38,6 %)')
    expect(cellText(1034, { header: 'x', kind: 'count' })).toBe('1.034')
    expect(cellText(7.5, { header: 'x', kind: 'decimal' })).toBe('7,5')
    expect(cellText(null, { header: 'x' })).toBe('—')
    expect(cellText(undefined, { header: 'x' })).toBe('—')
    expect(cellText('1.º A', { header: 'x' })).toBe('1.º A')
  })
})

describe('renderReportPdf', () => {
  it('dibuja todos los bloques; cada sección arranca en hoja nueva', async () => {
    const pdf = await renderReportPdf(everyBlock, { name: 'Liceo', logo: null })
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pageCount(pdf)).toBe(2)
  })

  it('una tabla larga sigue en las hojas siguientes', async () => {
    const pdf = await renderReportPdf(report([{ id: 'personas', title: 'Por persona', blocks: [people(150)] }]), { name: null, logo: null })
    expect(pageCount(pdf)).toBeGreaterThan(2)
  })

  it('el logo va en cada hoja, incrustado una sola vez', async () => {
    const one = await renderReportPdf(report([{ id: 'a', title: 'A', blocks: [people(2)] }]), { name: 'Liceo', logo: PNG })
    const many = await renderReportPdf(report([{ id: 'a', title: 'A', blocks: [people(150)] }]), { name: 'Liceo', logo: PNG })
    expect(images(one)).toBeGreaterThan(0)
    expect(images(many)).toBe(images(one))
  })

  it('un logo ilegible no impide el informe', async () => {
    const broken = Buffer.concat([PNG.subarray(0, 8), Buffer.from('basura')])
    const pdf = await renderReportPdf(everyBlock, { name: 'Liceo', logo: broken })
    expect(pageCount(pdf)).toBe(2)
  })
})
