import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DateRangePicker from './DateRangePicker'

afterEach(() => vi.useRealTimers())

describe('DateRangePicker', () => {
  it('applies a calendar range across months together, without emitting draft dates', () => {
    const onChange = vi.fn()
    render(<DateRangePicker startDate="2026-10-01" endDate="2026-10-09" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Período/ }))
    fireEvent.click(screen.getByRole('button', { name: '30 de octubre de 2026' }))
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Mes siguiente' }))
    fireEvent.click(screen.getByRole('button', { name: '2 de noviembre de 2026' }))
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ startDate: '2026-10-30', endDate: '2026-11-02' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('validates manually entered ranges and discards them on Escape', () => {
    const onChange = vi.fn()
    render(<DateRangePicker startDate="2026-10-01" endDate="2026-10-09" onChange={onChange} />)
    const trigger = screen.getByRole('button', { name: /Período/ })
    fireEvent.click(trigger)
    fireEvent.change(screen.getByLabelText('Fecha inicio'), { target: { value: '20/10/2026' } })
    expect(screen.getByRole('button', { name: 'Aplicar' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(/igual o posterior/)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onChange).not.toHaveBeenCalled()
    expect(trigger).toHaveFocus()
    fireEvent.click(trigger)
    expect(screen.getByLabelText('Fecha inicio')).toHaveValue('01/10/2026')
  })

  it('uses Uruguay dates for shortcuts even when the UTC day has changed', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-10T01:30:00Z'))
    const onChange = vi.fn()
    render(<DateRangePicker startDate="" endDate="" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Período/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Este mes' }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ startDate: '2026-10-01', endDate: '2026-10-09' })
  })
})
