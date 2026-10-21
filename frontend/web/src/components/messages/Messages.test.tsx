import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiMock, authState } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  authState: { me: null as null | { id: string; permissions: Array<{ id: string; scope: 'own' | 'all' }> } },
}))

vi.mock('@/lib/api/client', () => ({ api: (...args: unknown[]) => apiMock(...args) }))
vi.mock('@/contexts/AuthContext', () => ({
  useOptionalAuth: () => ({ me: authState.me, loading: false, error: null, refresh: vi.fn() }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { MessagesProvider, SUMMARY_POLL_MS } from './MessagesProvider'
import MessagesButton from './MessagesButton'
import MessagesDrawer from './MessagesDrawer'
import { CONVERSATION_POLL_MS } from './ConversationView'

const CONV = 'c-1'
const LEO = { id: 'u-2', name: 'Leopoldo Giménez', roleLabel: 'Docente' }
const ANA = { id: 'u-3', name: 'Ana García', roleLabel: 'Dirección' }

const conversation = (overrides = {}) => ({
  id: CONV,
  starred: false,
  unread: 2,
  lastMessageAt: '2026-10-21T13:00:00.000Z',
  other: LEO,
  lastMessage: { preview: 'Hola Jorge', mine: false, createdAt: '2026-10-21T13:00:00.000Z' },
  ...overrides,
})

type Routes = Record<string, unknown | ((init?: RequestInit) => unknown)>

function routeApi(routes: Routes) {
  apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    const key = `${method} ${path}`
    const match = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((pattern) => key.startsWith(pattern))
    if (!match) throw new Error(`API no simulada: ${key}`)
    const value = routes[match]
    return typeof value === 'function' ? (value as (i?: RequestInit) => unknown)(init) : value
  })
}

function renderShell() {
  return render(
    <MessagesProvider>
      <MessagesButton />
      <MessagesDrawer />
    </MessagesProvider>,
  )
}

const baseRoutes = (): Routes => ({
  'GET /messages/summary': { unreadConversations: 1, unreadMessages: 2 },
  'GET /messages/conversations?q=': { data: [conversation(), conversation({ id: 'c-2', starred: true, unread: 0, other: ANA, lastMessage: { preview: 'Listo', mine: true, createdAt: '2026-10-20T13:00:00.000Z' } })] },
  'GET /messages/contacts?q=': { data: [LEO, { id: 'u-9', name: 'Lorena Rodríguez', roleLabel: 'Adscripto' }] },
  [`GET /messages/conversations/${CONV}/messages`]: {
    data: [
      { id: 'm1', body: 'Hola Jorge', createdAt: '2026-10-21T12:59:00.000Z', mine: false },
      { id: 'm2', body: '¿Cómo estás?', createdAt: '2026-10-21T13:00:00.000Z', mine: false },
    ],
    hasMore: false,
  },
  [`GET /messages/conversations/${CONV}`]: { data: { id: CONV, starred: false, other: LEO } },
  [`POST /messages/conversations/${CONV}/read`]: { ok: true },
})

describe('mensajería en el encabezado', () => {
  beforeEach(() => {
    apiMock.mockReset()
    authState.me = { id: 'u-1', permissions: [{ id: 'messaging.use', scope: 'own' }] }
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  })

  it('sin el permiso no hay ícono ni consultas', () => {
    authState.me = { id: 'u-1', permissions: [] }
    renderShell()
    expect(screen.queryByRole('button', { name: /Mensajes/ })).not.toBeInTheDocument()
    expect(apiMock).not.toHaveBeenCalled()
  })

  it('el ícono muestra las conversaciones sin leer y se pone al día cada 15 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    routeApi(baseRoutes())
    renderShell()

    expect(await screen.findByRole('button', { name: 'Mensajes, 1 conversaciones sin leer' })).toBeInTheDocument()
    routeApi({ ...baseRoutes(), 'GET /messages/summary': { unreadConversations: 3, unreadMessages: 5 } })
    await act(async () => {
      vi.advanceTimersByTime(SUMMARY_POLL_MS)
    })
    expect(await screen.findByRole('button', { name: 'Mensajes, 3 conversaciones sin leer' })).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('el panel muestra Destacados y Privado, y se cierra con Escape devolviendo el foco', async () => {
    routeApi(baseRoutes())
    renderShell()
    const button = await screen.findByRole('button', { name: /Mensajes/ })
    button.focus()
    fireEvent.click(button)

    const dialog = await screen.findByRole('dialog', { name: 'Mensajes' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(await within(dialog).findByRole('button', { name: /Destacados/ })).toHaveTextContent('(1)')
    expect(within(dialog).getByRole('button', { name: /Privado/ })).toHaveTextContent('(1)')
    expect(within(dialog).getByRole('button', { name: 'Leopoldo Giménez, 2 sin leer' })).toBeInTheDocument()
    expect(within(dialog).getByText('Tú: Listo')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(button).toHaveFocus()
  })

  it('buscar muestra contactos nuevos y escribirle a uno abre la conversación', async () => {
    const routes = baseRoutes()
    routes['GET /messages/conversations?q=Lor'] = { data: [] }
    routes['GET /messages/contacts?q=Lor'] = { data: [{ id: 'u-9', name: 'Lorena Rodríguez', roleLabel: 'Adscripto' }] }
    routes['POST /messages/conversations'] = (init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ userId: 'u-9' })
      return { data: { id: 'c-new', starred: false, other: { id: 'u-9', name: 'Lorena Rodríguez', roleLabel: 'Adscripto' } } }
    }
    routes['GET /messages/conversations/c-new/messages'] = { data: [], hasMore: false }
    routes['GET /messages/conversations/c-new'] = { data: { id: 'c-new', starred: false, other: { id: 'u-9', name: 'Lorena Rodríguez', roleLabel: 'Adscripto' } } }
    routes['POST /messages/conversations/c-new/read'] = { ok: true }
    routeApi(routes)
    renderShell()
    fireEvent.click(await screen.findByRole('button', { name: /Mensajes/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Mensajes' })

    fireEvent.change(within(dialog).getByLabelText('Buscar personas o conversaciones'), { target: { value: 'Lor' } })
    fireEvent.click(await within(dialog).findByRole('button', { name: /Lorena Rodríguez/ }))

    expect(await within(dialog).findByRole('heading', { name: 'Lorena Rodríguez' })).toBeInTheDocument()
    expect(within(dialog).getByText('Todavía no hay mensajes. Escribí el primero.')).toBeInTheDocument()
  })

  it('en la conversación: burbujas, enviar con Enter (se ve al instante) y destacar', async () => {
    const routes = baseRoutes()
    let resolveSend: (value: unknown) => void = () => {}
    routes[`POST /messages/conversations/${CONV}/messages`] = (init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ body: 'Todo bien' })
      return new Promise((resolve) => {
        resolveSend = resolve
      })
    }
    routes[`PUT /messages/conversations/${CONV}/star`] = { ok: true, starred: true }
    routeApi(routes)
    renderShell()
    fireEvent.click(await screen.findByRole('button', { name: /Mensajes/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Mensajes' })
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Leopoldo Giménez, 2 sin leer' }))

    expect(await within(dialog).findByText('¿Cómo estás?')).toBeInTheDocument()
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(`/messages/conversations/${CONV}/read`, { method: 'POST' }))

    const box = within(dialog).getByLabelText('Escribí un mensaje')
    fireEvent.change(box, { target: { value: 'Todo bien' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(await within(dialog).findByText('Enviando…')).toBeInTheDocument()
    expect(within(dialog).getByText('Todo bien')).toBeInTheDocument()

    await act(async () => {
      resolveSend({ data: { id: 'm3', body: 'Todo bien', createdAt: '2026-10-21T13:05:00.000Z', mine: true } })
    })
    await waitFor(() => expect(within(dialog).queryByText('Enviando…')).not.toBeInTheDocument())

    fireEvent.click(within(dialog).getByRole('button', { name: 'Destacar conversación' }))
    expect(await within(dialog).findByRole('button', { name: 'Quitar de destacados' })).toHaveAttribute('aria-pressed', 'true')
    expect(apiMock).toHaveBeenCalledWith(`/messages/conversations/${CONV}/star`, { method: 'PUT', body: JSON.stringify({ starred: true }) })
  })

  it('con la conversación abierta trae lo nuevo cada 3 s, y no con la pestaña oculta', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const routes = baseRoutes()
    routes[`GET /messages/conversations/${CONV}/messages?after=`] = {
      data: [{ id: 'm9', body: 'Te escribo de nuevo', createdAt: '2026-10-21T13:10:00.000Z', mine: false }],
    }
    routeApi(routes)
    renderShell()
    fireEvent.click(await screen.findByRole('button', { name: /Mensajes/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Mensajes' })
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Leopoldo Giménez, 2 sin leer' }))
    await within(dialog).findByText('¿Cómo estás?')

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    await act(async () => {
      vi.advanceTimersByTime(CONVERSATION_POLL_MS)
    })
    expect(apiMock.mock.calls.some(([path]) => String(path).includes('?after='))).toBe(false)

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    await act(async () => {
      vi.advanceTimersByTime(CONVERSATION_POLL_MS)
    })
    expect(await within(dialog).findByText('Te escribo de nuevo')).toBeInTheDocument()
    expect(apiMock).toHaveBeenCalledWith(
      `/messages/conversations/${CONV}/messages?after=${encodeURIComponent('2026-10-21T13:00:00.000Z|m2')}`,
    )
    vi.useRealTimers()
  })

  it('si falla el envío, el texto vuelve al cuadro y se avisa', async () => {
    const routes = baseRoutes()
    routes[`POST /messages/conversations/${CONV}/messages`] = () => {
      throw new Error('Estás mandando muchos mensajes seguidos. Esperá un momento.')
    }
    routeApi(routes)
    renderShell()
    fireEvent.click(await screen.findByRole('button', { name: /Mensajes/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Mensajes' })
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Leopoldo Giménez, 2 sin leer' }))
    await within(dialog).findByText('¿Cómo estás?')

    const box = within(dialog).getByLabelText('Escribí un mensaje')
    fireEvent.change(box, { target: { value: 'Hola' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Estás mandando muchos mensajes seguidos')
    expect(box).toHaveValue('Hola')
  })
})
