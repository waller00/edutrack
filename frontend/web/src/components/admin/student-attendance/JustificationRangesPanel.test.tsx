import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import JustificationRangesPanel from './JustificationRangesPanel'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
vi.mock('@/contexts/AdminSchoolYearContext', () => ({ useOptionalAdminSchoolYear: () => null }))
const mockedApi = vi.mocked(api)

const STUDENT = { id: 'st-1', firstName: 'Ana', lastName: 'Díaz', documentId: '5123', courseName: '7 EBI' }
let ranges: unknown[] = []

beforeEach(() => {
  vi.clearAllMocks()
  ranges = []
  mockedApi.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.includes('/justification-ranges/students')) return { data: [STUDENT] } as never
    if (init?.method === 'POST' && path.endsWith('/revoke')) return {} as never
    if (init?.method === 'POST') return { justifiedCount: 2, range: { id: 'r-1' } } as never
    if (path.includes('/justification-ranges?')) return { data: ranges } as never
    return {} as never
  })
})

async function pickStudent() {
  render(<JustificationRangesPanel />)
  fireEvent.change(screen.getByPlaceholderText(/Apellido, nombre o documento/), { target: { value: 'diaz' } })
  fireEvent.click(await screen.findByRole('button', { name: /Díaz, Ana/ }))
}

describe('<JustificationRangesPanel />', () => {
  it('busca estudiantes de cualquier nivel', async () => {
    await pickStudent()
    expect(mockedApi).toHaveBeenCalledWith('/admin/student-attendance/justification-ranges/students?q=diaz')
    expect(await screen.findByText(/Díaz, Ana · 7 EBI/)).toBeInTheDocument()
  })

  it('carga un justificativo e informa cuántas faltas ya marcadas justificó', async () => {
    await pickStudent()
    fireEvent.change(screen.getByLabelText(/Desde/), { target: { value: '2026-10-05' } })
    fireEvent.change(screen.getByLabelText(/Hasta/), { target: { value: '2026-10-07' } })
    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: 'Viaje familiar' } })
    fireEvent.click(screen.getByRole('button', { name: /Cargar justificativo/ }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/2 falta\(s\) ya marcadas/))
    const post = mockedApi.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(post?.[0]).toBe('/admin/student-attendance/justification-ranges')
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      studentId: 'st-1',
      fromYmd: '2026-10-05',
      toYmd: '2026-10-07',
      reason: 'Viaje familiar',
      notes: null,
    })
  })

  it('no deja guardar un rango invertido', async () => {
    await pickStudent()
    fireEvent.change(screen.getByLabelText(/Desde/), { target: { value: '2026-10-07' } })
    fireEvent.change(screen.getByLabelText(/Hasta/), { target: { value: '2026-10-05' } })
    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: 'Viaje familiar' } })

    expect(screen.getByText(/no puede ser posterior/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Cargar justificativo/ })).toBeDisabled()
  })

  it('revocar pide confirmación en la página', async () => {
    ranges = [
      { id: 'r-1', studentId: 'st-1', fromYmd: '2026-10-05', toYmd: '2026-10-05', reason: 'Médico', notes: null, createdAt: '', revokedAt: null },
    ]
    await pickStudent()
    fireEvent.click(await screen.findByRole('button', { name: /^Revocar$/ }))
    fireEvent.click(screen.getByRole('button', { name: /Sí, revocar/ }))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/admin/student-attendance/justification-ranges/r-1/revoke', { method: 'POST' }),
    )
  })
})

describe('<JustificationRangesPanel /> últimos justificativos', () => {
  it('sin estudiante elegido, muestra los últimos del ciclo y el nombre abre al estudiante', async () => {
    mockedApi.mockImplementation(async (path: string) => {
      if (path === '/admin/student-attendance/justification-ranges') {
        return {
          data: [
            { id: 'r-9', studentId: 'st-1', fromYmd: '2026-10-05', toYmd: '2026-10-07', reason: 'Certificado médico', notes: null, createdAt: '', revokedAt: null, student: STUDENT },
          ],
        } as never
      }
      if (path.includes('/justification-ranges?')) return { data: [] } as never
      return {} as never
    })
    render(<JustificationRangesPanel />)

    expect(await screen.findByText('Últimos justificativos')).toBeInTheDocument()
    expect(screen.getByText('Certificado médico')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Díaz, Ana' }))
    expect(await screen.findByText(/Díaz, Ana · 7 EBI/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Cargar justificativo/ })).toBeInTheDocument()
  })
})
