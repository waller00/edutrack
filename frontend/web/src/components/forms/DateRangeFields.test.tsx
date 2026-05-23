import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import DateRangeFields from './DateRangeFields'

describe('DateRangeFields', () => {
  it('renders both date inputs and emits changes', () => {
    const onStartDateChange = vi.fn()
    const onEndDateChange = vi.fn()

    const { container } = render(
      <DateRangeFields
        startDate="2025-01-01"
        endDate="2025-01-31"
        onStartDateChange={onStartDateChange}
        onEndDateChange={onEndDateChange}
      />
    )

    const [startInput, endInput] = container.querySelectorAll('input[type="date"]')
    fireEvent.change(startInput, { target: { value: '2025-02-01' } })
    fireEvent.change(endInput, { target: { value: '2025-02-28' } })

    expect(onStartDateChange).toHaveBeenCalledWith('2025-02-01')
    expect(onEndDateChange).toHaveBeenCalledWith('2025-02-28')
  })
})
