import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import PhoneBirthdateFields from './PhoneBirthdateFields'

describe('PhoneBirthdateFields', () => {
  it('renders current values and notifies changes', () => {
    const onPhoneChange = vi.fn()
    const onBirthdateChange = vi.fn()

    render(
      <PhoneBirthdateFields
        phoneLocal="094481122"
        birthdate="2000-01-02"
        onPhoneChange={onPhoneChange}
        onBirthdateChange={onBirthdateChange}
      />
    )

    fireEvent.change(screen.getByPlaceholderText('094481122'), { target: { value: '099123456' } })
    const birthdateInput = screen.getByLabelText(/Fecha de nacimiento/)
    expect(birthdateInput).toHaveValue('02/01/2000')
    fireEvent.change(birthdateInput, { target: { value: '20051999' } })

    expect(screen.getByText('+598')).toBeInTheDocument()
    expect(onPhoneChange).toHaveBeenCalledWith('099123456')
    expect(onBirthdateChange).toHaveBeenCalledWith('1999-05-20')
    expect(birthdateInput).not.toBeRequired()
  })

  it('marks birthdate as required when requested', () => {
    render(
      <PhoneBirthdateFields
        phoneLocal=""
        birthdate=""
        onPhoneChange={vi.fn()}
        onBirthdateChange={vi.fn()}
        birthdateRequired
      />
    )

    expect(screen.getByLabelText(/Fecha de nacimiento/)).toBeRequired()
    // La obligatoriedad no queda solo en el asterisco (aria-hidden): también en el nombre accesible.
    expect(screen.getByLabelText(/Fecha de nacimiento.*obligatorio/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Celular.*opcional/i)).toBeInTheDocument()
  })

  it('muestra los errores de validación al lado de cada campo', () => {
    render(
      <PhoneBirthdateFields
        phoneLocal="123"
        birthdate=""
        onPhoneChange={vi.fn()}
        onBirthdateChange={vi.fn()}
        birthdateRequired
        phoneError="Celular inválido: 9 dígitos empezando con 09"
        birthdateError="Fecha de nacimiento obligatoria"
      />
    )

    const alerts = screen.getAllByRole('alert').map((el) => el.textContent)
    expect(alerts.join(' ')).toMatch(/Celular inválido/)
    expect(alerts.join(' ')).toMatch(/Fecha de nacimiento obligatoria/)
    expect(screen.getByLabelText(/Celular/i)).toHaveAttribute('aria-invalid', 'true')
  })

  it('avisa cuando el usuario sale del campo', () => {
    const onPhoneBlur = vi.fn()
    const onBirthdateBlur = vi.fn()
    render(
      <PhoneBirthdateFields
        phoneLocal=""
        birthdate=""
        onPhoneChange={vi.fn()}
        onBirthdateChange={vi.fn()}
        onPhoneBlur={onPhoneBlur}
        onBirthdateBlur={onBirthdateBlur}
      />
    )

    fireEvent.blur(screen.getByPlaceholderText('094481122'))
    fireEvent.blur(screen.getByLabelText(/Fecha de nacimiento/))

    expect(onPhoneBlur).toHaveBeenCalled()
    expect(onBirthdateBlur).toHaveBeenCalled()
  })
})
