import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AlertRulesTab, { inputToThreshold, thresholdToInput } from './AlertRulesTab'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

const RULES = {
  schoolYearId: 'sy-1',
  data: [
    { type: 'ALERT_SUBJECTS', threshold: 3, isActive: true, source: 'DEFAULT' },
    { type: 'SCORE_DROP', threshold: 200, isActive: false, source: 'GENERAL' },
    { type: 'NO_ASSESSMENTS', threshold: 0, isActive: false, source: 'DEFAULT' },
  ],
}

function card(title: string) {
  return screen.getByRole('heading', { name: title }).closest('section') as HTMLElement
}

describe('<AlertRulesTab />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedApi.mockResolvedValue(RULES)
  })

  it('muestra cada regla con su umbral y de dónde sale', async () => {
    render(<AlertRulesTab onError={vi.fn()} />)
    await screen.findByRole('heading', { name: 'Asignaturas en alerta' })
    const subjects = card('Asignaturas en alerta')
    expect(within(subjects).getByLabelText('Asignaturas')).toHaveValue('3')
    expect(within(subjects).getByText('Valor por defecto')).toBeInTheDocument()
    // La caída se escribe en puntos, aunque la API la guarde en centésimos.
    expect(within(card('Caída del promedio')).getByLabelText('Puntos de caída')).toHaveValue('2')
    // "Sin evaluaciones" no tiene umbral que elegir.
    expect(within(card('Sin evaluaciones')).queryByRole('textbox')).toBeNull()
  })

  it('guarda el umbral del ciclo convirtiendo puntos a centésimos', async () => {
    render(<AlertRulesTab onError={vi.fn()} />)
    await screen.findByRole('heading', { name: 'Caída del promedio' })
    const drop = card('Caída del promedio')

    fireEvent.change(within(drop).getByLabelText('Puntos de caída'), { target: { value: '2,5' } })
    fireEvent.click(within(drop).getByLabelText('Activa'))
    fireEvent.click(within(drop).getByRole('button', { name: 'Guardar' }))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith('/admin/academic-config/alert-rules', {
        method: 'PUT',
        body: JSON.stringify({ type: 'SCORE_DROP', threshold: 250, isActive: true }),
      }),
    )
  })

  it('muestra el error del servidor en la tarjeta', async () => {
    render(<AlertRulesTab onError={vi.fn()} />)
    await screen.findByRole('heading', { name: 'Asignaturas en alerta' })
    mockedApi.mockRejectedValueOnce(new Error('El umbral tiene que estar entre 1 y 30 asignaturas.'))

    const subjects = card('Asignaturas en alerta')
    fireEvent.change(within(subjects).getByLabelText('Asignaturas'), { target: { value: '0' } })
    fireEvent.click(within(subjects).getByRole('button', { name: 'Guardar' }))

    expect(await within(subjects).findByRole('alert')).toHaveTextContent('entre 1 y 30 asignaturas')
  })

  it('avisa si no puede cargar', async () => {
    mockedApi.mockRejectedValueOnce(new Error('Sin conexión'))
    const onError = vi.fn()
    render(<AlertRulesTab onError={onError} />)
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Sin conexión'))
  })
})

describe('conversión del umbral', () => {
  it('puntos ↔ centésimos sólo para la caída', () => {
    expect(thresholdToInput({ type: 'SCORE_DROP', threshold: 150 })).toBe('1.5')
    expect(thresholdToInput({ type: 'ALERT_SUBJECTS', threshold: 3 })).toBe('3')
    expect(inputToThreshold('SCORE_DROP', '1,5')).toBe(150)
    expect(inputToThreshold('ALERT_SUBJECTS', '4')).toBe(4)
    expect(inputToThreshold('ALERT_SUBJECTS', 'abc')).toBeNull()
    expect(inputToThreshold('ALERT_SUBJECTS', '  ')).toBeNull()
  })
})
