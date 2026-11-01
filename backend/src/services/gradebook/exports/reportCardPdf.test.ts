import { describe, expect, it } from 'vitest'
import { buildReportCard, type ReportCardSubject } from '../report-card.js'
import { generateReportCardPdf, generateReportCardsPdf } from './reportCardPdf.js'

const subject = (over: Partial<ReportCardSubject> = {}): ReportCardSubject => ({
  subjectName: 'Matemática',
  closed: true,
  conductValueHundredths: 800,
  valueHundredths: 800,
  conceptualJudgement: 'Has trabajado muy bien y cumplido con las tareas. Continúa con ese compromiso y dedicación.',
  ...over,
})

const card = (subjects: ReportCardSubject[], meetingJudgement: string | null = 'Valoramos su cambio de actitud.') =>
  buildReportCard({
    student: { firstName: 'Orazio', lastName: 'Liesegang Rodríguez' },
    group: { courseName: '7.º', orientationName: null, schoolYearLabel: '2026' },
    period: { name: '3.ª Entrega (3.ª Reunión)', columnLabel: 'Ago-Set', judgementLabel: 'Informe de actuación' },
    subjects,
    meetingJudgement,
    attendance: { absenceHundredths: 300, justified: 1, unjustified: 2, lates: 1, untilYmd: '2026-09-30' },
  })

/** Hojas del PDF: pdfkit escribe un objeto `/Type /Page` por cada una. */
const pageCount = (pdf: Buffer) => pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0

const THIRTEEN = Array.from({ length: 13 }, (_, i) => subject({ subjectName: `Asignatura ${i + 1}` }))

describe('generateReportCardPdf', () => {
  it('un boletín con las trece materias de la planilla entra en una hoja', async () => {
    const pdf = await generateReportCardPdf(card(THIRTEEN))
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pageCount(pdf)).toBe(1)
  })

  it('informes largos achican la letra antes de pasar de hoja', async () => {
    const long = 'Orazio continúa avanzando al involucrarse en cada clase y realizar las actividades propuestas. '.repeat(3)
    const pdf = await generateReportCardPdf(card(THIRTEEN.map((s) => ({ ...s, conceptualJudgement: long }))))
    expect(pageCount(pdf)).toBe(1)
  })

  it('si ni con la letra mínima entra, sigue en otra hoja en vez de cortar un informe', async () => {
    const huge = 'Texto muy largo del informe de actuación. '.repeat(45)
    const pdf = await generateReportCardPdf(card(THIRTEEN.map((s) => ({ ...s, conceptualJudgement: huge }))))
    expect(pageCount(pdf)).toBeGreaterThan(1)
  })

  it('materias sin cerrar y sin juicio de reunión no rompen el documento', async () => {
    const pdf = await generateReportCardPdf(card([subject({ closed: false, valueHundredths: null, conductValueHundredths: null, conceptualJudgement: null })], null))
    expect(pageCount(pdf)).toBe(1)
  })
})

describe('generateReportCardsPdf', () => {
  it('cada boletín del grupo empieza en su hoja', async () => {
    const pdf = await generateReportCardsPdf([card(THIRTEEN), card(THIRTEEN), card(THIRTEEN)])
    expect(pageCount(pdf)).toBe(3)
  })
})

describe('encabezado de la institución', () => {
  // PNG de 1×1 con transparencia: pdfkit lo incrusta como imagen más su máscara.
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
  const images = (pdf: Buffer) => pdf.toString('latin1').match(/\/Subtype \/Image/g)?.length ?? 0
  const institution = { name: 'Instituto de Educación Integral', logo: PNG }

  it('el logo se incrusta una sola vez aunque el PDF tenga un boletín por alumno', async () => {
    const one = await generateReportCardsPdf([card(THIRTEEN)], institution)
    const three = await generateReportCardsPdf([card(THIRTEEN), card(THIRTEEN), card(THIRTEEN)], institution)
    expect(images(one)).toBeGreaterThan(0)
    expect(images(three)).toBe(images(one))
    expect(pageCount(three)).toBe(3)
  })

  it('sin logo no hay imágenes, y sólo con el nombre igual se imprime', async () => {
    const pdf = await generateReportCardPdf(card(THIRTEEN), { name: 'Instituto', logo: null })
    expect(images(pdf)).toBe(0)
    expect(pageCount(pdf)).toBe(1)
  })

  it('un logo ilegible no impide imprimir el boletín', async () => {
    const broken = Buffer.concat([PNG.subarray(0, 8), Buffer.from('basura')])
    const pdf = await generateReportCardPdf(card(THIRTEEN), { name: 'Instituto', logo: broken })
    expect(pageCount(pdf)).toBe(1)
  })
})
