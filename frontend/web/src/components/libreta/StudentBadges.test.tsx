import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import StudentBadges, { focusForBadge } from './StudentBadges'

describe('focusForBadge', () => {
  it('mapea cada sigla a la sección de la hoja', () => {
    expect(focusForBadge('ADEC')).toBe('accommodations')
    expect(focusForBadge('Gen')).toBe('general')
    expect(focusForBadge('PEND')).toBe('pending')
    expect(focusForBadge('EXEN')).toBe('exemptions')
  })
})

describe('<StudentBadges />', () => {
  it('no renderiza nada sin códigos', () => {
    const { container } = render(<StudentBadges codes={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('muestra la sigla con título explicativo (RNF 7.2)', () => {
    render(<StudentBadges codes={['ADEC', 'GEN']} />)
    const adec = screen.getByTitle(/Adecuación curricular/)
    expect(adec).toHaveTextContent('ADEC')
    expect(screen.getByTitle(/Observaciones generales/)).toHaveTextContent('Gen')
  })

  it('si hay onSelect, el chip es botón y dispara el foco', () => {
    const onSelect = vi.fn()
    render(<StudentBadges codes={['ADEC']} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: /Adecuación curricular/ }))
    expect(onSelect).toHaveBeenCalledWith('ADEC', 'accommodations')
  })
})
