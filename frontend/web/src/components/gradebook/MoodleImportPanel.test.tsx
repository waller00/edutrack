import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MoodleImportPanel from './MoodleImportPanel'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

const PREVIEW = {
  moodleCourseId: 7,
  items: [
    {
      moodleGradeItemId: 10,
      name: 'Parcial 1',
      moodleMin: 0,
      moodleMax: 100,
      existingAssessmentId: null,
      matched: 12,
      unmatched: 0,
    },
  ],
  studentsWithoutMoodleAccount: 0,
}

const PERIODS = [{ id: 'p-1', name: 'Mayo' }]
const SCALES = [{ id: 'sc-1', name: 'Numérica 1 a 12' }]

function renderPanel(onImported = vi.fn()) {
  return render(
    <MoodleImportPanel gradeBookId="gb-1" periods={PERIODS} scales={SCALES} onImported={onImported} />,
  )
}

beforeEach(() => {
  mockedApi.mockReset()
  mockedApi.mockResolvedValue(PREVIEW as any)
})

describe('MoodleImportPanel', () => {
  it('muestra los ítems con su rango y cuántas notas mapean', async () => {
    renderPanel()
    expect(await screen.findByText('Parcial 1')).toBeInTheDocument()
    expect(screen.getByText('0–100 en Moodle')).toBeInTheDocument()
    expect(screen.getByText('12 nota(s)')).toBeInTheDocument()
  })

  it('la previsualización no escribe nada', async () => {
    renderPanel()
    await screen.findByText('Parcial 1')
    expect(mockedApi.mock.calls.every(([, init]) => (init as any)?.method !== 'POST')).toBe(true)
  })

  it('avisa qué ítem ya se importó antes', async () => {
    mockedApi.mockResolvedValue({
      ...PREVIEW,
      items: [{ ...PREVIEW.items[0], existingAssessmentId: 'a-1' }],
    } as any)
    renderPanel()
    expect(await screen.findByText('ya importado · se actualiza')).toBeInTheDocument()
  })

  it('avisa de los alumnos sin cuenta Moodle', async () => {
    mockedApi.mockResolvedValue({ ...PREVIEW, studentsWithoutMoodleAccount: 3 } as any)
    renderPanel()
    expect(await screen.findByText(/3 estudiante\(s\) del grupo no tienen cuenta Moodle/)).toBeInTheDocument()
  })

  it('no deja importar sin elegir ítem, período y escala', async () => {
    renderPanel()
    const button = await screen.findByRole('button', { name: /Importar/ })
    expect(button).toBeDisabled()

    fireEvent.click(screen.getByLabelText('Importar Parcial 1'))
    expect(button).toBeDisabled() // falta período y escala

    fireEvent.change(screen.getByLabelText('Período destino'), { target: { value: 'p-1' } })
    fireEvent.change(screen.getByLabelText('Escala destino'), { target: { value: 'sc-1' } })
    expect(button).toBeEnabled()
  })

  it('importa mandando los ítems, período y escala elegidos', async () => {
    const onImported = vi.fn()
    renderPanel(onImported)
    await screen.findByText('Parcial 1')

    fireEvent.click(screen.getByLabelText('Importar Parcial 1'))
    fireEvent.change(screen.getByLabelText('Período destino'), { target: { value: 'p-1' } })
    fireEvent.change(screen.getByLabelText('Escala destino'), { target: { value: 'sc-1' } })

    mockedApi.mockResolvedValueOnce({ data: [{ name: 'Parcial 1', created: 12, updated: 0, skippedUnmatched: 0 }] } as any)
    fireEvent.click(screen.getByRole('button', { name: /Importar/ }))

    await waitFor(() => {
      const post = mockedApi.mock.calls.find(([, init]) => (init as any)?.method === 'POST')
      expect(JSON.parse((post?.[1] as any).body)).toEqual({
        moodleGradeItemIds: [10],
        periodId: 'p-1',
        gradingScaleId: 'sc-1',
      })
    })
    await waitFor(() => expect(onImported).toHaveBeenCalled())
  })

  it('pide la previsualización en la escala del nivel y la vuelve a pedir al cambiarla', async () => {
    render(
      <MoodleImportPanel
        gradeBookId="gb-1"
        periods={PERIODS}
        scales={[...SCALES, { id: 'sc-2', name: 'Numérica 1 a 10' }]}
        defaultScaleId="sc-1"
        onImported={vi.fn()}
      />,
    )
    await screen.findByText('Parcial 1')
    expect(mockedApi).toHaveBeenCalledWith('/gradebook/gb-1/moodle/preview?gradingScaleId=sc-1')

    fireEvent.change(screen.getByLabelText('Escala destino'), { target: { value: 'sc-2' } })

    await waitFor(() => expect(mockedApi).toHaveBeenCalledWith('/gradebook/gb-1/moodle/preview?gradingScaleId=sc-2'))
  })

  it('muestra alumno por alumno qué trae Moodle, cómo queda y qué le pasa, en texto', async () => {
    mockedApi.mockResolvedValue({
      ...PREVIEW,
      items: [
        {
          ...PREVIEW.items[0],
          existingAssessmentId: 'a-1',
          summary: { new: 1, update: 0, unchanged: 0, editedInEduTrack: 1 },
          rows: [
            { studentId: 's2', studentName: 'Acosta, Bruno', moodleRaw: 80, valueHundredths: 980, currentValueHundredths: null, status: 'NEW' },
            { studentId: 's1', studentName: 'Suárez, Ana', moodleRaw: 100, valueHundredths: 1200, currentValueHundredths: 900, status: 'EDITED_IN_EDUTRACK' },
          ],
        },
      ],
    } as any)
    renderPanel()

    expect(await screen.findByText('1 nueva(s) · 1 corregida(s) en EduTrack (no se toca)')).toBeInTheDocument()
    expect(screen.queryByText('Acosta, Bruno')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Ver notas' }))

    const ana = screen.getByText('Suárez, Ana').closest('tr')!
    expect(ana).toHaveTextContent('100 / 100')
    expect(ana).toHaveTextContent('12')
    expect(ana).toHaveTextContent('9')
    expect(ana).toHaveTextContent('Corregida en EduTrack: no se toca')
    const bruno = screen.getByText('Acosta, Bruno').closest('tr')!
    expect(bruno).toHaveTextContent('9,8')
    expect(bruno).toHaveTextContent('Nueva')
  })

  it('al terminar dice cuántas notas corregidas en EduTrack no se tocaron', async () => {
    renderPanel()
    await screen.findByText('Parcial 1')

    fireEvent.click(screen.getByLabelText('Importar Parcial 1'))
    fireEvent.change(screen.getByLabelText('Período destino'), { target: { value: 'p-1' } })
    fireEvent.change(screen.getByLabelText('Escala destino'), { target: { value: 'sc-1' } })

    mockedApi.mockResolvedValueOnce({
      data: [{ name: 'Parcial 1', created: 0, updated: 2, skippedUnmatched: 0, skippedEditedInEduTrack: 1 }],
    } as any)
    fireEvent.click(screen.getByRole('button', { name: /Importar/ }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Importado: 0 nueva(s), 2 actualizada(s). 1 corregida(s) en EduTrack no se tocaron.',
    )
  })

  it('sin Moodle configurado se oculta en vez de romper la libreta', async () => {
    mockedApi.mockRejectedValue(new Error('La integración con Moodle no está configurada.'))
    renderPanel()

    expect(await screen.findByText(/no disponible: La integración con Moodle/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Importar/ })).not.toBeInTheDocument()
  })

  it('informa el error de un período cerrado sin romper el panel', async () => {
    renderPanel()
    await screen.findByText('Parcial 1')

    fireEvent.click(screen.getByLabelText('Importar Parcial 1'))
    fireEvent.change(screen.getByLabelText('Período destino'), { target: { value: 'p-1' } })
    fireEvent.change(screen.getByLabelText('Escala destino'), { target: { value: 'sc-1' } })

    mockedApi.mockRejectedValueOnce(new Error('El período está cerrado.'))
    fireEvent.click(screen.getByRole('button', { name: /Importar/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('El período está cerrado.')
  })
})
