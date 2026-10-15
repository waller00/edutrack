import { render, screen } from '@testing-library/react'
import ScrollRegion from '@/components/common/ScrollRegion'

function mockWidths(scrollWidth: number, clientWidth: number) {
  const scroll = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(scrollWidth)
  const client = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(clientWidth)
  return () => {
    scroll.mockRestore()
    client.mockRestore()
  }
}

describe('ScrollRegion', () => {
  it('si la tabla desborda, el teclado puede enfocarla y desplazarla', () => {
    const restore = mockWidths(900, 400)
    render(
      <ScrollRegion label="Tabla de asistencias" className="overflow-x-auto">
        <table><tbody><tr><td>dato</td></tr></tbody></table>
      </ScrollRegion>,
    )
    const region = screen.getByRole('region', { name: 'Tabla de asistencias' })
    expect(region).toHaveAttribute('tabindex', '0')
    restore()
  })

  it('si entra entera no agrega una parada de Tab', () => {
    const restore = mockWidths(400, 400)
    const { container } = render(
      <ScrollRegion label="Tabla de asistencias" className="overflow-x-auto">
        <p>corto</p>
      </ScrollRegion>,
    )
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    expect(container.firstElementChild).not.toHaveAttribute('tabindex')
    restore()
  })
})
