import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import MyLicensesPage from './MyLicensesPage'

vi.mock('@/components/RoleGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="guard">{children}</div>,
}))

vi.mock('@/lib/api', () => ({ api: vi.fn() }))

describe('MyLicensesPage', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset()
  })

  it('muestra solo las licencias del usuario', async () => {
    vi.mocked(api).mockResolvedValue({
      data: [
        {
          id: 'l1',
          type: 'MEDICAL_LEAVE',
          status: 'ACTIVE',
          startDate: '2025-01-01',
          endDate: '2025-01-03',
          reason: 'Reposo',
          notes: 'Control',
        },
      ],
    })

    render(<MyLicensesPage role="STAFF" />)

    expect(await screen.findByText('Mis Licencias')).toBeInTheDocument()
    expect(screen.getByText('Reposo')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /editar/i })).not.toBeInTheDocument()
  })

  it('muestra enlace de certificado cuando existe', async () => {
    vi.mocked(api).mockResolvedValue({
      data: [
        {
          id: 'l1',
          type: 'MEDICAL_LEAVE',
          status: 'ACTIVE',
          startDate: '2025-01-01',
          endDate: '2025-01-03',
          reason: 'Reposo',
          notes: '',
          certificate: 'https://example.com/cert.pdf',
        },
      ],
    })

    render(<MyLicensesPage role="TEACHER" />)

    const link = await screen.findByRole('link', { name: 'Ver Certificado' })
    expect(link).toHaveAttribute('href', 'https://example.com/cert.pdf')
  })

  it('certificado en data URL usa botón Ver Certificado (no href largo)', async () => {
    const tinyPng =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    vi.mocked(api).mockResolvedValue({
      data: [
        {
          id: 'l1',
          type: 'MEDICAL_LEAVE',
          status: 'ACTIVE',
          startDate: '2025-01-01',
          endDate: '2025-01-03',
          reason: 'Reposo',
          certificate: tinyPng,
        },
      ],
    })

    render(<MyLicensesPage role="TEACHER" />)

    expect(await screen.findByRole('button', { name: 'Ver Certificado' })).toBeInTheDocument()
  })
})
