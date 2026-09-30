import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import RegisterReview from '@/components/auth/RegisterReview'

const DATA = {
  firstName: 'Juan',
  lastName: 'Pérez',
  nationalId: '1.234.567-2',
  birthdate: '1990-01-15',
  email: 'juan@example.com',
  phone: '+598 094481122',
  roleLabel: 'Docente',
}

function renderReview(overrides = {}) {
  const onBack = vi.fn()
  const onCancel = vi.fn()
  const onConfirm = vi.fn()
  render(
    <RegisterReview
      data={DATA}
      canConfirm
      submitting={false}
      onBack={onBack}
      onCancel={onCancel}
      onConfirm={onConfirm}
      {...overrides}
    />,
  )
  return { onBack, onCancel, onConfirm }
}

describe('RegisterReview', () => {
  it('muestra el resumen de lo que completó el usuario', () => {
    renderReview()
    expect(screen.getByText('Juan')).toBeInTheDocument()
    expect(screen.getByText('1.234.567-2')).toBeInTheDocument()
    expect(screen.getByText('15/01/1990')).toBeInTheDocument()
    expect(screen.getByText('juan@example.com')).toBeInTheDocument()
    expect(screen.getByText('Docente')).toBeInTheDocument()
  })

  it('avisa que la cuenta queda pendiente de aprobación', () => {
    renderReview()
    expect(screen.getByText(/queda pendiente hasta que administración/i)).toBeInTheDocument()
  })

  it('no ofrece verificar la identidad: no hay prueba de vida', () => {
    renderReview()
    expect(screen.queryByRole('button', { name: /verificar/i })).not.toBeInTheDocument()
  })

  it('termina el registro', () => {
    const { onConfirm } = renderReview()
    fireEvent.click(screen.getByRole('button', { name: /terminar registro/i }))
    expect(onConfirm).toHaveBeenCalled()
  })

  it('no deja terminar si los datos no son válidos', () => {
    renderReview({ canConfirm: false })
    expect(screen.getByRole('button', { name: /terminar registro/i })).toBeDisabled()
  })

  it('permite volver a corregir y cancelar', () => {
    const { onBack, onCancel } = renderReview()
    fireEvent.click(screen.getByRole('button', { name: /volver y corregir/i }))
    fireEvent.click(screen.getByRole('button', { name: /cancelar registro/i }))
    expect(onBack).toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalled()
  })
})
