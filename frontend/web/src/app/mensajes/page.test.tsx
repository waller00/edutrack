import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))

vi.mock('@/lib/api/client', () => ({ api: (...args: unknown[]) => apiMock(...args) }))
vi.mock('@/components/auth/RoleGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('@/components/common/ModuleHeader', () => ({ default: () => <h1>Mensajes</h1> }))

import MensajesPage from './page'

describe('/mensajes', () => {
  beforeEach(() => {
    apiMock.mockReset()
    apiMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/messages/conversations?q=')) return { data: [] }
      if (path === '/messages/conversations/c-9') return { data: { id: 'c-9', starred: false, other: { id: 'u-2', name: 'Ana García', roleLabel: 'Dirección' } } }
      if (path === '/messages/conversations/c-9/messages') return { data: [{ id: 'm1', body: 'Pasá por dirección', createdAt: '2026-10-21T13:00:00.000Z', mine: false }], hasMore: false }
      if (path === '/messages/conversations/c-9/read') return { ok: true }
      throw new Error(`API no simulada: ${path}`)
    })
  })

  it('sin conversación elegida invita a elegir una', async () => {
    Object.defineProperty(window, 'location', { configurable: true, value: { search: '' } })
    render(<MensajesPage />)
    expect(await screen.findByText('Elegí una conversación o buscá a alguien para escribirle.')).toBeInTheDocument()
  })

  it('con ?c= abre esa conversación (el enlace del push)', async () => {
    Object.defineProperty(window, 'location', { configurable: true, value: { search: '?c=c-9' } })
    render(<MensajesPage />)
    expect(await screen.findByText('Pasá por dirección')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Ana García' })).toBeInTheDocument()
  })
})
