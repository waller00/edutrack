import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import StudentMeetingPanel, { type StudentMeetingPanelProps } from './StudentMeetingPanel'
import type { MeetingStudent } from '@/lib/gradebook/meeting-student'

const ROW = {
  studentId: 's1',
  lastName: 'García',
  firstName: 'Marcos',
  cells: [],
  averageHundredths: 440,
  performanceValueHundredths: null,
  conductValueHundredths: 700,
  absenceHundredths: 1450,
  pendingCount: 1,
  alertCount: 4,
  atRisk: true,
}

const DATA: MeetingStudent = {
  student: { studentId: 's1', lastName: 'García', firstName: 'Marcos' },
  period: { id: 'e2', name: '2.ª Entrega' },
  previousPeriod: { id: 'e1', name: '1.ª Entrega' },
  absences: { hundredths: 1450, whole: 14, unjustified: 9, justified: 8, lates: 3 },
  subjects: [
    {
      gradeBookId: 'gb-mat',
      subjectId: 'mat',
      name: 'Matemática',
      teacher: 'Fabián Gómez',
      periodStatus: 'CLOSED',
      valueHundredths: 300,
      descriptor: { label: 'En proceso', descriptor: null, colorToken: 'orange', iconToken: null, isAlert: true },
      proposedValueHundredths: null,
      conductValueHundredths: 600,
      conceptualJudgement: 'No entrega las tareas.',
      previousValueHundredths: 500,
      assessments: [
        { id: 'a1', title: 'Escrito', date: '2026-05-12', periodName: 'Tramo 2', scope: 'GROUP', valueHundredths: 300, isAbsent: false, levelLabel: null, comment: 'Faltó estudiar', missing: false },
        { id: 'a2', title: 'Oral', date: '2026-06-02', periodName: 'Tramo 2', scope: 'GROUP', valueHundredths: null, isAbsent: true, levelLabel: null, comment: null, missing: false },
      ],
      attendance: { period: { absent: 2, justified: 1, late: 0, classes: 20 }, year: { absent: 3, justified: 1, late: 1, classes: 60 } },
    },
    {
      gradeBookId: 'gb-bio',
      subjectId: 'bio',
      name: 'Biología',
      teacher: null,
      periodStatus: 'OPEN',
      valueHundredths: null,
      descriptor: null,
      proposedValueHundredths: null,
      conductValueHundredths: null,
      conceptualJudgement: null,
      previousValueHundredths: null,
      assessments: [],
      attendance: { period: null, year: { absent: 0, justified: 0, late: 0, classes: 0 } },
    },
  ],
}

function records(over: Partial<StudentMeetingPanelProps['records']> = {}): StudentMeetingPanelProps['records'] {
  return { rows: [], current: new Map(), judgements: { studentIds: new Set(), group: false }, loading: false, error: null, save: vi.fn().mockResolvedValue(true), ...over }
}

function props(over: Partial<StudentMeetingPanelProps> = {}): StudentMeetingPanelProps {
  return {
    open: true,
    row: ROW,
    number: 5,
    detail: { status: 'ready', data: DATA },
    onRetry: vi.fn(),
    focusGradeBookId: null,
    previous: null,
    next: null,
    onNavigate: vi.fn(),
    onClose: vi.fn(),
    matrix: {
      group: { courseName: '7 EBI', schoolYear: { id: 'sy', label: '2026' } },
      subjects: [],
      students: [ROW],
      averageLabel: 'Promedio',
      averageDecimals: 1,
      conductLevels: [{ valueHundredths: 700, label: '7' }],
      performanceScale: { minValueHundredths: 100, maxValueHundredths: 1000 },
    },
    canEdit: true,
    saves: {},
    onSave: vi.fn(),
    records: records(),
    fichaHref: '/libreta/estudiante/s1',
    projection: false,
    groupLabel: '7 EBI',
    ...over,
  }
}

describe('<StudentMeetingPanel />', () => {
  it('el encabezado dice quién es, en qué está y cuántas materias bajó', () => {
    render(<StudentMeetingPanel {...props()} />)
    const panel = screen.getByRole('dialog', { name: 'García, Marcos' })
    expect(within(panel).getByText('N.º 5 · 7 EBI · 2.ª Entrega')).toBeInTheDocument()
    expect(within(panel).getByText('4 en alerta')).toBeInTheDocument()
    expect(within(panel).getByText('bajó en 1 materia')).toBeInTheDocument()
    expect(within(panel).getByText('1 sin R')).toBeInTheDocument()
  })

  it('las faltas del liceo con el desglose y lo que dice el boletín', () => {
    render(<StudentMeetingPanel {...props()} />)
    const faltas = screen.getByRole('region', { name: /Faltas del liceo/ })
    expect(within(faltas).getByText('14,5')).toBeInTheDocument()
    expect(within(faltas).getByText('· en el boletín: 14')).toBeInTheDocument()
    expect(within(faltas).getByText('días sin justificar')).toBeInTheDocument()
  })

  it('cada materia resumida; desplegada, sus evaluaciones, C, juicio y faltas a esa materia', () => {
    render(<StudentMeetingPanel {...props()} />)
    const mat = screen.getByRole('button', { name: /Matemática/ })
    expect(mat).toHaveAttribute('aria-expanded', 'false')
    expect(within(mat).getByText('bajó 5 → 3')).toBeInTheDocument()
    expect(within(mat).getByText('3 faltas en 20 clases')).toBeInTheDocument()
    // Biología sin R, abierta y sin listas: lo dice con palabras.
    const bio = screen.getByRole('button', { name: /Biología/ })
    expect(within(bio).getByText('Sin R')).toBeInTheDocument()
    expect(within(bio).getByText('Sin listas')).toBeInTheDocument()
    expect(within(bio).getByText(/Abierta/)).toBeInTheDocument()

    fireEvent.click(mat)
    expect(mat).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('No rindió')).toBeInTheDocument()
    expect(screen.getByText('«Faltó estudiar»')).toBeInTheDocument()
    expect(screen.getByText('No entrega las tareas.')).toBeInTheDocument()
    expect(screen.getByText('En 2.ª Entrega: 2 sin justificar y 1 justificada, de 20 clases con lista.')).toBeInTheDocument()
    expect(screen.getByText('R en 1.ª Entrega')).toBeInTheDocument()
  })

  it('la materia tocada en la matriz abre desplegada; «Desplegar todas» abre el resto', () => {
    render(<StudentMeetingPanel {...props({ focusGradeBookId: 'gb-mat' })} />)
    expect(screen.getByRole('button', { name: /Matemática/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /Biología/ })).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Desplegar todas' }))
    expect(screen.getByRole('button', { name: /Biología/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Sin evaluaciones en los tramos que informa la reunión.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Plegar todas' })).toBeInTheDocument()
  })

  it('se decide desde el panel: rendimiento con el promedio de referencia, conducta y juicio', async () => {
    const p = props()
    render(<StudentMeetingPanel {...p} />)
    expect(screen.getByText('prom. 4,4 · referencia')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Rendimiento de García, Marcos'), { target: { value: '500' } })
    expect(p.onSave).toHaveBeenCalledWith('performance', ROW, 500)

    fireEvent.click(screen.getByRole('button', { name: 'Escribir el juicio de García, Marcos' }))
    fireEvent.change(screen.getByLabelText('Juicio de García, Marcos'), { target: { value: 'Se cita a la familia.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(p.records.save).toHaveBeenCalledWith('s1', 'Se cita a la familia.')
  })

  it('con un juicio a medio escribir, «Siguiente», Escape o cerrar preguntan antes de perderlo', () => {
    const confirm = vi.spyOn(globalThis, 'confirm').mockReturnValue(false)
    const p = props({ next: { ...ROW, studentId: 's2', lastName: 'Sosa', firstName: 'Beto' } })
    render(<StudentMeetingPanel {...p} />)

    // Sin nada escrito no pregunta.
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente: Sosa, Beto' }))
    expect(confirm).not.toHaveBeenCalled()
    expect(p.onNavigate).toHaveBeenCalledWith('s2')

    fireEvent.click(screen.getByRole('button', { name: 'Escribir el juicio de García, Marcos' }))
    fireEvent.change(screen.getByLabelText('Juicio de García, Marcos'), { target: { value: 'Se cita a la familia.' } })

    fireEvent.click(screen.getByRole('button', { name: 'Siguiente: Sosa, Beto' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar el panel del alumno' }))
    expect(confirm).toHaveBeenCalledTimes(3)
    expect(confirm.mock.calls[0][0]).toBe('El juicio de García, Marcos no está guardado. ¿Salir sin guardarlo?')
    // «Cancelar» deja todo como estaba: el texto sigue ahí.
    expect(p.onNavigate).toHaveBeenCalledTimes(1)
    expect(p.onClose).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Juicio de García, Marcos')).toHaveValue('Se cita a la familia.')

    // «Aceptar» sigue de largo.
    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente: Sosa, Beto' }))
    expect(p.onNavigate).toHaveBeenCalledTimes(2)
    confirm.mockRestore()
  })

  it('sin permiso de control, el panel se lee', () => {
    render(<StudentMeetingPanel {...props({ canEdit: false })} />)
    expect(screen.queryByLabelText('Rendimiento de García, Marcos')).toBeNull()
    expect(screen.queryByRole('button', { name: /Escribir el juicio/ })).toBeNull()
    expect(screen.getByText('Sin juicio')).toBeInTheDocument()
  })

  it('anterior y siguiente con el nombre; cerrar', () => {
    const p = props({ previous: { ...ROW, studentId: 's0', lastName: 'Acosta', firstName: 'Lola' } })
    render(<StudentMeetingPanel {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Anterior: Acosta, Lola' }))
    expect(p.onNavigate).toHaveBeenCalledWith('s0')
    expect(screen.getByRole('button', { name: 'No hay siguiente' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar el panel del alumno' }))
    expect(p.onClose).toHaveBeenCalled()
  })

  it('mientras carga lo dice, y un error se puede reintentar', () => {
    const { rerender } = render(<StudentMeetingPanel {...props({ detail: { status: 'loading' } })} />)
    expect(screen.getByText('Cargando las materias y las faltas…')).toBeInTheDocument()
    // Lo que decide la reunión no espera al detalle.
    expect(screen.getByLabelText('Rendimiento de García, Marcos')).toBeInTheDocument()

    const p = props({ detail: { status: 'error', error: 'Sin conexión.' } })
    rerender(<StudentMeetingPanel {...p} />)
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar el detalle del alumno. Sin conexión.')
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(p.onRetry).toHaveBeenCalled()
  })
})
