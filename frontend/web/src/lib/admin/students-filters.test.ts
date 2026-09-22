import { describe, expect, it } from 'vitest'
import {
  buildStudentListQuery,
  cycleTuitionMonth,
  monthsForYear,
  STUDENT_PAGE_SIZE,
  tuitionSummaryText,
  tuitionYearForRow,
  type TuitionMonthRow,
} from './students-filters'

const base = {
  page: 1,
  q: '',
  courseId: '',
  orientationId: '',
  status: '',
  tuitionYear: '2026',
  tuitionMonth: '',
  tuitionPaid: '',
}

function parse(query: string) {
  return Object.fromEntries(new URLSearchParams(query))
}

describe('buildStudentListQuery', () => {
  it('siempre pagina y previsualiza el año', () => {
    expect(parse(buildStudentListQuery(base))).toEqual({
      page: '1',
      pageSize: String(STUDENT_PAGE_SIZE),
      tuitionPreviewYear: '2026',
    })
  })

  it('ignora un año mal escrito', () => {
    expect(parse(buildStudentListQuery({ ...base, tuitionYear: '26' }))).not.toHaveProperty('tuitionPreviewYear')
  })

  it('recorta el texto de búsqueda', () => {
    expect(parse(buildStudentListQuery({ ...base, q: '  pérez  ' })).q).toBe('pérez')
  })

  it('omite la búsqueda si solo tiene espacios', () => {
    expect(parse(buildStudentListQuery({ ...base, q: '   ' }))).not.toHaveProperty('q')
  })

  it('pasa curso, orientación y estado', () => {
    const q = parse(buildStudentListQuery({ ...base, courseId: 'c1', orientationId: 'o1', status: 'ACTIVE' }))
    expect(q).toMatchObject({ courseId: 'c1', orientationId: 'o1', status: 'ACTIVE' })
  })

  it('el año solo filtra cuando además hay mes o estado de pago', () => {
    expect(parse(buildStudentListQuery(base))).not.toHaveProperty('tuitionYear')
    expect(parse(buildStudentListQuery({ ...base, tuitionMonth: '3' }))).toMatchObject({
      tuitionYear: '2026',
      tuitionMonth: '3',
    })
  })

  it('acepta el filtro de pago en ambos sentidos', () => {
    expect(parse(buildStudentListQuery({ ...base, tuitionPaid: 'true' })).tuitionPaid).toBe('true')
    expect(parse(buildStudentListQuery({ ...base, tuitionPaid: 'false' })).tuitionPaid).toBe('false')
  })

  it('descarta un valor de pago que no sea booleano', () => {
    expect(parse(buildStudentListQuery({ ...base, tuitionPaid: 'quizás' }))).not.toHaveProperty('tuitionPaid')
  })

  it('el estado Moodle es opt-in porque cuesta una llamada al web service', () => {
    expect(parse(buildStudentListQuery(base))).not.toHaveProperty('includeMoodle')
    expect(parse(buildStudentListQuery({ ...base, includeMoodle: true })).includeMoodle).toBe('1')
  })
})

describe('monthsForYear', () => {
  it('devuelve siempre los 12 meses', () => {
    expect(monthsForYear([], 2026)).toHaveLength(12)
  })

  it('distingue pagado, pendiente y sin registrar', () => {
    const cells = monthsForYear(
      [
        { year: 2026, month: 1, paid: true },
        { year: 2026, month: 2, paid: false },
      ],
      2026,
    )
    expect(cells[0].status).toBe('paid')
    expect(cells[1].status).toBe('pending')
    expect(cells[2].status).toBe('none')
  })

  it('ignora las cuotas de otro año', () => {
    expect(monthsForYear([{ year: 2025, month: 1, paid: true }], 2026)[0].status).toBe('none')
  })
})

describe('tuitionSummaryText', () => {
  it('resume los tres estados', () => {
    const cells = monthsForYear(
      [
        { year: 2026, month: 1, paid: true },
        { year: 2026, month: 2, paid: false },
      ],
      2026,
    )
    expect(tuitionSummaryText(cells)).toBe('1 pagos · 1 pendientes · 10 sin estado')
  })
})

describe('tuitionYearForRow', () => {
  it('una fila con ciclo propio manda sobre el filtro', () => {
    expect(tuitionYearForRow({ schoolYearCode: 2024 }, '2026', 2026)).toBe(2024)
  })

  it('sin ciclo propio usa el año del filtro', () => {
    expect(tuitionYearForRow({ schoolYearCode: null }, '2026', 2020)).toBe(2026)
  })

  it('cae al año por defecto si el filtro no es un número', () => {
    expect(tuitionYearForRow({}, 'abc', 2026)).toBe(2026)
  })
})

describe('cycleTuitionMonth', () => {
  const now = () => '2026-05-11T00:00:00.000Z'
  const paidRow: TuitionMonthRow = {
    year: 2026,
    month: 3,
    paid: true,
    paidAt: now(),
    amountCents: 500,
    notes: null,
  }

  it('sin registrar pasa a pagado', () => {
    const rows = cycleTuitionMonth([], 2026, 3, now)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ month: 3, paid: true, paidAt: now() })
  })

  it('pagado pasa a pendiente y limpia fecha e importe', () => {
    const rows = cycleTuitionMonth([paidRow], 2026, 3, now)
    expect(rows[0]).toMatchObject({ paid: false, paidAt: null, amountCents: null })
  })

  it('pendiente vuelve a sin registrar', () => {
    const pending = { ...paidRow, paid: false, paidAt: null }
    expect(cycleTuitionMonth([pending], 2026, 3, now)).toHaveLength(0)
  })

  it('no toca los meses de otro año', () => {
    const other: TuitionMonthRow = { ...paidRow, year: 2025 }
    const rows = cycleTuitionMonth([other], 2026, 3, now)
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.year === 2025)).toMatchObject({ paid: true })
  })
})
