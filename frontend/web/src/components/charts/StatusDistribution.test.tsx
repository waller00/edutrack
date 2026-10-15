import { render, screen } from '@testing-library/react'
import StatusDistribution, { percentOf } from '@/components/charts/StatusDistribution'

describe('StatusDistribution', () => {
  it('escribe cantidad y porcentaje de cada estado: el color no es la única señal', () => {
    render(
      <StatusDistribution
        label="Distribución de estados"
        items={[
          { key: 'present', label: 'Presente', count: 6, colorClass: 'bg-emerald-600' },
          { key: 'late', label: 'Tarde', count: 3, colorClass: 'bg-amber-500' },
          { key: 'absent', label: 'Ausente', count: 1, colorClass: 'bg-red-600' },
        ]}
      />,
    )
    expect(screen.getByRole('figure', { name: 'Distribución de estados' })).toBeInTheDocument()
    expect(screen.getByText('Presente').closest('div')).toHaveTextContent('Presente660%')
    expect(screen.getByText('Tarde').closest('div')).toHaveTextContent('Tarde330%')
    expect(screen.getByText('Ausente').closest('div')).toHaveTextContent('Ausente110%')
  })

  it('sin datos muestra ceros sin dividir por cero', () => {
    render(
      <StatusDistribution
        label="Salidas"
        items={[{ key: 'exit', label: 'Salida', count: 0, colorClass: 'bg-emerald-600' }]}
      />,
    )
    expect(screen.getByText('Salida').closest('div')).toHaveTextContent('Salida00%')
    expect(percentOf(0, 0)).toBe(0)
  })
})
