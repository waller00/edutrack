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
  fireEvent.change(screen.getByLabelText('Mes de mensualidad'), { target: { value: '4' } })
  expect(screen.getByRole('heading', { name: 'Abril 2026' })).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: 'Sin registrar' })).toBeChecked()
  expect(api).not.toHaveBeenCalled()
})

it('registra un pago explícito, conserva notas y convierte la coma decimal en centavos', async () => {
  vi.mocked(api).mockResolvedValue({ month: { ...student.tuitionMonths[0], paid: true, amountCents: 350050, paidAt: '2026-03-12T12:00:00Z' } })
  setup(true)
  fireEvent.change(screen.getByLabelText(/Importe \(UYU\)/), { target: { value: '3500,50' } })
  fireEvent.change(screen.getByLabelText('Fecha de pago'), { target: { value: '12/03/2026' } })
  fireEvent.click(screen.getByRole('button', { name: 'Registrar pago' }))
  await waitFor(() => expect(api).toHaveBeenCalledWith('/admin/tuition/s1/2026/3', {
    method: 'PUT', body: JSON.stringify({ status: 'paid', amountCents: 350050, paidAt: '2026-03-12', notes: 'Beca parcial' }),
  }))
  expect(await screen.findByRole('status')).toHaveTextContent('Marzo guardado correctamente')
  expect(screen.getByRole('option', { name: 'Marzo · Pagado' })).toBeInTheDocument()
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
  fireEvent.change(screen.getByLabelText('Mes de mensualidad'), { target: { value: '4' } })
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


it('deja el formulario a mano y pliega notas y vista anual', () => {
  setup(true)
  expect(screen.getByLabelText(/Importe \(UYU\)/)).toBeVisible()
  expect(screen.getByLabelText('Fecha de pago')).toBeVisible()
  expect(screen.getByLabelText('Notas del pago')).not.toBeVisible()
  expect(screen.getByRole('button', { name: 'Abril: Sin registrar' })).not.toBeVisible()
  expect(screen.getByLabelText('Fecha de pago')).toHaveValue(todayDate())
})
function todayDate() {
  const d = new Date()
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

it('permite navegar desde la vista anual sin guardar ni cambiar cuotas', () => {
  setup()
  fireEvent.click(screen.getByText('Ver año completo'))
  fireEvent.click(screen.getByRole('button', { name: 'Abril: Sin registrar' }))
  expect(screen.getByLabelText('Mes de mensualidad')).toHaveValue('4')
  expect(screen.getByRole('radio', { name: 'Sin registrar' })).toBeChecked()
  expect(api).not.toHaveBeenCalled()
})

it('al descartar cambios cambia al mes pedido, manteniendo el año', () => {
  setup()
  fireEvent.change(screen.getByLabelText(/Importe \(UYU\)/), { target: { value: '4000' } })
  fireEvent.change(screen.getByLabelText('Mes de mensualidad'), { target: { value: '4' } })
  expect(screen.getByLabelText('Mes de mensualidad')).toHaveValue('3')
  fireEvent.click(screen.getByRole('button', { name: 'Descartar cambios' }))
  expect(screen.getByRole('heading', { name: 'Abril 2026' })).toBeInTheDocument()
  expect(api).not.toHaveBeenCalled()
})

it('permite registrar sin importe y no lo convierte en cero', async () => {
  vi.mocked(api).mockResolvedValue({ month: { ...student.tuitionMonths[0], paid: true, amountCents: null, paidAt: '2026-03-12' } })
  setup(true)
  fireEvent.change(screen.getByLabelText(/Importe \(UYU\)/), { target: { value: '' } })
  fireEvent.change(screen.getByLabelText('Fecha de pago'), { target: { value: '12/03/2026' } })
  fireEvent.click(screen.getByRole('button', { name: 'Registrar pago' }))
  await waitFor(() => expect(api).toHaveBeenCalledWith('/admin/tuition/s1/2026/3', {
    method: 'PUT', body: JSON.stringify({ status: 'paid', amountCents: null, paidAt: '2026-03-12', notes: 'Beca parcial' }),
  }))
})

it('distingue quitar el registro de marcarlo pendiente', async () => {
  vi.mocked(api).mockResolvedValue({ month: null })
  setup()
  fireEvent.click(screen.getByRole('radio', { name: 'Sin registrar' }))
  expect(screen.getByText(/se quitarán el estado/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
  await waitFor(() => expect(api).toHaveBeenCalledWith('/admin/tuition/s1/2026/3', {
    method: 'PUT', body: JSON.stringify({ status: 'none', amountCents: null, paidAt: null, notes: null }),
  }))
  expect(screen.getByRole('option', { name: 'Marzo · Sin registrar' })).toBeInTheDocument()
})

it('mantiene las notas desplegadas al escribir y las envía recortadas', async () => {
  vi.mocked(api).mockResolvedValue({ month: { ...student.tuitionMonths[0], notes: 'Transferencia' } })
  setup()
  fireEvent.click(screen.getByText(/Notas \(opcional\)/))
  fireEvent.change(screen.getByLabelText('Notas del pago'), { target: { value: ' Transferencia ' } })
  expect(screen.getByLabelText('Notas del pago')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
  await waitFor(() => expect(api).toHaveBeenCalledWith('/admin/tuition/s1/2026/3', {
    method: 'PUT', body: JSON.stringify({ status: 'pending', amountCents: 350000, paidAt: null, notes: 'Transferencia' }),
  }))
})
