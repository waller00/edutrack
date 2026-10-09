import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NotificationsPage from './page'
import NotificationBell from '@/components/notifications/NotificationBell'
import { NotificationsProvider } from '@/components/notifications/NotificationsProvider'
import { api } from '@/lib/api/client'

const { routerMock } = vi.hoisted(() => ({ routerMock: { push: vi.fn(), replace: vi.fn() } }))

vi.mock('@/lib/api/client', () => ({
  api: vi.fn(),
}))

vi.mock('@/components/auth/RoleGuard', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/notifications',
}))

const mockedApi = vi.mocked(api)

// Jueves 8/10/2026, 15:00 en Uruguay.
const NOW = new Date('2026-10-08T18:00:00.000Z')

const hoy = {
  id: 'n2',
  type: 'GRADEBOOK_OBSERVATION',
  title: 'Observación en Matemática',
  body: 'Planificación: falta la unidad 2',
  actionUrl: '/libreta/gb-1/visados',
  readAt: null,
  createdAt: '2026-10-08T17:55:00.000Z',
}

const ayer = {
  id: 'n1',
  type: 'LICENSE_UPDATED',
  title: 'Licencia actualizada',
  body: 'La institución actualizó una licencia',
  actionUrl: '/me/licenses',
  readAt: '2026-10-07T13:00:00.000Z',
  createdAt: '2026-10-07T12:00:00.000Z',
}

function respond(pages: Record<string, unknown>) {
  mockedApi.mockImplementation(async (url: string) => {
    for (const [prefix, value] of Object.entries(pages)) if (url.startsWith(prefix)) return value
    return {}
  })
}

describe('NotificationsPage', () => {
  beforeEach(() => {
    mockedApi.mockReset()
    routerMock.push.mockReset()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('agrupa por día y cada aviso dice su tipo y si está sin leer', async () => {
    respond({ '/notifications/in-app?': { items: [hoy, ayer], nextCursor: null } })
    render(<NotificationsPage />)

    const today = await screen.findByRole('region', { name: 'Hoy' })
    expect(within(today).getByText('Observación en Matemática')).toBeInTheDocument()
    expect(within(today).getByText('hace 5 min')).toBeInTheDocument()
    expect(within(today).getByText('Sin leer')).toBeInTheDocument()
    const yesterday = screen.getByRole('region', { name: 'Ayer' })
    expect(within(yesterday).getByText('Licencia actualizada')).toBeInTheDocument()
    expect(within(yesterday).getByText('09:00')).toBeInTheDocument()
    expect(within(yesterday).queryByText('Sin leer')).not.toBeInTheDocument()
  })

  it('tocar el aviso lo marca leído y navega sin recargar', async () => {
    respond({ '/notifications/in-app?': { items: [hoy, ayer], nextCursor: null } })
    render(<NotificationsPage />)

    // La fila entera es el botón (el otro, "Marcar como leído: …", sólo marca).
    fireEvent.click(await screen.findByRole('button', { name: /^Observación en Matemática/ }))

    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/notifications/in-app/n2/read', { method: 'PATCH' }))
    expect(routerMock.push).toHaveBeenCalledWith('/libreta/gb-1/visados')
    expect(screen.queryByText('Sin leer')).not.toBeInTheDocument()
  })

  it('"Marcar como leído" no navega', async () => {
    respond({ '/notifications/in-app?': { items: [hoy], nextCursor: null } })
    render(<NotificationsPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Marcar como leído: Observación en Matemática' }))

    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/notifications/in-app/n2/read', { method: 'PATCH' }))
    expect(routerMock.push).not.toHaveBeenCalled()
  })

  it('filtra los no leídos en el servidor', async () => {
    respond({ '/notifications/in-app?': { items: [hoy], nextCursor: null } })
    render(<NotificationsPage />)
    await screen.findByRole('region', { name: 'Hoy' })

    fireEvent.click(screen.getByRole('button', { name: /No leídos/ }))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/notifications/in-app?take=30&unreadOnly=true'),
    )
  })

  it('"Cargar más" trae los anteriores y los suma abajo', async () => {
    mockedApi.mockImplementation(async (url: string) => {
      if (url.includes('before=')) return { items: [ayer], nextCursor: null }
      if (url.startsWith('/notifications/in-app?')) return { items: [hoy], nextCursor: '2026-10-08T17:55:00.000Z|n2' }
      return {}
    })
    render(<NotificationsPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Cargar más' }))

    expect(await screen.findByText('Licencia actualizada')).toBeInTheDocument()
    expect(mockedApi).toHaveBeenCalledWith(
      `/notifications/in-app?take=30&before=${encodeURIComponent('2026-10-08T17:55:00.000Z|n2')}`,
    )
    expect(screen.queryByRole('button', { name: 'Cargar más' })).not.toBeInTheDocument()
  })

  it('sin avisos lo explica en general, no sólo para licencias', async () => {
    respond({ '/notifications/in-app?': { items: [], nextCursor: null } })
    render(<NotificationsPage />)
    expect(await screen.findByText('No hay avisos todavía')).toBeInTheDocument()
    expect(screen.getByText(/licencias, de tu agenda, de la libreta y las alertas/)).toBeInTheDocument()
  })

  it('leer en la página baja el número de la campana', async () => {
    respond({
      '/notifications/in-app/summary': { unreadCount: 1, items: [hoy] },
      '/notifications/in-app?': { items: [hoy, ayer], nextCursor: null },
    })
    render(
      <NotificationsProvider>
        <NotificationBell />
        <NotificationsPage />
      </NotificationsProvider>,
    )
    expect(await screen.findByRole('button', { name: 'Avisos, 1 sin leer' })).toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: 'Marcar todo como leído' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Avisos' })).toBeInTheDocument())
    expect(mockedApi).toHaveBeenCalledWith('/notifications/in-app/read-all', { method: 'POST' })
  })
})
