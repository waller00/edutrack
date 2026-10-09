import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminMoodlePanel from './AdminMoodlePanel'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)
const settings = {
  moodleConfigured: true,
  moodleSyncEnabled: true,
  moodleSyncEnabledEffective: true,
  moodleSyncEnabledFromEnv: false,
  moodleReconcileIntervalMs: 900000,
  moodleSyncStudents: false,
}
const health = {
  configured: true,
  baseUrl: 'https://moodle.example.edu',
  syncEnabled: true,
  connection: { ok: true, siteName: 'Aula virtual', moodleVersion: '4.5' },
  outbox: { pending: 2, processing: 0, failed: 0, completed: 20 },
  reconcile: {
    running: false,
    startedAt: null,
    finishedAt: null,
    lastSummary: null,
    lastError: null,
  },
}

function mockLoaded(overrides = {}) {
  mockedApi.mockImplementation(async (url, options) => {
    if (url === '/admin/moodle/status') return health
    if (url === '/admin/moodle/reconcile')
      return { message: 'Sincronización iniciada.' }
    return {
      ...settings,
      ...overrides,
      ...(options?.body ? JSON.parse(String(options.body)) : {}),
    }
  })
}

describe('AdminMoodlePanel', () => {
  beforeEach(() => {
    mockedApi.mockReset()
    mockLoaded()
  })

  it('muestra conexión y controles principales y mantiene los detalles desplegables', async () => {
    render(<AdminMoodlePanel />)
    expect(await screen.findByText('Conectado')).toBeVisible()
    expect(
      screen.getByRole('checkbox', { name: 'Sincronización automática' }),
    ).toBeChecked()
    expect(
      screen.getByLabelText('Intervalo de revisión (minutos)'),
    ).not.toBeVisible()
    expect(screen.getByText('https://moodle.example.edu')).not.toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Sincronizar ahora' }),
    ).toBeEnabled()
  })

  it('guarda minutos como milisegundos y los estados booleanos de sincronización', async () => {
    render(<AdminMoodlePanel />)
    await screen.findByText('Conectado')
    fireEvent.click(screen.getByText('Opciones de sincronización'))
    fireEvent.change(screen.getByLabelText('Intervalo de revisión (minutos)'), {
      target: { value: '30' },
    })
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Sincronizar estudiantes' }),
    )
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Sincronización automática' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Guardar Moodle' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Configuración Moodle guardada.',
    )
    expect(mockedApi).toHaveBeenCalledWith('/admin/system-settings', {
      method: 'PUT',
      body: JSON.stringify({
        moodleSyncEnabled: false,
        moodleReconcileIntervalMs: 1800000,
        moodleSyncStudents: true,
      }),
    })
  })

  it('probar conexión actualiza el estado sin perder el borrador', async () => {
    render(<AdminMoodlePanel />)
    await screen.findByText('Conectado')
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Sincronización automática' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Probar conexión' }))
    await screen.findByText('Estado actualizado.')
    expect(
      screen.getByRole('checkbox', { name: 'Sincronización automática' }),
    ).not.toBeChecked()
    expect(
      mockedApi.mock.calls.filter(([url]) => url === '/admin/system-settings'),
    ).toHaveLength(1)
  })

  it('no inicia una sincronización sin configurar la integración', async () => {
    mockLoaded({ moodleConfigured: false })
    render(<AdminMoodlePanel />)
    await screen.findByText('Sin configurar')
    expect(
      screen.getByRole('button', { name: 'Sincronizar ahora' }),
    ).toBeDisabled()
    expect(
      mockedApi.mock.calls.some(([url]) => url === '/admin/moodle/reconcile'),
    ).toBe(false)
  })

  it('explica cuando el servidor mantiene la sincronización activa', async () => {
    mockLoaded({ moodleSyncEnabled: false, moodleSyncEnabledFromEnv: true })
    render(<AdminMoodlePanel />)
    expect(
      await screen.findByText(/sigue activa por la configuración del servidor/),
    ).toBeVisible()
  })

  it('sincroniza únicamente al pulsar la acción y consulta el resultado', async () => {
    render(<AdminMoodlePanel />)
    await screen.findByText('Conectado')
    fireEvent.click(screen.getByRole('button', { name: 'Sincronizar ahora' }))
    await screen.findByText('Sincronización iniciada.')
    expect(mockedApi).toHaveBeenCalledWith('/admin/moodle/reconcile', {
      method: 'POST',
    })
    expect(
      mockedApi.mock.calls.filter(([url]) => url === '/admin/moodle/status'),
    ).toHaveLength(2)
  })

  it('deja reintentar una carga fallida', async () => {
    mockedApi.mockRejectedValueOnce(new Error('offline'))
    render(<AdminMoodlePanel />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudo cargar',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Conectado')).toBeVisible()
  })

  it('protege cambios pendientes al recargar', async () => {
    render(<AdminMoodlePanel />)
    await screen.findByText('Conectado')
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Sincronización automática' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Recargar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('sin guardar')
    expect(
      mockedApi.mock.calls.filter(([url]) => url === '/admin/system-settings'),
    ).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Seguir editando' }))
    expect(
      screen.getByRole('checkbox', { name: 'Sincronización automática' }),
    ).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Recargar' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Descartar cambios y recargar' }),
    )
    await waitFor(() =>
      expect(
        screen.getByRole('checkbox', { name: 'Sincronización automática' }),
      ).toBeChecked(),
    )
  })
})
