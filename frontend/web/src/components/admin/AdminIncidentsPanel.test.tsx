import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useOptionalAuth } from '@/contexts/AuthContext'
import { api } from '@/lib/api/client'
import AdminIncidentsPanel from './AdminIncidentsPanel'

vi.mock('@/contexts/AuthContext', () => ({ useOptionalAuth: vi.fn() }))
vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))

const incident = {
  id: 'i1',
  type: 'TEACHER_NO_SHOW',
  status: 'OPEN',
  detectedAt: '2026-10-09T12:00:00Z',
  user: { id: 'u1', name: 'Ana', email: 'ana@example.com' },
  event: { id: 'e1', title: 'Matemática', type: 'CLASE' },
}

function session(permissions: string[]) {
  vi.mocked(useOptionalAuth).mockReturnValue({
    me: {
      role: 'PERSONALIZADO',
      permissions: permissions.map((id) => ({ id, scope: 'all' })),
    },
    loading: false,
    error: false,
    refresh: vi.fn(),
  })
}

beforeEach(() => {
  vi.mocked(api).mockResolvedValue({ total: 1, data: [incident] } as never)
})

describe('incidencias según permisos del perfil', () => {
  it('permite consultar sin ofrecer cambios ni enlaces a una agenda sin permiso', async () => {
    session(['attendance.read'])
    render(<AdminIncidentsPanel />)
    expect(await screen.findByText('Ausencia docente')).toBeVisible()
    expect(screen.getByText('Matemática')).toBeVisible()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Escanear|Resolver/ }),
    ).not.toBeInTheDocument()
  })

  it('ofrece el enlace a agenda cuando puede leer las actividades del centro', async () => {
    session(['attendance.read', 'events.read'])
    render(<AdminIncidentsPanel />)
    expect(
      await screen.findByRole('link', { name: 'Matemática' }),
    ).toHaveAttribute('href', '/admin/events')
  })

  it('conserva las acciones operativas cuando tiene permiso de actualización', async () => {
    session(['attendance.read', 'attendance.update'])
    render(<AdminIncidentsPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Resolver' }))
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        '/attendance-incidents/i1/resolve',
        expect.objectContaining({ method: 'PATCH' }),
      ),
    )
    expect(screen.getByRole('button', { name: 'Escanear ahora' })).toBeVisible()
  })
})
