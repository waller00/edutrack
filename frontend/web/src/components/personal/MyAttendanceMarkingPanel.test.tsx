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
})
