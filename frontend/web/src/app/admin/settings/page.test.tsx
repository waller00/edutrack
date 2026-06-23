import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminSystemSettingsPage from './page'
import { api } from '@/lib/api/client'

vi.mock('@/components/auth/RoleGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
vi.mock('@/components/admin/AdminOperationalSettingsPanel', () => ({
  default: () => <div data-testid="operational-panel" />,
}))
vi.mock('@/components/admin/AdminBiometricDevicesPanel', () => ({
  default: () => <div data-testid="readers-panel" />,
}))
vi.mock('@/components/admin/AdminMoodlePanel', () => ({
  default: () => <div data-testid="moodle-panel" />,
}))

const mockedApi = vi.mocked(api)

describe('AdminSystemSettingsPage', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/admin/settings')
    mockedApi.mockReset()
    mockedApi.mockResolvedValue({} as never)
  })

  it('muestra tabs de secciones también en mobile (nav duplicada sidebar + tabs)', async () => {
    render(<AdminSystemSettingsPage />)
    await waitFor(() => expect(screen.getByTestId('operational-panel')).toBeInTheDocument())

    // Cada sección aparece en el sidebar (lg) y en la barra de tabs (mobile).
    expect(screen.getAllByRole('button', { name: /Moodle/ }).length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByRole('button', { name: /Pruebas/ })).not.toBeInTheDocument()
  })

  it('cambia de sección al tocar una tab', async () => {
    render(<AdminSystemSettingsPage />)
    await waitFor(() => expect(screen.getByTestId('operational-panel')).toBeInTheDocument())

    fireEvent.click(screen.getAllByRole('button', { name: /Moodle/ })[0])

    expect(screen.getByTestId('moodle-panel')).toBeInTheDocument()
  })

  it('ignora la sección de pruebas si llega por query string', async () => {
    window.history.replaceState(null, '', '/admin/settings?section=testing')

    render(<AdminSystemSettingsPage />)

    await waitFor(() => expect(screen.getByTestId('operational-panel')).toBeInTheDocument())
    expect(screen.queryByTestId('testing-panel')).not.toBeInTheDocument()
  })
})
