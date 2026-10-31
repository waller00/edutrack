import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SessionsCard from './SessionsCard'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({
  api: vi.fn(),
}))

const mockedApi = vi.mocked(api)

const CHROME_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'

const twoSessions = {
  sessions: [
    { current: true, createdAt: '2026-10-31T13:00:00.000Z', userAgent: CHROME_WINDOWS, ip: '190.2.2.2' },
    { current: false, createdAt: '2026-10-30T12:30:00.000Z', userAgent: CHROME_ANDROID, ip: '190.1.1.1' },
  ],
}

function respond(handlers: { list?: unknown[]; close?: () => Promise<unknown> }) {
  const lists = [...(handlers.list ?? [twoSessions])]
  mockedApi.mockImplementation((path: string) => {
    if (path === '/auth/account/sessions/close-others') return (handlers.close ?? (() => Promise.resolve({ closed: 1 })))() as never
    return Promise.resolve(lists.length > 1 ? lists.shift() : lists[0]) as never
  })
}

describe('SessionsCard', () => {
  const originalLocation = window.location

  beforeEach(() => {
    mockedApi.mockReset()
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
  })

  it('muestra dónde está abierta la cuenta, con esta sesión marcada', async () => {
    respond({})
    render(<SessionsCard />)

    expect(await screen.findByText('Chrome en Android')).toBeInTheDocument()
    expect(screen.getByText('Chrome en Windows')).toBeInTheDocument()
    expect(screen.getByText('Esta sesión')).toBeInTheDocument()
    expect(screen.getByText(/Desde el 30\/10\/2026, 09:30 · IP 190\.1\.1\.1/)).toBeInTheDocument()
    expect(mockedApi).toHaveBeenCalledWith('/auth/account/sessions')
  })

  it('sin otros dispositivos no ofrece cerrar nada', async () => {
    respond({ list: [{ sessions: [twoSessions.sessions[0]] }] })
    render(<SessionsCard />)

    expect(await screen.findByText('No tenés sesiones abiertas en otros dispositivos.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Cerrar las otras sesiones/ })).not.toBeInTheDocument()
  })

  it('pide confirmación, cierra las otras, avisa y recarga la lista', async () => {
    respond({ list: [twoSessions, { sessions: [twoSessions.sessions[0]] }] })
    const onClosed = vi.fn()
    render(<SessionsCard onClosed={onClosed} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Cerrar las otras sesiones (1)' }))
    expect(screen.getByText(/¿Cerrar la otra sesión\?/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesiones' }))

    await waitFor(() => expect(onClosed).toHaveBeenCalledWith(expect.stringContaining('se cerraron 1 sesión')))
    expect(mockedApi).toHaveBeenCalledWith('/auth/account/sessions/close-others', { method: 'POST' })
    expect(await screen.findByText('No tenés sesiones abiertas en otros dispositivos.')).toBeInTheDocument()
  })

  it('con un ingreso viejo manda a reingresar y vuelve a esta confirmación', async () => {
    Object.defineProperty(window, 'location', { configurable: true, value: { href: 'http://localhost:3000/profile' } })
    respond({ close: () => Promise.reject({ message: 'Reingresá', data: { code: 'REAUTH_REQUIRED' } }) })
    render(<SessionsCard confirmRequested />)

    fireEvent.click(await screen.findByRole('button', { name: 'Cerrar sesiones' }))

    await waitFor(() => expect(window.location.href).toBe('http://localhost:4000/auth/account/reauth?then=sessions'))
  })

  it('si no se pueden consultar lo dice y deja reintentar', async () => {
    respond({})
    mockedApi.mockRejectedValueOnce(new Error('503'))
    render(<SessionsCard />)

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron consultar tus sesiones.')
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Chrome en Android')).toBeInTheDocument()
  })
})
