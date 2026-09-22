import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import MyAttendanceMarkingPanel from '@/components/personal/MyAttendanceMarkingPanel'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({
  api: vi.fn(),
}))

const mockedApi = vi.mocked(api)

const dayEvent = {
  id: 'event-1',
  title: 'Clase prueba',
  type: 'CLASE',
  status: 'SCHEDULED',
  startDate: '2026-03-10T00:00:00.000Z',
  startTime: '2026-03-10T08:00:00.000Z',
  endTime: '2026-03-10T09:30:00.000Z',
}

const EVENT_UUID = '11111111-1111-4111-8111-111111111111'

/** Instancia expandida de una serie semanal, tal como la emite `/events/my-events`. */
const recurringOccurrence = {
  id: `${EVENT_UUID}_2026-03-10`,
  originalEventId: EVENT_UUID,
  isInstance: true,
  title: 'Clase recurrente',
  type: 'CLASE',
  status: 'SCHEDULED',
  startDate: '2026-03-10T00:00:00.000Z',
  startTime: '2026-03-10T08:00:00.000Z',
  endTime: '2026-03-10T09:30:00.000Z',
}

describe('MyAttendanceMarkingPanel', () => {
  beforeEach(() => {
    mockedApi.mockReset()
  })

  it('registers CHECK_OUT using the event end time', async () => {
    mockedApi
      .mockResolvedValueOnce([dayEvent] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce({} as never)
      .mockResolvedValueOnce([dayEvent] as never)
      .mockResolvedValueOnce([] as never)

    render(<MyAttendanceMarkingPanel userId="user-1" />)

    await screen.findByText('Clase prueba')
    fireEvent.click(screen.getByRole('button', { name: 'Salida' }))

    let postCall: [string, RequestInit?] | undefined
    await waitFor(() => {
      postCall = mockedApi.mock.calls.find(
        ([path, init]) => path === '/attendance/register' && init?.method === 'POST',
      )
      expect(postCall).toBeDefined()
    })
    expect(postCall).toBeDefined()
    const body = JSON.parse(String(postCall?.[1]?.body))
    expect(body.type).toBe('CHECK_OUT')
    expect(body.eventId).toBe('event-1')
    expect(body.time).toContain('T09:30:00.000Z')
    expect(body.time).not.toContain('T08:00:00.000Z')
  })

  it('envía el uuid de la serie, no el id compuesto de la ocurrencia', async () => {
    // `/attendance/register` valida eventId con z.string().uuid(): mandar
    // `<uuid>_<ymd>` devolvía 400 y hacía imposible fichar en una clase recurrente.
    mockedApi
      .mockResolvedValueOnce([recurringOccurrence] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce({} as never)
      .mockResolvedValueOnce([recurringOccurrence] as never)
      .mockResolvedValueOnce([] as never)

    render(<MyAttendanceMarkingPanel userId="user-1" />)

    await screen.findByText('Clase recurrente')
    fireEvent.click(screen.getByRole('button', { name: 'Entrada' }))

    await waitFor(() => {
      const postCall = mockedApi.mock.calls.find(
        ([path, init]) => path === '/attendance/register' && init?.method === 'POST',
      )
      expect(postCall).toBeDefined()
      const body = JSON.parse(String(postCall?.[1]?.body))
      expect(body.eventId).toBe(EVENT_UUID)
      expect(body.eventId).not.toContain('_')
    })
  })

  it('marca la ocurrencia recurrente como fichada comparando contra el uuid de la serie', async () => {
    // `Attendance.eventId` guarda el uuid de la serie; comparar contra el id compuesto
    // dejaba el botón habilitado y sin el ✓ aunque la marca ya existiera.
    mockedApi
      .mockResolvedValueOnce([recurringOccurrence] as never)
      .mockResolvedValueOnce([
        { id: 'att-1', type: 'CHECK_IN', eventId: EVENT_UUID, date: '2026-03-10', time: '2026-03-10T08:00:00.000Z' },
      ] as never)

    render(<MyAttendanceMarkingPanel userId="user-1" />)

    await screen.findByText('Clase recurrente')
    const entrada = await screen.findByRole('button', { name: 'Entrada ✓' })
    expect(entrada).toBeDisabled()
  })
})
