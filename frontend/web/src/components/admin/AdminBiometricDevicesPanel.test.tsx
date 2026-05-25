import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminBiometricDevicesPanel from './AdminBiometricDevicesPanel'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

const devices = [
  {
    id: 'd1',
    code: 'F22-LOCAL-01',
    name: 'ZKTeco F22 Local',
    admsSerial: null,
    timezone: 'America/Montevideo',
    isActive: true,
    allowedIps: [],
    lastSeenAt: '2026-05-20T14:46:00.000Z',
    createdAt: '2026-05-20T14:46:00.000Z',
    updatedAt: '2026-05-20T14:46:00.000Z',
    _count: { mappings: 5, punches: 1, linkRequests: 0 },
  },
  {
    id: 'd2',
    code: 'F22-TEST-01',
    name: 'ZKTeco F22 Testing',
    admsSerial: 'SRN5260500102',
    timezone: 'America/Montevideo',
    isActive: true,
    allowedIps: [],
    lastSeenAt: '2026-05-23T18:22:00.000Z',
    createdAt: '2026-05-23T18:22:00.000Z',
    updatedAt: '2026-05-23T18:22:00.000Z',
    _count: { mappings: 6, punches: 18, linkRequests: 0 },
  },
]

describe('AdminBiometricDevicesPanel', () => {
  beforeEach(() => {
    mockedApi.mockReset()
  })

  it('permite seleccionar un lector haciendo click en toda la fila', async () => {
    mockedApi.mockResolvedValue({ devices })

    render(<AdminBiometricDevicesPanel />)

    expect(await screen.findAllByText('ZKTeco F22 Local')).toHaveLength(2)
    expect(screen.getByText('Sin serial')).toBeInTheDocument()

    const testingRow = screen.getByRole('button', { name: /ZKTeco F22 Testing/i })
    fireEvent.click(testingRow)

    await waitFor(() => expect(testingRow).toHaveAttribute('aria-pressed', 'true'))
    expect(screen.queryByText('Sin serial')).not.toBeInTheDocument()
  })
})
