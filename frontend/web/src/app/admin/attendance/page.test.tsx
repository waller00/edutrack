import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminAttendance from './page'
import { api } from '@/lib/api'

vi.mock('@/components/RoleGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="guard">{children}</div>,
}))
vi.mock('@/components/PaginationControls', () => ({
  default: () => <nav data-testid="pagination" />,
}))

vi.mock('@/lib/api', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

describe('AdminAttendance', () => {
  beforeEach(() => {
    mockedApi.mockReset()
    vi.restoreAllMocks()
  })

  it('carga asistencias vacías y muestra EduTrack', async () => {
    mockedApi.mockImplementation(async (url: string) => {
      if (String(url).includes('attendance/all')) {
        return { total: 0, page: 1, pageSize: 20, data: [] }
      }
      if (String(url).includes('admin/users')) return { data: [] }
      if (String(url).includes('attendance/stats'))
        return { totalAttendances: 0, presentCount: 0, absentCount: 0, lateCount: 0, medicalLeaveCount: 0, attendanceRate: 0, lateRate: 0, absenceRate: 0 }
      return {}
    })

    render(<AdminAttendance />)

    expect(await screen.findByText('EduTrack')).toBeInTheDocument()
    expect(await screen.findByText('No hay registros de asistencia')).toBeInTheDocument()
    expect(screen.getByText('registros totales')).toBeInTheDocument()
  })

  it('muestra fila de asistencia', async () => {
    const rec = {
      id: 'a1',
      type: 'CHECK_IN' as const,
      status: 'PRESENT' as const,
      date: '2025-06-01',
      time: '2025-06-01T08:00:00.000Z',
      user: { id: 'u1', name: 'Pedro', email: 'p@b.com', role: 'STAFF' },
      event: { id: 'e1', title: 'Turno mañana', type: 'JORNADA_LABORAL', startTime: '2025-06-01T08:30:00.000Z' },
    }

    mockedApi.mockImplementation(async (url: string) => {
      if (String(url).includes('attendance/all')) {
        return { total: 1, page: 1, pageSize: 20, data: [rec] }
      }
      if (String(url).includes('admin/users')) return { data: [] }
      if (String(url).includes('attendance/stats'))
        return { totalAttendances: 0, presentCount: 0, absentCount: 0, lateCount: 0, medicalLeaveCount: 0, attendanceRate: 0, lateRate: 0, absenceRate: 0 }
      return {}
    })

    render(<AdminAttendance />)

    expect(await screen.findByText('Turno mañana')).toBeInTheDocument()
    const row = screen.getAllByRole('row').find((r) => r.textContent?.includes('Pedro'))
    expect(row?.textContent).toMatch(/Entrada/)
    expect(row?.textContent).toMatch(/Presente/)
  })

  it('exporta Excel vía fetch al backend', async () => {
    const blob = new Blob(['xlsx'])
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(blob),
      headers: new Headers(),
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    mockedApi.mockImplementation(async (url: string) => {
      if (String(url).includes('attendance/all')) {
        return { total: 0, page: 1, pageSize: 20, data: [] }
      }
      if (String(url).includes('admin/users')) return { data: [] }
      if (String(url).includes('attendance/stats'))
        return { totalAttendances: 0, presentCount: 0, absentCount: 0, lateCount: 0, medicalLeaveCount: 0, attendanceRate: 0, lateRate: 0, absenceRate: 0 }
      if (String(url) === '/exports') return { exportId: 'exp-1' }
      if (String(url) === '/exports/exp-1') return { status: 'DONE', downloadUrl: '/exports/exp-1/download' }
      return {}
    })

    render(<AdminAttendance />)
    await screen.findByText('EduTrack')

    fireEvent.click(screen.getByRole('button', { name: /Excel/ }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
      const call = fetchMock.mock.calls[0][0] as string
      expect(call).toContain('localhost:4000/exports/exp-1/download')
    })
    expect(mockedApi).toHaveBeenCalledWith('/exports', expect.objectContaining({ method: 'POST' }))
  })

  it('marca ausencias vía fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ message: '3 ausencias' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    mockedApi.mockImplementation(async (url: string) => {
      if (String(url).includes('attendance/all')) {
        return { total: 0, page: 1, pageSize: 20, data: [] }
      }
      if (String(url).includes('admin/users')) return { data: [] }
      if (String(url).includes('attendance/stats'))
        return { totalAttendances: 0, presentCount: 0, absentCount: 0, lateCount: 0, medicalLeaveCount: 0, attendanceRate: 0, lateRate: 0, absenceRate: 0 }
      return {}
    })

    render(<AdminAttendance />)
    await screen.findByText('EduTrack')

    fireEvent.click(screen.getByRole('button', { name: /Marcar Ausencias/ }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:4000/attendance/mark-absences',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    expect(await screen.findByText(/3 ausencias/)).toBeInTheDocument()
  })

  it('elimina asistencias seleccionadas tras confirmar', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const rec = {
      id: 'a1',
      type: 'CHECK_IN' as const,
      status: 'PRESENT' as const,
      date: '2025-06-01',
      time: '2025-06-01T08:00:00.000Z',
      user: { id: 'u1', name: 'Pedro', email: 'p@b.com', role: 'STAFF' },
      event: { id: 'e1', title: 'Turno mañana', type: 'JORNADA_LABORAL', startTime: '2025-06-01T08:30:00.000Z' },
    }

    mockedApi.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('attendance/all')) {
        return { total: 1, page: 1, pageSize: 20, data: [rec] }
      }
      if (String(url).includes('admin/users')) return { data: [] }
      if (String(url).includes('attendance/stats'))
        return { totalAttendances: 0, presentCount: 0, absentCount: 0, lateCount: 0, medicalLeaveCount: 0, attendanceRate: 0, lateRate: 0, absenceRate: 0 }
      if (String(url).endsWith('/attendance/a1') && init?.method === 'DELETE') return {}
      return {}
    })

    render(<AdminAttendance />)
    await screen.findByText('Pedro')

    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar asistencia de Pedro' }))
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar seleccionadas' }))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/attendance/a1', expect.objectContaining({ method: 'DELETE' })),
    )
  })

  it('selecciona todas las asistencias desde la cabecera', async () => {
    const rec1 = {
      id: 'a1',
      type: 'CHECK_IN' as const,
      status: 'PRESENT' as const,
      date: '2025-06-01',
      time: '2025-06-01T08:00:00.000Z',
      user: { id: 'u1', name: 'Pedro', email: 'p@b.com', role: 'STAFF' },
      event: { id: 'e1', title: 'Turno mañana', type: 'JORNADA_LABORAL', startTime: '2025-06-01T08:30:00.000Z' },
    }
    const rec2 = {
      ...rec1,
      id: 'a2',
      user: { id: 'u2', name: 'Ana', email: 'a@b.com', role: 'TEACHER' },
    }

    mockedApi.mockImplementation(async (url: string) => {
      if (String(url).includes('attendance/all')) {
        return { total: 2, page: 1, pageSize: 20, data: [rec1, rec2] }
      }
      if (String(url).includes('admin/users')) return { data: [] }
      if (String(url).includes('attendance/stats'))
        return { totalAttendances: 2, presentCount: 2, absentCount: 0, lateCount: 0, medicalLeaveCount: 0, attendanceRate: 100, lateRate: 0, absenceRate: 0 }
      return {}
    })

    render(<AdminAttendance />)
    await screen.findByText('Pedro')

    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todas las asistencias' }))

    expect(screen.getByRole('checkbox', { name: 'Seleccionar asistencia de Pedro' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Seleccionar asistencia de Ana' })).toBeChecked()
  })

})
