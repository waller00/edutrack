import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import MeetingStepper from './MeetingStepper'

describe('<MeetingStepper />', () => {
  it('marca la etapa actual y dice qué sigue', () => {
    render(<MeetingStepper stage="REVIEW" hint="Cerrada el 01/10/2026: la revisa Dirección." />)
    const steps = within(screen.getByRole('list', { name: 'Etapas de la reunión' })).getAllByRole('listitem')
    expect(steps.map((step) => step.textContent)).toEqual([
      '✓Cargar (hecha)',
      '→✓Cerrar (hecha)',
      '→●Revisión',
      '→○Visada (pendiente)',
    ])
    expect(steps[2]).toHaveAttribute('aria-current', 'step')
    expect(screen.getByText('Cerrada el 01/10/2026: la revisa Dirección.')).toBeInTheDocument()
  })

  it('visada: la última etapa queda hecha, con su símbolo', () => {
    render(<MeetingStepper stage="ENDORSED" hint="Visada el 20/07/2026" />)
    const last = within(screen.getByRole('list', { name: 'Etapas de la reunión' })).getAllByRole('listitem').at(-1)!
    expect(last).toHaveAttribute('aria-current', 'step')
    expect(last).toHaveTextContent('✓Visada')
  })
})
