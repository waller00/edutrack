import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import StatTile from './StatTile'

describe('<StatTile />', () => {
  it('muestra la cifra con de dónde sale', () => {
    render(<StatTile label="Asistencia del año" value="90 %" detail="180 de 200 días con lista, sin falta." />)
    expect(screen.getByText('Asistencia del año')).toBeInTheDocument()
    expect(screen.getByText('90 %')).toBeInTheDocument()
    expect(screen.getByText('180 de 200 días con lista, sin falta.')).toBeInTheDocument()
  })

  it('el tono siempre va con su palabra, no sólo con color', () => {
    const { rerender } = render(<StatTile label="18 faltas o más" value="4" tone="critical" toneText="1 con 25 o más" />)
    expect(screen.getByText('1 con 25 o más')).toBeInTheDocument()
    rerender(<StatTile label="Siguen debiendo" value="2" tone="warning" />)
    expect(screen.getByText('Para mirar')).toBeInTheDocument()
  })

  it('dibuja la tendencia sólo con dos o más valores conocidos', () => {
    const { rerender } = render(<StatTile label="Asistencia del año" value="90 %" trend={[88, null, 91]} />)
    expect(screen.getByRole('img', { name: 'Tendencia de asistencia del año' })).toBeInTheDocument()
    rerender(<StatTile label="Asistencia del año" value="90 %" trend={[null, 91]} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
