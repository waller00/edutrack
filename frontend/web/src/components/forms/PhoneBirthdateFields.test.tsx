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
    const birthdateInput = screen.getByLabelText('Fecha de nacimiento')
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

    expect(screen.getByLabelText('Fecha de nacimiento')).toBeRequired()
  })
})
