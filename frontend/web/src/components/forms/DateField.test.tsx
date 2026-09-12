import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import DateField from './DateField'

describe('DateField', () => {
  it('shows dd/mm/yyyy and emits yyyy-mm-dd while typing', () => {
    const onChange = vi.fn()

    render(<DateField aria-label="Fecha" value="2026-06-24" onChange={onChange} />)

    const input = screen.getByLabelText('Fecha')
    expect(input).toHaveValue('24/06/2026')

    fireEvent.change(input, { target: { value: '05072026' } })

    expect(input).toHaveValue('05/07/2026')
    expect(onChange).toHaveBeenLastCalledWith('2026-07-05')
  })

  it('emits empty value for incomplete or impossible dates', () => {
    const onChange = vi.fn()

    render(<DateField aria-label="Fecha" value="" onChange={onChange} />)

    const input = screen.getByLabelText('Fecha')
    fireEvent.change(input, { target: { value: '31/02/2026' } })

    expect(input).toHaveValue('31/02/2026')
    expect(onChange).toHaveBeenLastCalledWith('')
  })

  it('keeps the native calendar trigger wired to yyyy-mm-dd', () => {
    const onChange = vi.fn()

    const { container } = render(<DateField aria-label="Fecha" value="2026-06-24" min="2026-01-01" max="2026-12-31" onChange={onChange} />)

    const calendarInput = container.querySelector('input[type="date"]')
    expect(calendarInput).toHaveValue('2026-06-24')
    expect(calendarInput).toHaveAttribute('min', '2026-01-01')
    expect(calendarInput).toHaveAttribute('max', '2026-12-31')

    fireEvent.change(calendarInput!, { target: { value: '2026-07-05' } })

    expect(onChange).toHaveBeenLastCalledWith('2026-07-05')
  })
})
