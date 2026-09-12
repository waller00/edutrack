import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { api } from '@/lib/api/client'
import TuitionStudentPanel from './TuitionStudentPanel'
import type { TuitionStudent } from '@/lib/admin/tuition'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const student: TuitionStudent = {
  id: 's1', firstName: 'Ana', lastName: 'Díaz', documentId: '51234561', course: { id: 'c1', name: 'Primero' },
  tuitionMonths: [{ year: 2026, month: 3, paid: false, amountCents: 350000, paidAt: null, notes: 'Beca parcial' }],
}
const onSaved = vi.fn(), onClose = vi.fn()
beforeEach(() => { vi.resetAllMocks() })
function setup(registerPayment = false) {
  render(<TuitionStudentPanel student={student} year={2026} initialMonth={3} registerPayment={registerPayment} onSaved={onSaved} onClose={onClose} />)
}

it('elegir un mes sólo abre sus datos y no cambia el estado ni guarda', () => {
  setup()
  fireEvent.click(screen.getByRole('button', { name: 'Abril: Sin registrar' }))
  expect(screen.getByRole('heading', { name: 'Abril 2026' })).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: 'Sin registrar' })).toBeChecked()
  expect(api).not.toHaveBeenCalled()
})

it('registra un pago explícito, conserva notas y convierte la coma decimal en centavos', async () => {
  vi.mocked(api).mockResolvedValue({ month: { ...student.tuitionMonths[0], paid: true, amountCents: 350050, paidAt: '2026-03-12T12:00:00Z' } })
  setup(true)
  fireEvent.change(screen.getByLabelText(/Importe \(UYU\)/), { target: { value: '3500,50' } })
  fireEvent.change(screen.getByLabelText('Fecha de pago'), { target: { value: '2026-03-12' } })
  fireEvent.click(screen.getByRole('button', { name: 'Registrar pago' }))
  await waitFor(() => expect(api).toHaveBeenCalledWith('/admin/tuition/s1/2026/3', {
    method: 'PUT', body: JSON.stringify({ status: 'paid', amountCents: 350050, paidAt: '2026-03-12', notes: 'Beca parcial' }),
  }))
  expect(await screen.findByRole('status')).toHaveTextContent('Marzo guardado correctamente')
  expect(screen.getByRole('button', { name: 'Marzo: Pagado' })).toBeInTheDocument()
  expect(onSaved).toHaveBeenCalledOnce()
})

it('conserva el formulario si falla el guardado y permite reintentar', async () => {
  vi.mocked(api).mockRejectedValue(new Error('Sin conexión'))
  setup(true)
  fireEvent.click(screen.getByRole('button', { name: 'Registrar pago' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Sin conexión')
  expect(screen.getByLabelText(/Importe \(UYU\)/)).toHaveValue('3500')
  expect(screen.getByRole('button', { name: 'Registrar pago' })).toBeEnabled()
  expect(onSaved).not.toHaveBeenCalled()
})

it('evita perder cambios al cambiar de mes o cerrar', () => {
  setup()
  fireEvent.change(screen.getByLabelText(/Importe \(UYU\)/), { target: { value: '4000' } })
  fireEvent.click(screen.getByRole('button', { name: 'Abril: Sin registrar' }))
  expect(screen.getByRole('alert')).toHaveTextContent('cambios sin guardar')
  expect(screen.getByRole('heading', { name: 'Marzo 2026' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Seguir editando' }))
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(onClose).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Descartar cambios' }))
  expect(onClose).toHaveBeenCalledOnce()
})

it('rechaza importes con más de dos decimales antes de enviar', async () => {
  setup(true)
  fireEvent.change(screen.getByLabelText(/Importe \(UYU\)/), { target: { value: '3500,123' } })
  fireEvent.click(screen.getByRole('button', { name: 'Registrar pago' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('hasta dos decimales')
  expect(api).not.toHaveBeenCalled()
})
