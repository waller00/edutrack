import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WebPushSection from './WebPushSection'
import {
  getCurrentDeviceWebPushState,
  getWebPushServerStatusWithRetry,
  getWebPushSupportState,
  subscribeCurrentDeviceToWebPush,
  unsubscribeCurrentDeviceFromWebPush,
} from '@/lib/notifications/web-push-client'

vi.mock('@/lib/notifications/web-push-client', () => ({
  getCurrentDeviceWebPushState: vi.fn(),
  getWebPushServerStatusWithRetry: vi.fn(),
  getWebPushSupportState: vi.fn(),
  subscribeCurrentDeviceToWebPush: vi.fn(),
  unsubscribeCurrentDeviceFromWebPush: vi.fn(),
}))

const server = vi.mocked(getWebPushServerStatusWithRetry)
const device = vi.mocked(getCurrentDeviceWebPushState)
const support = vi.mocked(getWebPushSupportState)
const subscribe = vi.mocked(subscribeCurrentDeviceToWebPush)
const unsubscribe = vi.mocked(unsubscribeCurrentDeviceFromWebPush)

describe('WebPushSection', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    support.mockReturnValue({ code: 'supported' })
    server.mockResolvedValue({ configured: true, subscriptionCount: 0 })
    device.mockResolvedValue({ subscribed: false })
  })

  it('consulta el estado sin solicitar suscripción automáticamente', async () => {
    render(<WebPushSection />)
    expect(await screen.findByText('Desactivadas en este dispositivo')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Activar notificaciones' })).toBeEnabled()
    expect(subscribe).not.toHaveBeenCalled()
    expect(unsubscribe).not.toHaveBeenCalled()
    expect(screen.getByText(/El navegador te pedirá permiso/)).not.toBeVisible()
  })

  it('activa por decisión del usuario y mantiene el aviso luego de consultar el estado', async () => {
    device.mockResolvedValueOnce({ subscribed: false }).mockResolvedValue({ subscribed: true })
    subscribe.mockResolvedValue({ ok: true })
    render(<WebPushSection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Activar notificaciones' }))
    expect(await screen.findByRole('button', { name: 'Desactivar notificaciones' })).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent('Notificaciones activadas en este dispositivo.')
    expect(subscribe).toHaveBeenCalledTimes(1)
  })

  it('desactiva sólo este dispositivo y conserva la confirmación', async () => {
    device.mockResolvedValueOnce({ subscribed: true }).mockResolvedValue({ subscribed: false })
    unsubscribe.mockResolvedValue(undefined)
    render(<WebPushSection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Desactivar notificaciones' }))
    expect(await screen.findByRole('button', { name: 'Activar notificaciones' })).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent('Notificaciones desactivadas en este dispositivo.')
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('si el usuario rechaza el permiso, no muestra notificaciones activadas', async () => {
    subscribe.mockResolvedValue({ ok: false, error: 'Tenés que permitir notificaciones en el navegador para activarlas.' })
    render(<WebPushSection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Activar notificaciones' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Tenés que permitir notificaciones')
    expect(screen.getByText('Desactivadas en este dispositivo')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Activar notificaciones' })).toBeEnabled()
  })

  it('permite reintentar una consulta fallida sin afirmar que faltan configuraciones', async () => {
    server.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ configured: true, subscriptionCount: 0 })
    render(<WebPushSection />)
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo consultar')
    expect(screen.queryByText(/no están habilitadas por la institución/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Activar notificaciones' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('button', { name: 'Activar notificaciones' })).toBeEnabled()
  })

  it('explica que la institución debe habilitarlas sin exponer detalles técnicos', async () => {
    server.mockResolvedValue({ configured: false, subscriptionCount: 0 })
    render(<WebPushSection />)
    expect(await screen.findByText(/no están habilitadas por la institución/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Activar notificaciones' })).not.toBeInTheDocument()
  })

  it.each(['insecure-context', 'no-service-worker', 'no-notification', 'no-push-manager'] as const)(
    'explica compatibilidad %s sin suscripciones ni consultas innecesarias', async (code) => {
      support.mockReturnValue({ code })
      render(<WebPushSection />)
      expect(screen.queryByRole('button', { name: 'Activar notificaciones' })).not.toBeInTheDocument()
      expect(server).not.toHaveBeenCalled()
      expect(subscribe).not.toHaveBeenCalled()
      if (code === 'insecure-context') expect(screen.getByText(/dirección segura/)).toBeVisible()
    },
  )
})
