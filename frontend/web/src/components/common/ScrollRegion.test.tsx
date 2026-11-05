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

  it('una tabla con alto máximo que desborda hacia abajo también se enfoca', () => {
    const restore = mockWidths(400, 400)
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(2000)
    const client = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
    render(
      <ScrollRegion label="Matriz del grupo" className="max-h-[75vh] overflow-auto">
        <table><tbody><tr><td>dato</td></tr></tbody></table>
      </ScrollRegion>,
    )
    expect(screen.getByRole('region', { name: 'Matriz del grupo' })).toHaveAttribute('tabindex', '0')
    scroll.mockRestore()
    client.mockRestore()
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
