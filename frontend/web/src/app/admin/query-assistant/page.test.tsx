import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminQueryAssistantPage from './page'
import { api } from '@/lib/api/client'

vi.mock('@/components/auth/RoleGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const schoolYearCtx = vi.hoisted(() => ({
  value: {
    allYears: false,
    selectedId: '00000000-0000-4000-8000-000000000026',
    activeId: '00000000-0000-4000-8000-000000000026',
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
    schoolYearCtx.value = {
      allYears: false,
      selectedId: '00000000-0000-4000-8000-000000000026',
      activeId: '00000000-0000-4000-8000-000000000026',
    }
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
