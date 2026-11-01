import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import JustifyEntryModal from './JustifyEntryModal'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

const onClose = vi.fn()
const onDone = vi.fn()

function setup() {
  return render(
    <JustifyEntryModal entryId="e-1" studentName="Ana Díaz" onClose={onClose} onDone={onDone} />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedApi.mockResolvedValue({})
})

describe('<JustifyEntryModal />', () => {
  it('justifica la falta: el peso no se elige, lo fija el reglamento', async () => {
    setup()
    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: 'Certificado médico' } })
    fireEvent.click(screen.getByRole('button', { name: /Registrar justificación/ }))

    await waitFor(() => expect(mockedApi).toHaveBeenCalled())
    const [path, init] = mockedApi.mock.calls[0]
    expect(path).toBe('/admin/student-attendance/entries/e-1/justify')
    const body = JSON.parse(String(init?.body))
    expect(body).toMatchObject({ reason: 'Certificado médico' })
    // Una justificada vale media falta en los dos niveles: no hay "falta entera" que elegir.
    expect(body).not.toHaveProperty('absenceWeightHundredths')
    expect(screen.queryByLabelText('Falta entera')).not.toBeInTheDocument()
  })

  it('Escape cierra sin guardar', () => {
    setup()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
    expect(mockedApi).not.toHaveBeenCalled()
  })

  it('muestra el error del backend', async () => {
    mockedApi.mockRejectedValue(new Error('Solo se justifican ausencias.'))
    setup()
    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: 'Certificado' } })
    fireEvent.click(screen.getByRole('button', { name: /Registrar justificación/ }))

    expect(await screen.findByText(/Solo se justifican ausencias/)).toBeInTheDocument()
    expect(onDone).not.toHaveBeenCalled()
  })
})
