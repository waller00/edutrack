import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Home from './page'
import { AuthProvider } from '@/contexts/AuthContext'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({
  api: vi.fn(),
}))

vi.mock('@/lib/observability/user-session', () => ({
  identifyObservabilityUser: vi.fn(),
  clearObservabilityUser: vi.fn(),
}))

function renderHome() {
  return render(
    <AuthProvider>
      <Home />
    </AuthProvider>,
  )
}

describe('Home page', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: 'http://localhost/' },
    })
  })

  it('redirects unauthenticated users to login', async () => {
    vi.mocked(api).mockRejectedValueOnce(new Error('unauthorized'))

    const { container } = renderHome()

    await waitFor(() => expect(window.location.href).toBe('/login'))
    expect(container).toBeEmptyDOMElement()
  })

  it('renders admin sections and resends verification emails', async () => {
    vi.mocked(api)
      .mockResolvedValueOnce({
        name: 'Ada',
        email: 'ada@example.com',
        role: 'ADMIN',
        emailVerifiedAt: null,
        isApproved: true,
        isActive: true,
      })
      .mockResolvedValueOnce({
        date: '2026-05-24',
        summary: {
          expectedTeachers: 0,
          presentTeachers: 0,
          lateArrivals: 0,
          pendingAbsences: 0,
          suspendedClasses: 0,
          outOfSchedulePunches: 0,
          unidentifiedPunches: 0,
        },
        items: [],
        filters: { teachers: [], groups: [], statuses: [], types: [] },
      })
      .mockResolvedValueOnce({})

    renderHome()

    expect(await screen.findByText('Resumen del día')).toBeInTheDocument()
    expect(screen.getByText('Asistencias')).toBeInTheDocument()
    expect(screen.getByText('Agenda')).toBeInTheDocument()
    expect(await screen.findByText('Sin incidencias para revisar')).toBeInTheDocument()
    expect(screen.queryByText(/No hay clases para mostrar/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/No hay actividad relevante/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Clases/i }))
    expect(screen.getByText(/No hay clases para mostrar/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Actividad/i }))
    expect(screen.getByText(/No hay actividad relevante/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /reenviar correo/i }))

    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('/auth/verify/resend', { method: 'POST' })
    )
    expect(screen.getByRole('button', { name: /enviado/i })).toBeDisabled()
  })

  it('muestra la cronología diaria de asistencia resumida', async () => {
    vi.mocked(api)
      .mockResolvedValueOnce({
        name: 'Ada',
        email: 'ada@example.com',
        role: 'ADMIN',
        emailVerifiedAt: '2026-01-01',
        isApproved: true,
        isActive: true,
      })
      .mockResolvedValueOnce({
        date: '2026-05-24',
        summary: {
          expectedTeachers: 2,
          presentTeachers: 1,
          lateArrivals: 1,
          pendingAbsences: 1,
          suspendedClasses: 0,
          outOfSchedulePunches: 1,
          unidentifiedPunches: 1,
        },
        filters: {
          teachers: [{ id: 'u1', name: 'Jorge Daniel Marrero Peiran', email: 'j@e.com' }],
          groups: [{ id: 'g1', name: '1°A' }],
          statuses: [{ value: 'PRESENT', label: 'Presente' }],
          types: [
            { value: 'BIOMETRIC_ENTRY', label: 'Entrada por huella' },
            { value: 'BIOMETRIC_EXIT', label: 'Salida por huella' },
            { value: 'CLASS_ATTENDANCE', label: 'Clase' },
            { value: 'SUBSTITUTION', label: 'Suplencia' },
            { value: 'JUSTIFICATION', label: 'Justificación' },
          ],
        },
        items: [
          {
            id: 'attendance:in-1',
            time: '07:45',
            type: 'BIOMETRIC_ENTRY',
            status: 'REGISTERED',
            statusLabel: 'Registrado',
            title: 'Jorge Daniel Marrero Peiran registró entrada por huella',
            detail: 'Marcación biométrica',
            teacher: { id: 'u1', name: 'Jorge Daniel Marrero Peiran', email: 'j@e.com' },
            group: null,
            event: null,
          },
          {
            id: 'class:ev-1_2026-05-24',
            time: '08:00',
            type: 'CLASS_ATTENDANCE',
            status: 'PRESENT',
            statusLabel: 'Presente',
            title: 'Matemática 1°A - Jorge Daniel Marrero Peiran',
            detail: 'Clase vinculada a marcación biométrica',
            teacher: { id: 'u1', name: 'Jorge Daniel Marrero Peiran', email: 'j@e.com' },
            group: { id: 'g1', name: '1°A' },
            event: { id: 'ev-1', title: 'Matemática' },
          },
          {
            id: 'bridge:ev-1:ev-3',
            time: '09:30',
            type: 'FREE_BRIDGE',
            status: 'FREE',
            statusLabel: 'Libre',
            title: 'Jorge Daniel Marrero Peiran tiene puente libre',
            detail: 'Hasta 10:15',
            teacher: { id: 'u1', name: 'Jorge Daniel Marrero Peiran', email: 'j@e.com' },
            group: null,
            event: null,
          },
          {
            id: 'absence:ev-2_2026-05-24',
            time: '12:00',
            type: 'PENDING_ABSENCE',
            status: 'PENDING',
            statusLabel: 'Pendiente',
            title: 'Historia 2°B - Carlos Silva',
            detail: 'No registró asistencia',
            teacher: { id: 'u2', name: 'Carlos Silva', email: 'c@e.com' },
            group: { id: 'g2', name: '2°B' },
            event: { id: 'ev-2', title: 'Historia' },
          },
        ],
      })

    renderHome()

    expect(await screen.findByText('Resumen del día')).toBeInTheDocument()
    expect(await screen.findByText('de 2 esperados')).toBeInTheDocument()
    expect(screen.getByText('Necesita tu atención')).toBeInTheDocument()
    expect(screen.queryByText('Clases del día')).not.toBeInTheDocument()
    expect(screen.queryByText('Actividad reciente')).not.toBeInTheDocument()
    expect(screen.getByText('Ausencia en Historia 2°B')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Revisar' })).toHaveAttribute('href', '/admin/attendance')

    fireEvent.click(screen.getByRole('button', { name: /^Clases/i }))
    expect(screen.queryByText('Necesita tu atención')).not.toBeInTheDocument()
    expect(screen.getAllByText('Matemática 1°A')[0]).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Actividad/i }))
    expect(screen.getByText('Jorge Daniel Marrero Peiran registró entrada por huella')).toBeInTheDocument()
    expect(screen.getAllByText('Hay una ausencia pendiente de justificar: Historia 2°B')[0]).toBeInTheDocument()
    expect(screen.getAllByText('Pendiente')[0]).toBeInTheDocument()
    expect(screen.queryByText('Jorge Daniel Marrero Peiran tiene puente libre')).not.toBeInTheDocument()
    const filters = screen.getByText(/Filtrar resumen/).closest('details')!
    expect(filters).not.toHaveAttribute('open')
    fireEvent.click(screen.getByText(/Filtrar resumen/))
    expect(screen.getByRole('option', { name: 'Todos los movimientos' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Puente libre' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: /ver bloques libres/i }))
    expect(screen.getByText('Jorge Daniel Marrero Peiran tiene puente libre')).toBeInTheDocument()
  })

  it('keeps full incident counts and lets users expand the short preview', async () => {
    vi.mocked(api)
      .mockResolvedValueOnce({
        name: 'Ada', role: 'ADMIN', emailVerifiedAt: '2026-01-01', isApproved: true, isActive: true,
      })
      .mockResolvedValueOnce({
        date: '2026-05-24',
        summary: {
          expectedTeachers: 8, presentTeachers: 0, lateArrivals: 0, pendingAbsences: 8,
          suspendedClasses: 0, outOfSchedulePunches: 0, unidentifiedPunches: 0,
        },
        filters: { teachers: [], groups: [], statuses: [], types: [] },
        items: Array.from({ length: 8 }, (_, index) => ({
          id: `absence:${index}`, time: `${String(8 + index).padStart(2, '0')}:00`,
          type: 'PENDING_ABSENCE', status: 'PENDING', statusLabel: 'Pendiente',
          title: `Clase ${index}`, teacher: { id: `u${index}`, name: `Docente ${index}` },
          event: { id: `event${index}`, title: `Clase ${index}` },
        })),
      })

    renderHome()

    expect(await screen.findByRole('button', { name: 'Pendientes 8' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    expect(screen.getByText('5 de 8 registros')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ver todos los registros' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(8)
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar menos' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    expect(api).toHaveBeenCalledTimes(2)
  })

  it('shows only the nearest activities for teachers, with access to the full agenda', async () => {
    vi.mocked(api)
      .mockResolvedValueOnce({
        id: 'teacher1', name: 'Eva', role: 'TEACHER', emailVerifiedAt: '2026-01-01', isApproved: true, isActive: true,
      })
      .mockResolvedValueOnce(Array.from({ length: 6 }, (_, index) => ({
        id: `event${index}`, title: `Actividad ${index}`, type: 'CLASS', status: 'SCHEDULED',
        startDate: `2026-10-${String(9 + index).padStart(2, '0')}T12:00:00Z`,
      })))

    renderHome()

    expect(await screen.findByText('Actividad 0')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    expect(screen.queryByText('Actividad 4')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Ver agenda completa/i })).toHaveAttribute('href', '/me/events')
  })

  it('shows the profile completion state instead of role sections', async () => {
    vi.mocked(api).mockResolvedValueOnce({
      name: 'Eva',
      email: 'eva@example.com',
      role: 'STAFF',
      emailVerifiedAt: '2026-01-01',
      needsProfileCompletion: true,
      isApproved: true,
      isActive: true,
    })

    renderHome()

    expect(await screen.findByText('Perfil incompleto')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /completar perfil/i })).toHaveAttribute('href', '/onboarding')
    expect(screen.queryByText('Mis asistencias')).not.toBeInTheDocument()
  })

  it('shows approval and inactive alerts when access is restricted', async () => {
    vi.mocked(api).mockResolvedValueOnce({
      name: 'Luis',
      email: 'luis@example.com',
      role: 'TEACHER',
      emailVerifiedAt: '2026-01-01',
      isApproved: false,
      isActive: false,
    })

    renderHome()

    expect(await screen.findByText('Cuenta pendiente de aprobación')).toBeInTheDocument()
    expect(screen.getByText('Cuenta dada de baja')).toBeInTheDocument()
    expect(screen.getByText('Tu cuenta está desactivada y no puede usar módulos operativos.')).toBeInTheDocument()
    expect(screen.queryByText('Ver asistencias')).not.toBeInTheDocument()
  })
})
