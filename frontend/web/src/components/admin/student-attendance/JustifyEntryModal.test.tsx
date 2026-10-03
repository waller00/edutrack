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
  it('justifica con falta entera por defecto', async () => {
    setup()
    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: 'Certificado médico' } })
    fireEvent.click(screen.getByRole('button', { name: /Registrar justificación/ }))

    await waitFor(() => expect(mockedApi).toHaveBeenCalled())
    const [path, init] = mockedApi.mock.calls[0]
    expect(path).toBe('/admin/student-attendance/entries/e-1/justify')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      reason: 'Certificado médico',
      absenceWeightHundredths: 100,
    })
  })

  it('adscripción puede bajarla a media falta', () => {
    // No hay regla automática: lo decide quien justifica, caso por caso.
    setup()
    expect(screen.getByLabelText('Falta entera')).toBeChecked()

    fireEvent.click(screen.getByLabelText('Media falta'))
    expect(screen.getByLabelText('Media falta')).toBeChecked()
  })

  it('manda 50 cuando se elige media falta', async () => {
    setup()
    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: 'Se retiró a las 10' } })
    fireEvent.click(screen.getByLabelText('Media falta'))
    fireEvent.click(screen.getByRole('button', { name: /Registrar justificación/ }))

    await waitFor(() => expect(mockedApi).toHaveBeenCalled())
    expect(JSON.parse(String(mockedApi.mock.calls[0][1]?.body)).absenceWeightHundredths).toBe(50)
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
