import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MeetingDecisions, { studentContext, type JudgementFocus } from './MeetingDecisions'
import { useMeetingRecords, type MeetingRecords } from './meeting/useMeetingRecords'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

const { authState } = vi.hoisted(() => ({ authState: { me: null as unknown } }))
vi.mock('@/contexts/AuthContext', () => ({ useOptionalAuth: () => authState }))

const STUDENTS = [
  { studentId: 's1', firstName: 'Ana', lastName: 'Díaz' },
  { studentId: 's2', firstName: 'Beto', lastName: 'Sosa' },
]

const ANA = { id: 's1', firstName: 'Ana', lastName: 'Díaz' }

/** Los juicios llegan de `useMeetingRecords`, como en la reunión. */
function Harness({
  students = STUDENTS,
  courseOrientationId,
  focus,
  onRecords,
}: {
  students?: Array<(typeof STUDENTS)[number] & Record<string, unknown>>
  courseOrientationId?: string
  focus?: JudgementFocus
  onRecords?: (records: MeetingRecords) => void
}) {
  const records = useMeetingRecords({ courseOfferingId: 'off-1', courseOrientationId, periodId: 'p-1' })
  onRecords?.(records)
  return <MeetingDecisions records={records} students={students} focus={focus} />
}

function setup(rows: unknown[] = []) {
  mockedApi.mockResolvedValue({ data: rows })
  return render(<Harness />)
}

const rowOf = (name: string) => screen.getByText(name).closest('li')!

beforeEach(() => {
  vi.clearAllMocks()
  authState.me = { permissions: [{ id: 'gradebook.review', scope: 'all' }] }
})

describe('<MeetingDecisions />', () => {
  it('separa el juicio general del grupo del de cada alumno', async () => {
    setup([
      { id: 'g', decision: 'El grupo mejoró la convivencia.', createdAt: '2026-06-10T12:00:00.000Z', student: null, createdBy: { id: 'u', name: 'Adscripción' } },
      { id: 'a', decision: 'Valoramos su cambio de actitud.', createdAt: '2026-06-10T12:00:00.000Z', student: ANA, createdBy: null },
    ])

    expect(await screen.findByText('El grupo mejoró la convivencia.')).toBeInTheDocument()
    expect(within(rowOf('Díaz, Ana')).getByText('Valoramos su cambio de actitud.')).toBeInTheDocument()
    // El del grupo no se le asigna a quien no tiene juicio propio.
    expect(within(rowOf('Sosa, Beto')).getByText('Sin juicio')).toBeInTheDocument()
    expect(screen.getByText(/1 de 2 con juicio/)).toBeInTheDocument()
    // Y se explica qué va al boletín y qué no.
    expect(screen.getByText(/queda en la reunión: no se imprime/)).toBeInTheDocument()
  })

  it('muestra sólo el juicio vigente de cada alumno', async () => {
    setup([
      { id: 'nueva', decision: 'Se cita a la familia.', createdAt: '2026-06-12T12:00:00.000Z', student: ANA, createdBy: null },
      { id: 'vieja', decision: 'Continúa con apoyo.', createdAt: '2026-06-10T12:00:00.000Z', student: ANA, createdBy: null },
    ])
    expect(await screen.findByText('Se cita a la familia.')).toBeInTheDocument()
    expect(screen.queryByText('Continúa con apoyo.')).toBeNull()
  })

  it('escribe el juicio de un alumno desde su fila', async () => {
    setup()
    await screen.findByText(/0 de 2 con juicio/)

    fireEvent.click(screen.getByRole('button', { name: 'Escribir el juicio de Sosa, Beto' }))
    fireEvent.change(screen.getByLabelText('Juicio de Sosa, Beto'), { target: { value: 'Se deriva a APE.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(3))
    const [path, init] = mockedApi.mock.calls[1]
    expect(path).toBe('/admin/gradebook/meeting-records')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      courseOfferingId: 'off-1',
      periodId: 'p-1',
      studentId: 's2',
      decision: 'Se deriva a APE.',
    })
  })

  it('el juicio general del grupo no manda studentId', async () => {
    setup()
    await screen.findByText(/0 de 2 con juicio/)

    fireEvent.click(screen.getByRole('button', { name: 'Escribir el juicio del grupo' }))
    fireEvent.change(screen.getByLabelText('Juicio del grupo'), { target: { value: 'Se refuerza convivencia.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(3))
    expect(JSON.parse(String(mockedApi.mock.calls[1][1]?.body)).studentId).toBeUndefined()
  })

  it('cambiar un juicio arranca del vigente', async () => {
    setup([{ id: 'a', decision: 'Trabaja bien.', createdAt: '2026-06-10T12:00:00.000Z', student: ANA, createdBy: null }])
    fireEvent.click(await screen.findByRole('button', { name: 'Cambiar el juicio de Díaz, Ana' }))
    expect(screen.getByLabelText('Juicio de Díaz, Ana')).toHaveValue('Trabaja bien.')
  })

  it('no deja guardar un juicio vacío', async () => {
    setup()
    await screen.findByText(/0 de 2 con juicio/)
    fireEvent.click(screen.getByRole('button', { name: 'Escribir el juicio de Díaz, Ana' }))
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
  })

  it('muestra el error del backend y deja el texto para reintentar', async () => {
    mockedApi.mockResolvedValueOnce({ data: [] }).mockRejectedValueOnce(new Error('Período cerrado'))
    render(<Harness />)
    await screen.findByText(/0 de 2 con juicio/)

    fireEvent.click(screen.getByRole('button', { name: 'Escribir el juicio de Díaz, Ana' }))
    fireEvent.change(screen.getByLabelText('Juicio de Díaz, Ana'), { target: { value: 'Algo más' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Período cerrado')
    expect(screen.getByLabelText('Juicio de Díaz, Ana')).toHaveValue('Algo más')
  })

  it('pide los juicios del grupo con su orientación', async () => {
    mockedApi.mockResolvedValue({ data: [] })
    render(<Harness courseOrientationId="co-1" />)
    await screen.findByText(/0 de 2 con juicio/)
    expect(mockedApi).toHaveBeenCalledWith('/admin/gradebook/meeting-records?courseOfferingId=off-1&periodId=p-1&courseOrientationId=co-1')
  })

  it('los juicios se comparten con la matriz: quién tiene y si está el del grupo', async () => {
    let latest: MeetingRecords | null = null
    mockedApi.mockResolvedValue({
      data: [{ id: 'a', decision: 'Trabaja bien.', createdAt: '2026-06-10T12:00:00.000Z', student: ANA, createdBy: null }],
    })
    render(<Harness onRecords={(records) => (latest = records)} />)
    await waitFor(() => expect(latest?.judgements).toEqual({ studentIds: new Set(['s1']), group: false }))
  })

  it('guardar un juicio no borra el que se está escribiendo para otro alumno', async () => {
    mockedApi.mockResolvedValue({ data: [] })
    render(<Harness />)
    await screen.findByText(/0 de 2 con juicio/)
    fireEvent.click(screen.getByRole('button', { name: 'Escribir el juicio de Díaz, Ana' }))
    fireEvent.change(screen.getByLabelText('Juicio de Díaz, Ana'), { target: { value: 'Mejoró mucho.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Escribir el juicio de Sosa, Beto' }))
    fireEvent.change(screen.getByLabelText('Juicio de Sosa, Beto'), { target: { value: 'Se cita a la familia.' } })

    // Guarda el de Ana; al releer ya lo trae.
    mockedApi.mockImplementation(async (path: string, init?: any) => {
      if (init?.method === 'POST') return { data: {} }
      return { data: [{ id: 'n1', decision: 'Mejoró mucho.', createdAt: '2026-06-10T12:00:00.000Z', student: ANA, createdBy: null }] }
    })
    fireEvent.click(within(rowOf('Díaz, Ana')).getByRole('button', { name: 'Guardar' }))

    // Se cierra el editor de Ana y queda el juicio guardado (el textarea también contiene el texto).
    await waitFor(() => expect(screen.queryByLabelText('Juicio de Díaz, Ana')).toBeNull())
    expect(within(rowOf('Díaz, Ana')).getByText('Mejoró mucho.', { selector: 'p' })).toBeInTheDocument()
    // Lo de Beto sigue ahí, sin guardar.
    expect(screen.getByLabelText('Juicio de Sosa, Beto')).toHaveValue('Se cita a la familia.')
    expect(screen.getByText(/1 de 2 con juicio/)).toBeInTheDocument()
  })

  it('al cambiar de reunión, una respuesta vieja que llega tarde no pisa la nueva', async () => {
    let releaseOld: (value: unknown) => void = () => {}
    mockedApi.mockImplementation((path: string) => {
      if (String(path).includes('periodId=p-1')) return new Promise((resolve) => (releaseOld = resolve))
      return Promise.resolve({ data: [{ id: 'b', decision: 'De la reunión nueva.', createdAt: '2026-06-10T12:00:00.000Z', student: ANA, createdBy: null }] })
    })
    function Switcher({ periodId }: { periodId: string }) {
      const records = useMeetingRecords({ courseOfferingId: 'off-1', periodId })
      return <MeetingDecisions records={records} students={STUDENTS} />
    }
    const { rerender } = render(<Switcher periodId="p-1" />)
    rerender(<Switcher periodId="p-2" />)
    expect(await screen.findByText('De la reunión nueva.')).toBeInTheDocument()
    await act(async () => releaseOld({ data: [{ id: 'a', decision: 'De la reunión vieja.', createdAt: '2026-06-10T12:00:00.000Z', student: ANA, createdBy: null }] }))
    expect(screen.getByText('De la reunión nueva.')).toBeInTheDocument()
    expect(screen.queryByText('De la reunión vieja.')).toBeNull()
  })

  it('después de guardar no vuelve a «cargando»: la tabla no parpadea', async () => {
    const seen: boolean[] = []
    mockedApi.mockResolvedValue({ data: [] })
    render(<Harness onRecords={(records) => seen.push(records.loading)} />)
    await screen.findByText(/0 de 2 con juicio/)
    const settled = seen.lastIndexOf(true)
    fireEvent.click(screen.getByRole('button', { name: 'Escribir el juicio de Díaz, Ana' }))
    fireEvent.change(screen.getByLabelText('Juicio de Díaz, Ana'), { target: { value: 'Mejoró mucho.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(mockedApi.mock.calls.some(([path]) => path === '/admin/gradebook/meeting-records')).toBe(true))
    expect(seen.lastIndexOf(true)).toBe(settled)
  })

  it('desde la fila de la matriz abre el juicio de ese alumno para escribir', async () => {
    mockedApi.mockResolvedValue({ data: [] })
    const { rerender } = render(<Harness />)
    await screen.findByText(/0 de 2 con juicio/)
    rerender(
      <Harness focus={{ studentId: 's2', edit: true, nonce: 1 }} />,
    )
    expect(await screen.findByLabelText('Juicio de Sosa, Beto')).toBeInTheDocument()
    expect(screen.queryByLabelText('Juicio de Díaz, Ana')).toBeNull()
  })

  it('al lado del nombre, lo que la reunión ya decidió; y se puede dejar sólo a quien le falta', async () => {
    const students = [
      { ...STUDENTS[0], performanceValueHundredths: 700, conductValueHundredths: 800, atRisk: true, alertCount: 3 },
      STUDENTS[1],
    ]
    mockedApi.mockResolvedValue({
      data: [{ id: 'a', decision: 'Trabaja bien.', createdAt: '2026-06-10T12:00:00.000Z', student: ANA, createdBy: null }],
    })
    render(<Harness students={students} />)
    expect(await screen.findByText('Rendimiento 7 · Conducta 8 · ▲ 3 en alerta')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Sólo los que no tienen (1)'))
    expect(screen.queryByText('Díaz, Ana')).toBeNull()
    expect(screen.getByText('Sosa, Beto')).toBeInTheDocument()
  })

  it('sin permiso de control lee pero no escribe', async () => {
    authState.me = { permissions: [{ id: 'gradebook.read', scope: 'all' }] }
    setup()
    expect(await screen.findByText(/los registran adscripción y dirección/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Escribir el juicio/ })).toBeNull()
  })
})

describe('auxiliares de juicios', () => {
  it('el contexto del alumno sólo dice lo que hay', () => {
    expect(studentContext({ studentId: 's', firstName: 'A', lastName: 'B' })).toBeNull()
    expect(studentContext({ studentId: 's', firstName: 'A', lastName: 'B', conductValueHundredths: 900 })).toBe('Conducta 9')
  })
})
