import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Home from './page'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({
  api: vi.fn(),
}))

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

    const { container } = render(<Home />)

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

    render(<Home />)

    expect(await screen.findByText('Inicio operativo')).toBeInTheDocument()
    expect(screen.getByText('Asistencias')).toBeInTheDocument()
    expect(screen.getByText('Eventos')).toBeInTheDocument()
    expect(await screen.findByText(/No hay incidencias relevantes/i)).toBeInTheDocument()
    expect(screen.getByText(/No hay clases para mostrar/i)).toBeInTheDocument()
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
            { value: 'CLASS_ATTENDANCE', label: 'Clase' },
            { value: 'FREE_BRIDGE', label: 'Puente libre' },
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

    render(<Home />)

    expect(await screen.findByText('Inicio operativo')).toBeInTheDocument()
    expect(screen.getByText('Docentes esperados hoy')).toBeInTheDocument()
    expect(screen.getByText('Incidencias de hoy')).toBeInTheDocument()
    expect(screen.getByText('Clases en curso y próximas')).toBeInTheDocument()
    expect(screen.getByText('Actividad reciente')).toBeInTheDocument()
    expect(screen.getAllByText('Matemática 1°A')[0]).toBeInTheDocument()
    expect(screen.getByText('Jorge Daniel Marrero Peiran registró entrada por huella')).toBeInTheDocument()
    expect(screen.getAllByText('Hay una ausencia pendiente de justificar: Historia 2°B')[0]).toBeInTheDocument()
    expect(screen.getAllByText('Pendiente')[0]).toBeInTheDocument()
    expect(screen.queryByText('Jorge Daniel Marrero Peiran tiene puente libre')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: /ver bloques libres/i }))
    expect(screen.getByText('Jorge Daniel Marrero Peiran tiene puente libre')).toBeInTheDocument()
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

    render(<Home />)

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

    render(<Home />)

    expect(await screen.findByText('Cuenta pendiente de aprobación')).toBeInTheDocument()
    expect(screen.getByText('Cuenta dada de baja')).toBeInTheDocument()
    expect(screen.getByText('Tu cuenta está desactivada y no puede usar módulos operativos.')).toBeInTheDocument()
    expect(screen.queryByText('Ver asistencias')).not.toBeInTheDocument()
  })
})
