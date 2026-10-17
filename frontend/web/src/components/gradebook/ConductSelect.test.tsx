import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ConductSelect, { conductText } from './ConductSelect'

const LEGACY = [{ valueHundredths: 300, label: 'Buena' }]

describe('conducta numérica', () => {
  it('ofrece 1 a 10 aunque reciba las etiquetas antiguas y guarda en centésimos', async () => {
    const onChange = vi.fn()
    render(<ConductSelect value="300" options={LEGACY} onChange={onChange} aria-label="Conducta" />)
    const select = screen.getByRole('combobox', { name: 'Conducta' })
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual([
      '—', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
    ])
    await userEvent.selectOptions(select, '1000')
    expect(onChange).toHaveBeenCalledWith('1000')
    await userEvent.selectOptions(select, '')
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('muestra la nota guardada como número y conserva el estado sin dato', () => {
    expect(conductText(300, LEGACY)).toBe('3')
    expect(conductText(1000, [])).toBe('10')
    expect(conductText(null, LEGACY)).toBe('—')
  })
})
