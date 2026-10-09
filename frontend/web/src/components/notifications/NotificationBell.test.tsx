import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NotificationBell from './NotificationBell'
import NotificationToast, { TOAST_MS } from './NotificationToast'
import { NotificationsProvider, POLL_MS, type InAppNotification } from './NotificationsProvider'

const { routerMock, pathnameMock, apiMock } = vi.hoisted(() => ({
  routerMock: { push: vi.fn(), replace: vi.fn() },
  pathnameMock: vi.fn(() => '/'),
  apiMock: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => pathnameMock(),
}))
vi.mock('@/lib/api/client', () => ({ api: (...args: unknown[]) => apiMock(...args) }))

// Jueves 8/10/2026, 15:00 en Uruguay.
const NOW = new Date('2026-10-08T18:00:00.000Z')

function aviso(id: string, over: Partial<InAppNotification> = {}): InAppNotification {
  return {
    id,
    type: 'GRADEBOOK_OBSERVATION',
    title: `Observación ${id}`,
    body: 'Planificación: falta el tema de la unidad 2',
    actionUrl: `/libreta/gb-${id}/visados`,
    readAt: null,
    createdAt: '2026-10-08T17:55:00.000Z',
    ...over,
  }
}

let summary: { unreadCount: number; items: InAppNotification[] }

function renderBell() {
  return render(
    <NotificationsProvider>
      <NotificationBell />
      <NotificationToast />
    </NotificationsProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(NOW)
  pathnameMock.mockReturnValue('/')
  summary = {
    unreadCount: 2,
    items: [aviso('n2'), aviso('n1', { type: 'EVENT_ASSIGNED', title: 'Nuevo evento', readAt: '2026-10-08T12:00:00.000Z', createdAt: '2026-10-07T12:00:00.000Z' })],
  }
  apiMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/notifications/in-app/summary')) return summary
    return {}
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('<NotificationBell />', () => {
  it('muestra cuántos avisos hay sin leer', async () => {
    renderBell()
    expect(await screen.findByRole('button', { name: 'Avisos, 2 sin leer' })).toHaveTextContent('2')
  })

  it('abre un panel con los últimos avisos: tipo, hace cuánto y si está leído', async () => {
    renderBell()
    fireEvent.click(await screen.findByRole('button', { name: 'Avisos, 2 sin leer' }))

    const panel = screen.getByRole('dialog', { name: 'Avisos' })
    expect(within(panel).getByText('Observación n2')).toBeInTheDocument()
    expect(within(panel).getByText('Libreta · hace 5 min')).toBeInTheDocument()
    expect(within(panel).getByText('Agenda · ayer 09:00')).toBeInTheDocument()
    expect(within(panel).getAllByText('Sin leer')).toHaveLength(1)
    expect(within(panel).getByRole('link', { name: 'Ver todos los avisos' })).toHaveAttribute('href', '/notifications')
    expect(within(panel).getByRole('link', { name: /Configurar avisos/ })).toHaveAttribute(
      'href',
      '/profile?section=notifications',
    )
    // Al abrirlo se vuelve a preguntar, para no mostrar algo viejo.
    await waitFor(() => expect(apiMock.mock.calls.filter(([url]) => url.includes('summary'))).toHaveLength(2))
  })

  it('tocar un aviso lo marca leído y lleva a lo que avisa, sin recargar', async () => {
    renderBell()
    fireEvent.click(await screen.findByRole('button', { name: 'Avisos, 2 sin leer' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Observación n2/ }))

    expect(routerMock.push).toHaveBeenCalledWith('/libreta/gb-n2/visados')
    expect(apiMock).toHaveBeenCalledWith('/notifications/in-app/n2/read', { method: 'PATCH' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Avisos, 1 sin leer' })).toBeInTheDocument()
  })

  it('"Marcar todo como leído" deja la campana en cero', async () => {
    renderBell()
    fireEvent.click(await screen.findByRole('button', { name: 'Avisos, 2 sin leer' }))
    fireEvent.click(screen.getByRole('button', { name: /Marcar todo como leído/ }))

    expect(apiMock).toHaveBeenCalledWith('/notifications/in-app/read-all', { method: 'POST' })
    expect(screen.getByRole('button', { name: 'Avisos' })).toBeInTheDocument()
  })

  it('se cierra con Escape y vuelve el foco a la campana', async () => {
    renderBell()
    const bell = await screen.findByRole('button', { name: 'Avisos, 2 sin leer' })
    fireEvent.click(bell)
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(bell).toHaveFocus()
  })

  it('sin avisos lo dice', async () => {
    summary = { unreadCount: 0, items: [] }
    renderBell()
    fireEvent.click(await screen.findByRole('button', { name: 'Avisos' }))
    expect(await screen.findByText('No tenés avisos')).toBeInTheDocument()
  })
})

describe('cuando llega un aviso nuevo', () => {
  it('al cargar no hay cartelito: es para lo que llega mientras se usa la app', async () => {
    renderBell()
    await screen.findByRole('button', { name: 'Avisos, 2 sin leer' })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('la campana se actualiza sola y aparece el cartelito; tocarlo abre el aviso', async () => {
    renderBell()
    await screen.findByRole('button', { name: 'Avisos, 2 sin leer' })

    summary = { unreadCount: 3, items: [aviso('n3', { title: 'Mensaje en Matemática', actionUrl: '/libreta/gb-1/mensajes' }), ...summary.items] }
    await act(async () => {
      vi.advanceTimersByTime(POLL_MS)
    })

    expect(await screen.findByRole('button', { name: 'Avisos, 3 sin leer' })).toBeInTheDocument()
    const toast = screen.getByRole('status')
    expect(within(toast).getByText('Nuevo aviso')).toBeInTheDocument()
    fireEvent.click(within(toast).getByRole('button', { name: /Mensaje en Matemática/ }))
    expect(routerMock.push).toHaveBeenCalledWith('/libreta/gb-1/mensajes')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('con varios los cuenta, y tocarlo abre el panel', async () => {
    renderBell()
    await screen.findByRole('button', { name: 'Avisos, 2 sin leer' })

    summary = { unreadCount: 4, items: [aviso('n4'), aviso('n3'), ...summary.items] }
    await act(async () => {
      vi.advanceTimersByTime(POLL_MS)
    })

    const toast = await screen.findByRole('status')
    expect(within(toast).getByText('2 avisos nuevos')).toBeInTheDocument()
    fireEvent.click(within(toast).getByRole('button', { name: /avisos nuevos/ }))
    expect(screen.getByRole('dialog', { name: 'Avisos' })).toBeInTheDocument()
  })

  it('el cartelito se va solo', async () => {
    renderBell()
    await screen.findByRole('button', { name: 'Avisos, 2 sin leer' })
    summary = { unreadCount: 3, items: [aviso('n3'), ...summary.items] }
    await act(async () => {
      vi.advanceTimersByTime(POLL_MS)
    })
    expect(await screen.findByRole('status')).toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(TOAST_MS + 100)
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('con la pestaña oculta no pregunta', async () => {
    renderBell()
    await screen.findByRole('button', { name: 'Avisos, 2 sin leer' })
    const calls = apiMock.mock.calls.length
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })

    await act(async () => {
      vi.advanceTimersByTime(POLL_MS)
    })

    expect(apiMock.mock.calls.length).toBe(calls)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  })
})
