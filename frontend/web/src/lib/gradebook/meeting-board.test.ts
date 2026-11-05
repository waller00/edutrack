import { describe, expect, it } from 'vitest'
import {
  averageHint,
  filterMeetingRows,
  levelLegend,
  meetingFilters,
  meetingTally,
  saveErrorText,
  studentName,
  subjectStatus,
  subjectsText,
} from './meeting-board'

const row = (studentId: string, over: Record<string, unknown> = {}) => ({
  studentId,
  lastName: studentId.toUpperCase(),
  firstName: 'X',
  performanceValueHundredths: null as number | null,
  conductValueHundredths: null as number | null,
  atRisk: false,
  ...over,
})

const ROWS = [
  row('a', { performanceValueHundredths: 700, conductValueHundredths: 800 }),
  row('b', { conductValueHundredths: 900, atRisk: true }),
  row('c', { atRisk: true }),
]

const SUBJECTS = [
  { gradeBookId: 'm', name: 'Matemática', teacher: 'Ana G', periodStatus: 'CLOSED' },
  { gradeBookId: 'f', name: 'Física', teacher: null, periodStatus: 'OPEN' },
  { gradeBookId: 'q', name: 'Química', teacher: 'Beto', periodStatus: 'REOPENED' },
]

const judged = (...ids: string[]) => ({ studentIds: new Set(ids), group: false })

describe('meetingTally', () => {
  it('cuenta lo decidido y lo que falta, cada cosa sobre el grupo', () => {
    const tally = meetingTally(ROWS, SUBJECTS, judged('a'))
    expect(tally).toMatchObject({
      students: 3,
      withPerformance: 1,
      withConduct: 2,
      withJudgement: 1,
      atRisk: 2,
      subjects: 3,
      subjectsClosed: 1,
    })
    expect(tally.openSubjects.map((s) => s.name)).toEqual(['Física', 'Química'])
  })

  it('sin los juicios todavía, no dice «0 de 3»', () => {
    expect(meetingTally(ROWS, SUBJECTS, null).withJudgement).toBeNull()
  })

  it('un alumno con juicio que ya no está en el grupo no cuenta', () => {
    expect(meetingTally(ROWS, [], judged('a', 'otro')).withJudgement).toBe(1)
  })
})

describe('subjectsText', () => {
  it('nombra las materias con su docente', () => {
    expect(subjectsText(SUBJECTS.slice(1))).toBe('Física y Química (Beto)')
    expect(subjectsText(SUBJECTS.slice(0, 1))).toBe('Matemática (Ana G)')
    expect(subjectsText([])).toBe('')
  })

  it('corta a las primeras y dice cuántas más', () => {
    expect(subjectsText(SUBJECTS, 2)).toBe('Matemática (Ana G), Física y 1 más')
  })
})

describe('meetingFilters / filterMeetingRows', () => {
  it('cada filtro dice cuántos deja', () => {
    const tally = meetingTally(ROWS, SUBJECTS, judged('a'))
    expect(meetingFilters(tally)).toEqual([
      { id: 'all', label: 'Todos', count: 3 },
      { id: 'alert', label: 'En alerta', count: 2 },
      { id: 'no-performance', label: 'Sin rendimiento', count: 2 },
      { id: 'no-judgement', label: 'Sin juicio', count: 2 },
    ])
  })

  it('«Sin juicio» espera a los juicios', () => {
    expect(meetingFilters(meetingTally(ROWS, SUBJECTS, null)).map((f) => f.id)).not.toContain('no-judgement')
  })

  it('filtra por alerta, rendimiento y juicio', () => {
    const ids = (rows: { studentId: string }[]) => rows.map((r) => r.studentId)
    expect(ids(filterMeetingRows(ROWS, 'all', null))).toEqual(['a', 'b', 'c'])
    expect(ids(filterMeetingRows(ROWS, 'alert', null))).toEqual(['b', 'c'])
    expect(ids(filterMeetingRows(ROWS, 'no-performance', null))).toEqual(['b', 'c'])
    expect(ids(filterMeetingRows(ROWS, 'no-judgement', judged('b')))).toEqual(['a', 'c'])
    // Sin saber los juicios, no esconde a nadie.
    expect(ids(filterMeetingRows(ROWS, 'no-judgement', null))).toEqual(['a', 'b', 'c'])
  })
})

describe('subjectStatus', () => {
  it('cada estado con símbolo y palabra', () => {
    expect(subjectStatus('CLOSED')).toMatchObject({ label: 'Cerrada', symbol: '✓' })
    expect(subjectStatus('REOPENED')).toMatchObject({ label: 'Reabierta', symbol: '↺' })
    expect(subjectStatus('OPEN')).toMatchObject({ label: 'Abierta', symbol: '○' })
    expect(subjectStatus(null)).toMatchObject({ label: 'Sin empezar', symbol: '–' })
  })
})

describe('levelLegend', () => {
  const ins = { label: 'Insuficiente', colorToken: 'red', iconToken: null, isAlert: true }
  const bue = { label: 'Bueno', colorToken: 'green', iconToken: null, isAlert: false }

  it('los tramos a la vista, de la nota más baja a la más alta, sin repetir', () => {
    const legend = levelLegend([
      { valueHundredths: 800, descriptor: bue },
      { valueHundredths: 300, descriptor: ins },
      { valueHundredths: 700, descriptor: bue },
      { valueHundredths: null, descriptor: ins },
      { valueHundredths: 500, descriptor: null },
    ])
    expect(legend.map((item) => [item.label, item.symbol, item.isAlert])).toEqual([
      ['Insuficiente', '▲', true],
      ['Bueno', '✓', false],
    ])
  })
})

describe('textos', () => {
  it('nombra al alumno como en la lista', () => {
    expect(studentName({ lastName: 'Díaz', firstName: 'Ana' })).toBe('Díaz, Ana')
  })

  it('dice qué no se guardó, de quién y por qué', () => {
    expect(saveErrorText('performance', { lastName: 'Díaz', firstName: 'Ana' }, 'Sin conexión.')).toBe(
      'No se guardó el rendimiento de Díaz, Ana. Sin conexión.',
    )
    expect(saveErrorText('conduct', { lastName: 'Díaz', firstName: 'Ana' }, '')).toBe('No se guardó la conducta de Díaz, Ana.')
  })

  it('el promedio de referencia, o nada', () => {
    expect(averageHint(733)).toBe('prom. 7,3')
    expect(averageHint(null)).toBeNull()
  })
})
