import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import PhoneBirthdateFields from './PhoneBirthdateFields'

describe('PhoneBirthdateFields', () => {
  it('renders current values and notifies changes', () => {
    const onPhoneChange = vi.fn()
    const onBirthdateChange = vi.fn()

    const { container } = render(
      <PhoneBirthdateFields
        phoneLocal="094481122"
        birthdate="2000-01-02"
        onPhoneChange={onPhoneChange}
        onBirthdateChange={onBirthdateChange}
      />
    )

    fireEvent.change(screen.getByPlaceholderText('094481122'), { target: { value: '099123456' } })
    fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: '1999-05-20' } })

    expect(screen.getByText('+598')).toBeInTheDocument()
    expect(onPhoneChange).toHaveBeenCalledWith('099123456')
    expect(onBirthdateChange).toHaveBeenCalledWith('1999-05-20')
    expect(container.querySelector('input[type="date"]')).not.toBeRequired()
  })

  it('marks birthdate as required when requested', () => {
    const { container } = render(
      <PhoneBirthdateFields
        phoneLocal=""
        birthdate=""
        onPhoneChange={vi.fn()}
        onBirthdateChange={vi.fn()}
        birthdateRequired
      />
    )

    expect(container.querySelector('input[type="date"]')).toBeRequired()
  })
})
