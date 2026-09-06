import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import EndorsementsPage from './page'
import { api } from '@/lib/api/client'

vi.mock('@/components/auth/RoleGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="guard">{children}</div>,
}))
vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
vi.mock('@/contexts/AdminSchoolYearContext', () => ({ useOptionalAdminSchoolYear: () => null }))
const mockedApi = vi.mocked(api)

function row(over: any = {}) {
  return {
    gradeBookPeriodId: 'gbp-1',
    period: { name: 'Mayo' },
    subject: { name: 'Matemática' },
    teacher: { name: 'Ana G' },
    courseName: '3 EMS',
    orientationName: 'Ciencias de la Vida',
    closedAt: '2026-06-01T12:00:00Z',
    closedLate: false,
    sections: [
      { section: 'GRADES', status: 'PENDING', occurredAt: null, observations: null },
      { section: 'CLOSURE', status: 'PENDING', occurredAt: null, observations: null },
      { section: 'JUDGEMENTS', status: 'PENDING', occurredAt: null, observations: null },
      { section: 'ALL', status: 'PENDING', occurredAt: null, observations: null },
    ],
    overallStatus: 'PENDING',
    lastChangeAt: '2026-06-01T12:00:00Z',
    pendingAgeDays: 10,
    blockingSections: [],
    canFinalize: true,
    ...over,
  }
}

beforeEach(() => {
  mockedApi.mockReset()
  mockedApi.mockResolvedValue({ data: [row()] } as any)
})

describe('EndorsementsPage', () => {
  it('arranca filtrando por pendientes', async () => {
    render(<EndorsementsPage />)
    await screen.findByText('Matemática')
    expect(String(mockedApi.mock.calls[0][0])).toContain('pending=true')
  })

  it('muestra la libreta con su grupo, período y antigüedad', async () => {
    render(<EndorsementsPage />)
    expect(await screen.findByText('Matemática')).toBeInTheDocument()
    expect(screen.getByText(/3 EMS — Ciencias de la Vida/)).toBeInTheDocument()
    expect(screen.getByText('10 día(s)')).toBeInTheDocument()
  })

  it('el estado lleva símbolo además del color (RNF 7.2)', async () => {
    mockedApi.mockResolvedValue({
      data: [row({ sections: [{ section: 'GRADES', status: 'OBSERVED', occurredAt: null, observations: 'Falta un alumno.' }] })],
    } as any)
    render(<EndorsementsPage />)

    const badge = await screen.findByTitle('Calificaciones: Falta un alumno.')
    expect(badge).toHaveTextContent('Observado')
    expect(badge).toHaveTextContent('▲')
  })

  it('no deja visar si hay secciones observadas y explica cuáles', async () => {
    mockedApi.mockResolvedValue({
      data: [row({ canFinalize: false, blockingSections: ['CLOSURE'] })],
    } as any)
    render(<EndorsementsPage />)

    const button = await screen.findByRole('button', { name: /Visar/ })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', expect.stringContaining('Cierre'))
  })

  it('no vuelve a visar lo ya visado', async () => {
    mockedApi.mockResolvedValue({ data: [row({ overallStatus: 'ENDORSED', pendingAgeDays: null })] } as any)
    render(<EndorsementsPage />)
    expect(await screen.findByRole('button', { name: /Visar/ })).toBeDisabled()
  })

  it('visa el período mandando la sección ALL', async () => {
    render(<EndorsementsPage />)
    const button = await screen.findByRole('button', { name: /Visar/ })

    mockedApi.mockResolvedValueOnce({ data: { id: 'e-1' } } as any)
    fireEvent.click(button)

    await waitFor(() => {
      const post = mockedApi.mock.calls.find(([, init]) => (init as any)?.method === 'POST')
      expect(JSON.parse((post?.[1] as any).body)).toEqual({
        gradeBookPeriodId: 'gbp-1',
        section: 'ALL',
        status: 'ENDORSED',
      })
    })
  })

  it('observar exige escribir qué corregir; si se cancela no manda nada', async () => {
    const promptSpy = vi.spyOn(globalThis, 'prompt').mockReturnValue(null)
    render(<EndorsementsPage />)

    fireEvent.click(await screen.findByRole('button', { name: /Observar/ }))

    expect(mockedApi.mock.calls.some(([, init]) => (init as any)?.method === 'POST')).toBe(false)
    promptSpy.mockRestore()
  })

  it('explica el error del backend en vez de fallar en silencio', async () => {
    render(<EndorsementsPage />)
    const button = await screen.findByRole('button', { name: /Visar/ })

    mockedApi.mockRejectedValueOnce(new Error('Sólo Dirección puede visar una libreta.'))
    fireEvent.click(button)

    expect(await screen.findByRole('alert')).toHaveTextContent('Sólo Dirección puede visar')
  })

  it('aclara que el historial es append-only', async () => {
    render(<EndorsementsPage />)
    expect(await screen.findByText(/no borra el visado anterior, lo sucede/)).toBeInTheDocument()
  })
})
