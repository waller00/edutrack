import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminQueryAssistantPage from './page'
import { api } from '@/lib/api/client'

vi.mock('@/components/auth/RoleGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const schoolYearCtx = vi.hoisted(() => ({
  value: {
    loading: false,
    years: [
      {
        id: '00000000-0000-4000-8000-000000000026',
        code: 2026,
        label: 'Ciclo lectivo 2026',
        status: 'ACTIVE',
        startsOn: null,
        endsOn: null,
        createdAt: '',
        updatedAt: '',
      },
      {
        id: '00000000-0000-4000-8000-000000000025',
        code: 2025,
        label: 'Ciclo lectivo 2025',
        status: 'CLOSED',
        startsOn: null,
        endsOn: null,
        createdAt: '',
        updatedAt: '',
      },
    ],
    allYears: false,
    selectedId: '00000000-0000-4000-8000-000000000026',
    activeId: '00000000-0000-4000-8000-000000000026',
    setSelectedId: vi.fn(),
    setAllYears: vi.fn(),
  },
}))

vi.mock('@/contexts/AdminSchoolYearContext', () => ({
  useOptionalAdminSchoolYear: () => schoolYearCtx.value,
}))

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

describe('AdminQueryAssistantPage', () => {
  beforeEach(() => {
    mockedApi.mockReset()
    schoolYearCtx.value.setSelectedId.mockReset()
    schoolYearCtx.value.setAllYears.mockReset()
    schoolYearCtx.value = {
      ...schoolYearCtx.value,
      allYears: false,
      selectedId: '00000000-0000-4000-8000-000000000026',
      activeId: '00000000-0000-4000-8000-000000000026',
    }
  })

  it('muestra un filtro visible de ciclo lectivo', () => {
    render(<AdminQueryAssistantPage />)

    expect(screen.getByText('Filtro de ciclo lectivo')).toBeInTheDocument()
    expect(screen.getByLabelText('Ciclo lectivo')).toHaveValue('00000000-0000-4000-8000-000000000026')
    expect(screen.getByLabelText('Todos los ciclos')).not.toBeChecked()
  })

  it('permite cambiar el ciclo desde la pantalla', () => {
    render(<AdminQueryAssistantPage />)

    fireEvent.change(screen.getByLabelText('Ciclo lectivo'), {
      target: { value: '00000000-0000-4000-8000-000000000025' },
    })

    expect(schoolYearCtx.value.setAllYears).toHaveBeenCalledWith(false)
    expect(schoolYearCtx.value.setSelectedId).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000025')
  })

  it('envía el ciclo lectivo seleccionado al consultar', async () => {
    mockedApi.mockResolvedValue({
      intent: 'HOURS_WORKED_SUMMARY',
      summary: 'ok',
      columns: [],
      rows: [],
    })

    render(<AdminQueryAssistantPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Consultar' }))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        '/admin/query-assistant',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('00000000-0000-4000-8000-000000000026'),
        }),
      ),
    )
  })

  it('envía allYears cuando el selector está en todos los ciclos', async () => {
    schoolYearCtx.value = {
      ...schoolYearCtx.value,
      allYears: true,
      selectedId: null,
      activeId: '00000000-0000-4000-8000-000000000026',
    } as any
    mockedApi.mockResolvedValue({
      intent: 'HOURS_WORKED_SUMMARY',
      summary: 'ok',
      columns: [],
      rows: [],
    })

    render(<AdminQueryAssistantPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Consultar' }))

    await waitFor(() => {
      const body = JSON.parse((mockedApi.mock.calls[0][1] as RequestInit).body as string)
      expect(body.allYears).toBe(true)
      expect(body.schoolYearId).toBeUndefined()
    })
  })
})
