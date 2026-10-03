import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import DateRangeFields from './DateRangeFields'

describe('DateRangeFields', () => {
  it('renders both date inputs and emits changes', () => {
    const onStartDateChange = vi.fn()
    const onEndDateChange = vi.fn()

    render(
      <DateRangeFields
        startDate="2025-01-01"
        endDate="2025-01-31"
        onStartDateChange={onStartDateChange}
        onEndDateChange={onEndDateChange}
      />
    )

    const [startInput, endInput] = screen.getAllByPlaceholderText('dd/mm/aaaa')
    expect(startInput).toHaveValue('01/01/2025')
    expect(endInput).toHaveValue('31/01/2025')

    fireEvent.change(startInput, { target: { value: '01022025' } })
    fireEvent.change(endInput, { target: { value: '28022025' } })

    expect(onStartDateChange).toHaveBeenCalledWith('2025-02-01')
    expect(onEndDateChange).toHaveBeenCalledWith('2025-02-28')
  })
})
