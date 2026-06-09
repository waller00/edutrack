import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminAttendance from './page'
import { api } from '@/lib/api/client'

vi.mock('@/components/auth/RoleGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="guard">{children}</div>,
}))
vi.mock('@/components/common/PaginationControls', () => ({
  default: () => <nav data-testid="pagination" />,
}))

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
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
    expect(row?.textContent).toMatch(/Presente/)
    expect(row?.textContent).toMatch(/Sin salida/)
  })

  it('muestra ausencias virtuales y permite seleccionarlas', async () => {
    const rec = {
      id: 'absence:ev1_2026-05-20',
      type: 'CHECK_IN' as const,
      status: 'ABSENT_NOT_JUSTIFIED' as const,
      date: '2026-05-20',
      time: '2026-05-20T18:00:00.000Z',
      notes: 'Ausencia pendiente: no se registró asistencia para este evento vencido',
      user: { id: 'u1', name: 'Jorge', email: 'j@b.com', role: 'TEACHER' },
      event: {
        id: 'ev1',
        title: 'Ingles Tercero C',
        type: 'CLASE',
        startTime: '2026-05-20T18:00:00.000Z',
        endTime: '2026-05-20T19:00:00.000Z',
      },
    }

    mockedApi.mockImplementation(async (url: string) => {
      if (String(url).includes('attendance/all')) {
        return { total: 1, page: 1, pageSize: 20, data: [rec] }
      }
      if (String(url).includes('admin/users')) return { data: [] }
      if (String(url).includes('attendance/stats'))
        return { totalAttendances: 1, presentCount: 0, absentCount: 1, lateCount: 0, medicalLeaveCount: 0, attendanceRate: 0, lateRate: 0, absenceRate: 100 }
      return {}
    })

    render(<AdminAttendance />)

    expect(await screen.findByText('Ingles Tercero C')).toBeInTheDocument()
    const row = screen.getAllByRole('row').find((r) => r.textContent?.includes('Jorge'))
    expect(row?.textContent).toMatch(/Ausente/)
    expect(row?.textContent).toMatch(/Sin salida/)
    expect(row?.textContent).toMatch(/Editar/)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar asistencia de Jorge' }))
    expect(screen.getByRole('checkbox', { name: 'Seleccionar asistencia de Jorge' })).toBeChecked()
    expect(screen.getByText('1 seleccionadas')).toBeInTheDocument()
  })

  it('no intenta borrar ausencias virtuales porque no tienen registro real', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const rec = {
      id: 'absence:ev1_2026-05-20',
      type: 'CHECK_IN' as const,
      status: 'ABSENT_NOT_JUSTIFIED' as const,
      date: '2026-05-20',
      time: '2026-05-20T18:00:00.000Z',
      notes: 'Ausencia pendiente: no se registró asistencia para este evento vencido',
      user: { id: 'u1', name: 'Jorge', email: 'j@b.com', role: 'TEACHER' },
      event: {
        id: 'ev1',
        title: 'Ingles Tercero C',
        type: 'CLASE',
        startTime: '2026-05-20T18:00:00.000Z',
        endTime: '2026-05-20T19:00:00.000Z',
      },
    }

    mockedApi.mockImplementation(async (url: string) => {
      if (String(url).includes('attendance/all')) {
        return { total: 1, page: 1, pageSize: 20, data: [rec] }
      }
      if (String(url).includes('admin/users')) return { data: [] }
      if (String(url).includes('attendance/stats'))
        return { totalAttendances: 1, presentCount: 0, absentCount: 1, lateCount: 0, medicalLeaveCount: 0, attendanceRate: 0, lateRate: 0, absenceRate: 100 }
      return {}
    })

    render(<AdminAttendance />)
    await screen.findByText('Ingles Tercero C')

    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar asistencia de Jorge' }))
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar seleccionadas' }))

    expect(await screen.findByText(/no eliminar hasta registrarlas/)).toBeInTheDocument()
    expect(mockedApi).not.toHaveBeenCalledWith('/attendance/absence:ev1_2026-05-20', expect.anything())
    expect(window.confirm).not.toHaveBeenCalled()
  })

  it('materializa una ausencia virtual antes de editarla', async () => {
    const rec = {
      id: 'absence:ev1_2026-05-20',
      type: 'CHECK_IN' as const,
      status: 'ABSENT_NOT_JUSTIFIED' as const,
      date: '2026-05-20',
      time: '2026-05-20T18:00:00.000Z',
      notes: 'Ausencia pendiente: no se registró asistencia para este evento vencido',
      user: { id: '00000000-0000-4000-8000-000000000011', name: 'Jorge', email: 'j@b.com', role: 'TEACHER' },
      event: {
        id: '00000000-0000-4000-8000-0000000000e1',
        title: 'Ingles Tercero C',
        type: 'CLASE',
        startTime: '2026-05-20T18:00:00.000Z',
        endTime: '2026-05-20T19:00:00.000Z',
      },
    }
    const materialized = { ...rec, id: 'att-1' }

    mockedApi.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('attendance/all')) {
        return { total: 1, page: 1, pageSize: 20, data: [rec] }
      }
      if (String(url).includes('admin/users')) return { data: [] }
      if (String(url).includes('attendance/stats'))
        return { totalAttendances: 1, presentCount: 0, absentCount: 1, lateCount: 0, medicalLeaveCount: 0, attendanceRate: 0, lateRate: 0, absenceRate: 100 }
      if (String(url) === '/attendance/materialize-absence' && init?.method === 'POST') return materialized
      return {}
    })

    render(<AdminAttendance />)
    await screen.findByText('Ingles Tercero C')

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        '/attendance/materialize-absence',
        expect.objectContaining({ method: 'POST' }),
      ),
    )
    expect(await screen.findByText('Editar Asistencia')).toBeInTheDocument()
  })

  it('agrupa entrada y salida de una misma asistencia en una fila', async () => {
    const entry = {
      id: 'a1',
      type: 'CHECK_IN' as const,
      status: 'PRESENT' as const,
      date: '2025-06-01',
      time: '2025-06-01T08:00:00.000Z',
      notes: 'Ingreso registrado',
      user: { id: 'u1', name: 'Pedro', email: 'p@b.com', role: 'STAFF' },
      event: {
        id: 'e1',
        title: 'Turno mañana',
        type: 'JORNADA_LABORAL',
        startTime: '2025-06-01T08:00:00.000Z',
        endTime: '2025-06-01T12:00:00.000Z',
      },
    }
    const exit = {
      ...entry,
      id: 'a2',
      type: 'CHECK_OUT' as const,
      status: 'EXIT' as const,
      time: '2025-06-01T12:00:00.000Z',
      notes: 'Salida registrada',
    }

    mockedApi.mockImplementation(async (url: string) => {
      if (String(url).includes('attendance/all')) {
        return { total: 2, page: 1, pageSize: 20, data: [exit, entry] }
      }
      if (String(url).includes('admin/users')) return { data: [] }
      if (String(url).includes('attendance/stats'))
        return { totalAttendances: 1, presentCount: 1, absentCount: 0, lateCount: 0, medicalLeaveCount: 0, attendanceRate: 100, lateRate: 0, absenceRate: 0 }
      return {}
    })

    render(<AdminAttendance />)

    expect(await screen.findByText('Turno mañana')).toBeInTheDocument()
    const rows = screen.getAllByRole('row').filter((r) => r.textContent?.includes('Pedro'))
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toMatch(/Presente/)
    expect(rows[0].textContent).toMatch(/Salida/)
    expect(rows[0].textContent).toMatch(/Ingreso registrado \/ Salida registrada/)
  })

  it('correlaciona una entrada y una salida que cubren clases contiguas', async () => {
    const entry = {
      id: 'a1',
      type: 'CHECK_IN' as const,
      status: 'PRESENT' as const,
      date: '2025-06-01',
      time: '2025-06-01T21:33:00.000Z',
      notes: 'Entrada automática',
      user: { id: 'u1', name: 'Jorge', email: 'j@b.com', role: 'TEACHER' },
      event: {
        id: 'class-1',
        title: 'Clase 1',
        type: 'CLASE',
        startTime: '2025-06-01T21:40:00.000Z',
        endTime: '2025-06-01T22:30:00.000Z',
      },
    }
    const exit = {
      id: 'a2',
      type: 'CHECK_OUT' as const,
      status: 'EXIT' as const,
      date: '2025-06-01',
      time: '2025-06-01T22:37:00.000Z',
      notes: 'Salida automática',
      user: entry.user,
      event: {
        id: 'class-2',
        title: 'Clase 2',
        type: 'CLASE',
        startTime: '2025-06-01T22:30:00.000Z',
        endTime: '2025-06-01T23:20:00.000Z',
      },
    }

    mockedApi.mockImplementation(async (url: string) => {
      if (String(url).includes('attendance/all')) {
        return { total: 2, page: 1, pageSize: 20, data: [exit, entry] }
      }
      if (String(url).includes('admin/users')) return { data: [] }
      if (String(url).includes('attendance/stats'))
        return { totalAttendances: 1, presentCount: 1, absentCount: 0, lateCount: 0, medicalLeaveCount: 0, attendanceRate: 100, lateRate: 0, absenceRate: 0 }
      return {}
    })

    render(<AdminAttendance />)

    expect(await screen.findByText('Clase 1 → Clase 2')).toBeInTheDocument()
    expect(screen.getByText('Permanencia correlacionada')).toBeInTheDocument()
    const rows = screen.getAllByRole('row').filter((r) => r.textContent?.includes('Jorge'))
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toMatch(/Presente/)
    expect(rows[0].textContent).toMatch(/Salida/)
    expect(rows[0].textContent).toMatch(/Entrada automática \/ Salida automática/)

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar detalle de eventos' }))

    expect(screen.getByText('La misma permanencia cubre eventos contiguos.')).toBeInTheDocument()
    expect(screen.getAllByText('Entrada').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Salida').length).toBeGreaterThan(0)
  })

  it('muestra entradas duplicadas como filas separadas para poder corregirlas', async () => {
    const entry = {
      id: 'a1',
      type: 'CHECK_IN' as const,
      status: 'PRESENT' as const,
      date: '2025-06-01',
      time: '2025-06-01T08:00:00.000Z',
      notes: 'Ingreso registrado',
      user: { id: 'u1', name: 'Pedro', email: 'p@b.com', role: 'STAFF' },
      event: {
        id: 'e1',
        title: 'Turno mañana',
        type: 'JORNADA_LABORAL',
        startTime: '2025-06-01T08:00:00.000Z',
      },
    }
    const duplicate = {
      ...entry,
      id: 'a2',
      time: '2025-06-01T08:20:00.000Z',
      notes: 'Entrada duplicada',
    }

    mockedApi.mockImplementation(async (url: string) => {
      if (String(url).includes('attendance/all')) {
        return { total: 2, page: 1, pageSize: 20, data: [duplicate, entry] }
      }
      if (String(url).includes('admin/users')) return { data: [] }
      if (String(url).includes('attendance/stats'))
        return { totalAttendances: 2, presentCount: 2, absentCount: 0, lateCount: 0, medicalLeaveCount: 0, attendanceRate: 100, lateRate: 0, absenceRate: 0 }
      return {}
    })

    render(<AdminAttendance />)

    expect(await screen.findAllByText('Turno mañana')).toHaveLength(2)
    const rows = screen.getAllByRole('row').filter((r) => r.textContent?.includes('Pedro'))
    expect(rows).toHaveLength(2)
    expect(screen.getByText('Entrada duplicada')).toBeInTheDocument()
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
