import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GradeBooksTab, { provisionResult } from './GradeBooksTab'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

describe('<GradeBooksTab />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('genera las libretas y cuenta qué pasó, con lo que conviene revisar', async () => {
    mockedApi.mockResolvedValue({ data: { created: 2, updated: 1, unchanged: 30, skippedEvents: 3, skippedNotOffered: 0 } })
    render(<GradeBooksTab onError={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Generar libretas ahora' }))

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Se crearon 2 libretas nuevas.')
    expect(status).toHaveTextContent('1 libreta cambió de titular.')
    expect(status).toHaveTextContent('30 ya estaban al día.')
    expect(status).toHaveTextContent('3 clases del horario no tienen asignatura o curso')
    expect(mockedApi).toHaveBeenCalledWith('/admin/academic-config/gradebooks/provision', { method: 'POST' })
  })

  it('reporta el error', async () => {
    mockedApi.mockRejectedValue(new Error('No hay ciclo lectivo activo'))
    const onError = vi.fn()
    render(<GradeBooksTab onError={onError} />)

    fireEvent.click(screen.getByRole('button', { name: 'Generar libretas ahora' }))

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('No hay ciclo lectivo activo'))
  })
})

describe('provisionResult', () => {
  it('sin nada nuevo lo dice', () => {
    const result = provisionResult({ created: 0, updated: 0, unchanged: 5, skippedEvents: 0, skippedNotOffered: 1 })
    expect(result.done).toEqual(['No faltaba ninguna libreta.', '5 ya estaban al día.'])
    expect(result.warnings).toEqual(['1 grupo es de cursos que no se ofertan este ciclo y se omitieron.'])
  })
})
