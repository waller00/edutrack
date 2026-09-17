import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PeriodsTab, { deactivateMessage } from './PeriodsTab'
import { api } from '@/lib/api/client'
import type { AcademicPeriod } from '@/lib/academic-config/types'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

function period(over: Partial<AcademicPeriod> = {}): AcademicPeriod {
  return {
    id: 'p-1', schoolYearId: 'sy-1', level: 'EBI', code: 'MAYO', name: 'Mayo', sortOrder: 2,
    startsOn: '2026-05-01', endsOn: '2026-05-31', closesOn: '2026-06-08',
    requiresConceptualJudgement: true, requiresGeneralGrade: true, isActive: true,
    usage: { assessments: 0, closedGradeBooks: 0 },
    ...over,
  }
}

const onError = vi.fn()

function respond(periods: AcademicPeriod[]) {
  mockedApi.mockResolvedValue({ data: periods, schoolYearId: 'sy-1' })
}

describe('<PeriodsTab />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lista los períodos separados por nivel', async () => {
    respond([period(), period({ id: 'p-2', level: 'EMS', code: 'JUNIO', name: 'Junio' })])

    render(<PeriodsTab onError={onError} />)

    expect(await screen.findByText('Mayo')).toBeInTheDocument()
    expect(screen.getByText('Junio')).toBeInTheDocument()
  })

  it('crea un período con el ciclo y el nivel de la sección', async () => {
    respond([period()])

    render(<PeriodsTab onError={onError} />)
    fireEvent.click(await screen.findByRole('button', { name: /Nuevo período en EMS/ }))

    fireEvent.change(screen.getByLabelText('Código'), { target: { value: 'SETIEMBRE' } })
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Setiembre' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(3))
    const [path, init] = mockedApi.mock.calls[1]
    expect(path).toBe('/admin/academic-config/periods')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      schoolYearId: 'sy-1', level: 'EMS', code: 'SETIEMBRE', name: 'Setiembre',
    })
  })

  it('edita con PATCH y sin mandar código ni nivel', async () => {
    respond([period()])

    render(<PeriodsTab onError={onError} />)
    fireEvent.click(await screen.findByRole('button', { name: /Editar/ }))

    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Mayo (ajustado)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(3))
    const [path, init] = mockedApi.mock.calls[1]
    expect(path).toBe('/admin/academic-config/periods/p-1')
    expect(init?.method).toBe('PATCH')
    const body = JSON.parse(String(init?.body))
    expect(body.name).toBe('Mayo (ajustado)')
    expect(body).not.toHaveProperty('code')
    expect(body).not.toHaveProperty('level')
  })

  it('el código no se puede editar', async () => {
    respond([period()])

    render(<PeriodsTab onError={onError} />)
    fireEvent.click(await screen.findByRole('button', { name: /Editar/ }))

    expect(screen.getByLabelText('Código')).toBeDisabled()
  })

  it('no llama al backend si la ventana está invertida', async () => {
    respond([period()])

    render(<PeriodsTab onError={onError} />)
    fireEvent.click(await screen.findByRole('button', { name: /Editar/ }))

    fireEvent.change(screen.getByLabelText('Cierre'), { target: { value: '01/05/2026' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/cierre no puede ser anterior/i)
    expect(mockedApi).toHaveBeenCalledTimes(1)
  })

  it('desactiva con DELETE tras confirmar', async () => {
    respond([period()])

    render(<PeriodsTab onError={onError} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Desactivar' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Desactivar' }))

    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(3))
    expect(mockedApi.mock.calls[1][0]).toBe('/admin/academic-config/periods/p-1')
    expect(mockedApi.mock.calls[1][1]?.method).toBe('DELETE')
  })

  it('un período inactivo no ofrece desactivarlo de nuevo', async () => {
    respond([period({ isActive: false })])

    render(<PeriodsTab onError={onError} />)
    await screen.findByText('Mayo')

    expect(screen.queryByRole('button', { name: 'Desactivar' })).not.toBeInTheDocument()
  })

  it('muestra el uso de cada período', async () => {
    respond([period({ usage: { assessments: 3, closedGradeBooks: 1 } })])

    render(<PeriodsTab onError={onError} />)

    expect(await screen.findByText('3 evaluaciones · 1 libreta cerrada')).toBeInTheDocument()
  })
})

describe('deactivateMessage', () => {
  it('aclara que desactivar no borra nada', () => {
    expect(deactivateMessage(period())).toMatch(/Nada de lo ya cargado se borra/)
  })

  it('avisa cuando hay libretas cerradas que dependen del período', () => {
    expect(deactivateMessage(period({ usage: { assessments: 0, closedGradeBooks: 4 } })))
      .toMatch(/4 libreta\(s\) ya cerraron/)
  })
})
