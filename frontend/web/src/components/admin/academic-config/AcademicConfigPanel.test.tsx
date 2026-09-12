import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AcademicConfigPanel from './AcademicConfigPanel'

const onErrorRef = { current: (_m: string) => {} }

vi.mock('./PeriodsTab', () => ({
  default: ({ onError }: { onError: (m: string) => void }) => {
    onErrorRef.current = onError
    return <p>panel de períodos</p>
  },
}))
vi.mock('./ScalesTab', () => ({ default: () => <p>panel de escalas</p> }))
vi.mock('./ActivityTypesTab', () => ({ default: () => <p>panel de tipos</p> }))

describe('<AcademicConfigPanel />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('arranca en Períodos', () => {
    render(<AcademicConfigPanel />)

    expect(screen.getByText('panel de períodos')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Períodos' })).toHaveAttribute('aria-selected', 'true')
  })

  it('cambia de pestaña y muestra sólo una a la vez', () => {
    render(<AcademicConfigPanel />)

    fireEvent.click(screen.getByRole('tab', { name: 'Escalas' }))

    expect(screen.getByText('panel de escalas')).toBeInTheDocument()
    expect(screen.queryByText('panel de períodos')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Tipos de actividad' }))
    expect(screen.getByText('panel de tipos')).toBeInTheDocument()
  })

  it('muestra el error que reporta la pestaña', () => {
    render(<AcademicConfigPanel />)

    fireEvent.click(screen.getByRole('tab', { name: 'Períodos' }))
    act(() => onErrorRef.current('No se pudieron cargar los períodos'))

    expect(screen.getByRole('alert')).toHaveTextContent('No se pudieron cargar los períodos')
  })

  it('limpia el error al cambiar de pestaña: no es del panel nuevo', () => {
    render(<AcademicConfigPanel />)
    act(() => onErrorRef.current('Falló algo en períodos'))
    expect(screen.getByRole('alert')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Escalas' }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
