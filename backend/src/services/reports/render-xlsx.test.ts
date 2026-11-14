import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { share, type Column, type ReportDoc } from './model.js'
import { renderReportXlsx, SheetNames, sheetHeaders, sheetRow } from './render-xlsx.js'

const COLUMNS: Column[] = [
  { header: 'Persona' },
  { header: 'Planificadas', kind: 'count' },
  { header: 'Puntualidad', kind: 'share' },
  { header: 'Promedio', kind: 'decimal' },
]

const REPORT: ReportDoc = {
  title: 'Indicadores de estudiantes',
  subtitle: 'Ciclo 2026 · notas de 2.ª Entrega',
  filters: ['Ciclo: Ciclo 2026'],
  generatedAt: new Date('2026-11-13T17:05:00.000Z'),
  filename: 'Indicadores de estudiantes',
  sections: [
    {
      id: 'resumen',
      title: 'Resumen',
      blocks: [
        { kind: 'tiles', tiles: [{ label: 'Necesitan atención', value: '12', detail: '12 de 88 (13,6 %) estudiantes del ciclo.' }] },
        { kind: 'parts', title: 'Cómo terminó el año', parts: [{ label: 'Promovieron', value: 30 }, { label: 'Repitieron', value: 10, alert: true }] },
        { kind: 'note', lines: ['No decide promociones ni sanciones.'] },
        {
          kind: 'table',
          title: 'Quién necesita atención',
          sheet: 'Quién necesita atención',
          columns: COLUMNS,
          rows: [
            ['Pérez, Ana', 20, share(17, 20), 7.5],
            ['Suárez, Luis', 0, share(0, 0), null],
          ],
          empty: 'Nadie.',
        },
        { kind: 'bars', title: 'Por mes', bars: [{ label: 'Mar', value: 90, text: '90 %' }], min: 0, max: 100 },
      ],
    },
    {
      id: 'asistencia',
      title: 'Asistencia',
      blocks: [{ kind: 'table', title: 'Faltas seguidas', sheet: 'Faltas seguidas', columns: COLUMNS, rows: [], empty: 'Nadie tiene faltas seguidas.' }],
    },
  ],
}

async function load(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer)
  return workbook
}

describe('nombres de hoja', () => {
  it('sin caracteres prohibidos, hasta 31 letras y sin repetir', () => {
    const names = new SheetNames()
    expect(names.take('Notas: bajas/altas')).toBe('Notas bajas altas')
    expect(names.take('Una hoja con un nombre larguísimo que no entra')).toHaveLength(31)
    expect(names.take('Por curso')).toBe('Por curso')
    expect(names.take('por curso')).toBe('por curso (2)')
  })
})

describe('parte sobre total en el Excel', () => {
  it('se abre en cantidad, total y %', () => {
    expect(sheetHeaders(COLUMNS)).toEqual(['Persona', 'Planificadas', 'Puntualidad', 'Puntualidad (total)', 'Puntualidad (%)', 'Promedio'])
    expect(sheetRow(COLUMNS, ['Pérez, Ana', 20, share(17, 20), 7.5])).toEqual(['Pérez, Ana', 20, 17, 20, 0.85, 7.5])
    expect(sheetRow(COLUMNS, ['Suárez, Luis', 0, share(0, 0), null])).toEqual(['Suárez, Luis', 0, 0, 0, null, null])
  })
})

describe('renderReportXlsx', () => {
  it('un resumen y una hoja por tabla', async () => {
    const workbook = await load(await renderReportXlsx(REPORT, { name: 'Liceo', logo: null }))
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Resumen', 'Quién necesita atención', 'Faltas seguidas'])

    const summary = workbook.getWorksheet('Resumen')!
    const texts = summary.getColumn(1).values.filter(Boolean).map(String)
    expect(texts).toEqual(expect.arrayContaining(['Liceo', 'Indicadores de estudiantes', 'Resumen', 'Repitieron (en alerta)']))
    expect(texts.some((text) => text.includes('en la hoja «Quién necesita atención»'))).toBe(true)
  })

  it('los porcentajes quedan como número con formato de %', async () => {
    const workbook = await load(await renderReportXlsx(REPORT, { name: null, logo: null }))
    const sheet = workbook.getWorksheet('Quién necesita atención')!
    expect(sheet.getRow(1).getCell(5).value).toBe('Puntualidad (%)')
    expect(sheet.getRow(2).getCell(5).value).toBeCloseTo(0.85)
    expect(sheet.getRow(2).getCell(5).numFmt).toBe('0.0%')
    expect(sheet.getRow(3).getCell(5).value).toBeNull()
  })

  it('una tabla vacía dice por qué', async () => {
    const workbook = await load(await renderReportXlsx(REPORT, { name: null, logo: null }))
    expect(workbook.getWorksheet('Faltas seguidas')!.getRow(2).getCell(1).value).toBe('Nadie tiene faltas seguidas.')
  })
})
