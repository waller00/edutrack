import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import NotificationsPage from './page'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({
  api: vi.fn(),
}))

vi.mock('@/components/auth/RoleGuard', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

const mockedApi = vi.mocked(api)

const unreadNotification = {
  id: 'n1',
  type: 'EVENT_ASSIGNED',
  title: 'Clase asignada',
  body: 'Tenés una clase nueva.',
  actionUrl: null,
  readAt: null,
  createdAt: '2026-06-08T12:00:00.000Z',
}

const readNotification = {
  id: 'n2',
  type: 'LICENSE_UPDATED',
  title: 'Licencia actualizada',
  body: 'Cambió el estado de tu licencia.',
  actionUrl: '/me/licenses',
  readAt: '2026-06-08T13:00:00.000Z',
  createdAt: '2026-06-07T12:00:00.000Z',
}

describe('NotificationsPage', () => {
  beforeEach(() => {
    mockedApi.mockReset()
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { href: 'http://localhost/notifications' },
    })
  })

  it('marca como leída al abrir y la conserva en el historial', async () => {
    mockedApi.mockImplementation(async (url: string) => {
      if (url === '/notifications/in-app?take=80') {
        return { items: [unreadNotification, readNotification] }
      }
      if (url === '/notifications/in-app/n1/read') {
        return { ...unreadNotification, readAt: '2026-06-08T14:00:00.000Z' }
      }
      return {}
    })

    render(<NotificationsPage />)

    expect(await screen.findByRole('heading', { name: 'No leídas' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Historial' })).toBeInTheDocument()

    const unreadSection = screen.getByRole('heading', { name: 'No leídas' }).closest('section')!
    fireEvent.click(within(unreadSection).getByRole('button', { name: /abrir/i }))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/notifications/in-app/n1/read', { method: 'PATCH' }),
    )

    const historySection = screen.getByRole('heading', { name: 'Historial' }).closest('section')!
    await waitFor(() => {
      expect(within(historySection).getByText('Clase asignada')).toBeInTheDocument()
    })
    expect(screen.queryByRole('heading', { name: 'No leídas' })).not.toBeInTheDocument()
  })
})
