import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import StudentMeetingPanel, { type StudentMeetingPanelProps } from './StudentMeetingPanel'
import type { MeetingStudent } from '@/lib/gradebook/meeting-student'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

const ROW = {
  studentId: 's1',
  lastName: 'García',
  firstName: 'Marcos',
  cells: [],
  averageHundredths: 440,
  absenceHundredths: 1450,
  pendingCount: 1,
  alertCount: 4,
  atRisk: true,
}

const DATA: MeetingStudent = {
  student: { studentId: 's1', lastName: 'García', firstName: 'Marcos' },
  period: { id: 'e2', name: '2.ª Entrega' },
  periodScale: { minValueHundredths: 100, maxValueHundredths: 1000 },
  conductOptions: [6, 7, 8].map((v) => ({ valueHundredths: v * 100, label: String(v) })),
  canCorrect: false,
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
    },
    canEdit: true,
    onCorrected: vi.fn(),
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

  it('desplegada, las notas del período van agrupadas por tramo', () => {
    const tramos: MeetingStudent = {
      ...DATA,
      subjects: [
        {
          ...DATA.subjects[0],
          assessments: [
            { ...DATA.subjects[0].assessments[0], id: 'x1', title: 'Oral 1', periodId: 't1', periodName: '1.er tramo' },
            { ...DATA.subjects[0].assessments[0], id: 'x2', title: 'Escrito 2', periodId: 't2', periodName: '2.º tramo' },
          ],
        },
      ],
    }
    render(<StudentMeetingPanel {...props({ detail: { status: 'ready', data: tramos }, focusGradeBookId: 'gb-mat' })} />)
    const first = screen.getByText('1.er tramo').parentElement!
    expect(within(first).getByText('Oral 1')).toBeInTheDocument()
    expect(within(first).queryByText('Escrito 2')).toBeNull()
    expect(within(screen.getByText('2.º tramo').parentElement!).getByText('Escrito 2')).toBeInTheDocument()
  })

  it('administración corrige una nota con motivo, aunque la libreta esté cerrada, y se recarga', async () => {
    mockedApi.mockReset().mockResolvedValue({ ok: true } as never)
    const p = props({ detail: { status: 'ready', data: { ...DATA, canCorrect: true } }, focusGradeBookId: 'gb-mat' })
    render(<StudentMeetingPanel {...p} />)
    expect(screen.getByText(/Cerrada: una corrección no la reabre/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Corregir la nota de «Escrito» de García, Marcos' }))
    const form = screen.getByRole('form', { name: 'Corregir la nota de «Escrito» de García, Marcos' })
    fireEvent.change(within(form).getByLabelText('Nota'), { target: { value: '500' } })

    // Sin motivo no se manda.
    fireEvent.click(within(form).getByRole('button', { name: 'Guardar corrección' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent('Escribí el motivo de la corrección.')
    expect(mockedApi).not.toHaveBeenCalled()

    fireEvent.change(within(form).getByLabelText(/Motivo de la corrección/), { target: { value: 'Error de carga' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Guardar corrección' }))
    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/admin/gradebook/corrections/gradebooks/gb-mat/assessments/a1/students/s1', {
        method: 'PUT',
        body: JSON.stringify({ valueHundredths: 500, scaleLevelId: null, isAbsent: false, comment: 'Faltó estudiar', reason: 'Error de carga' }),
      }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent('Corregido en Matemática. Se le avisó al docente.')
    expect(p.onCorrected).toHaveBeenCalled()
  })

  it('administración corrige la R y el juicio del docente; si falla, lo dice y no cierra el formulario', async () => {
    mockedApi.mockReset().mockRejectedValueOnce(new Error('La R tiene que ser una nota entera de la escala del nivel.')).mockResolvedValue({ ok: true } as never)
    const p = props({ detail: { status: 'ready', data: { ...DATA, canCorrect: true } }, focusGradeBookId: 'gb-mat' })
    render(<StudentMeetingPanel {...p} />)

    fireEvent.click(screen.getByRole('button', { name: 'Corregir la R de García, Marcos' }))
    const form = screen.getByRole('form', { name: 'Corregir la R de García, Marcos' })
    fireEvent.change(within(form).getByLabelText('R (rendimiento)'), { target: { value: '600' } })
    fireEvent.change(within(form).getByLabelText(/Motivo de la corrección/), { target: { value: 'Pedido del docente' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Guardar corrección' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent('La R tiene que ser una nota entera de la escala del nivel.')
    expect(p.onCorrected).not.toHaveBeenCalled()

    fireEvent.click(within(form).getByRole('button', { name: 'Guardar corrección' }))
    await waitFor(() => expect(p.onCorrected).toHaveBeenCalled())
    expect(mockedApi).toHaveBeenLastCalledWith('/admin/gradebook/corrections/gradebooks/gb-mat/periods/e2/students/s1', {
      method: 'PUT',
      body: JSON.stringify({ meetingValueHundredths: 600, reason: 'Pedido del docente' }),
    })

    fireEvent.click(screen.getByRole('button', { name: 'Corregir el juicio del docente de García, Marcos' }))
    const judgement = screen.getByRole('form', { name: 'Corregir el juicio del docente de García, Marcos' })
    expect(within(judgement).getByLabelText('Juicio del docente')).toHaveValue('No entrega las tareas.')
    fireEvent.click(within(judgement).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('form', { name: /juicio del docente/ })).toBeNull()
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

  it('la reunión decide sólo el juicio: con el promedio de referencia, sin R ni C propias', async () => {
    const p = props()
    render(<StudentMeetingPanel {...p} />)
    expect(screen.getByRole('heading', { name: /Juicio de la reunión/ })).toBeInTheDocument()
    expect(screen.getByText('prom. 4,4 · referencia')).toBeInTheDocument()
    expect(screen.queryByLabelText('Rendimiento de García, Marcos')).toBeNull()
    expect(screen.queryByLabelText('Conducta de García, Marcos')).toBeNull()

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
    render(<StudentMeetingPanel {...props({ canEdit: false, focusGradeBookId: 'gb-mat' })} />)
    expect(screen.queryByRole('button', { name: /Escribir el juicio/ })).toBeNull()
    // Sin `canCorrect` no hay «Corregir».
    expect(screen.queryByRole('button', { name: /^Corregir/ })).toBeNull()
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
    // El juicio no espera al detalle.
    expect(screen.getByRole('button', { name: 'Escribir el juicio de García, Marcos' })).toBeInTheDocument()

    const p = props({ detail: { status: 'error', error: 'Sin conexión.' } })
    rerender(<StudentMeetingPanel {...p} />)
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar el detalle del alumno. Sin conexión.')
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(p.onRetry).toHaveBeenCalled()
  })
})
