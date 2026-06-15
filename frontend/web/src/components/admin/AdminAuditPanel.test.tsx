import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminAuditPanel from './AdminAuditPanel'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

const row = {
  id: 'a1',
  occurredAt: '2026-06-15T10:00:00.000Z',
  action: 'AUTH_LOGIN_FAILURE',
  actionLabel: 'Login fallido',
  actorUserId: null,
  actorName: 'Ana',
  actorEmail: 'a@b.com',
  actorIp: '1.2.3.4',
  userAgent: null,
  source: 'web',
  entityType: null,
  entityId: null,
  metadata: { reason: 'INVALID_PASSWORD' },
}

const response = {
  total: 1,
  page: 1,
  pageSize: 25,
  actionCatalog: [{ code: 'AUTH_LOGIN_FAILURE', label: 'Login fallido' }],
  data: [row],
}

describe('AdminAuditPanel', () => {
  beforeEach(() => {
    mockedApi.mockReset()
    mockedApi.mockResolvedValue(response as never)
  })

  it('colorea el badge de acción según el tipo (fallo = rojo)', async () => {
    render(<AdminAuditPanel />)
    const badges = await screen.findAllByText('AUTH_LOGIN_FAILURE')
    // Aparece en tarjeta mobile y tabla; al menos uno está dentro de un contenedor rojo.
    expect(badges.some((b) => (b.parentElement?.className ?? '').includes('bg-red-100'))).toBe(true)
  })

  it('muestra "Limpiar" al activar un filtro y lo resetea', async () => {
    render(<AdminAuditPanel />)
    await screen.findAllByText('AUTH_LOGIN_FAILURE')

    expect(screen.queryByRole('button', { name: 'Limpiar' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'AUTH_LOGIN_FAILURE' } })

    const clear = await screen.findByRole('button', { name: 'Limpiar' })
    fireEvent.click(clear)

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Limpiar' })).not.toBeInTheDocument())
  })
})
