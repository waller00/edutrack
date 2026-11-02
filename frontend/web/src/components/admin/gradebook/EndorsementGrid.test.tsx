import type { ComponentProps } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import EndorsementGrid, { endorsementGridPath } from './EndorsementGrid'

type Props = ComponentProps<typeof EndorsementGrid>

function row(id: string, over: Record<string, unknown> = {}) {
  return {
    gradeBookPeriodId: id,
    gradeBookId: `gb-${id}`,
    periodStatus: 'CLOSED',
    period: { id: 'p-1', name: '1.ª Entrega' },
    subject: { name: `Materia ${id}` },
    teacher: { name: 'Ana G' },
    courseName: '5.º',
    orientationName: 'Científico',
    closedLate: false,
    sections: [],
    overallStatus: 'PENDING',
    pendingAgeDays: 3,
    blockingSections: [],
    canFinalize: true,
    reclosedAfterObservation: false,
    ...over,
  }
}

const ROWS = [
  row('lista'),
  row('observada', { canFinalize: false, blockingSections: ['GRADES', 'JUDGEMENTS'] }),
  row('corregida', { canFinalize: false, blockingSections: ['GRADES'], reclosedAfterObservation: true }),
  row('visada', { overallStatus: 'ENDORSED', pendingAgeDays: null }),
]

function renderGrid(over: Partial<Props> = {}) {
  const props: Props = {
    rows: ROWS as unknown as Props['rows'],
    loading: false,
    error: null,
    group: null,
    allMeetings: false,
    onAllMeetingsChange: vi.fn(),
    pendingOnly: true,
    onPendingOnlyChange: vi.fn(),
    ...over,
  }
  render(<EndorsementGrid {...props} />)
  return props
}

const rowOf = (subject: string) => screen.getByText(subject).closest('tr') as HTMLElement

describe('<EndorsementGrid />', () => {
  it('dice en palabras en qué está cada libreta', () => {
    renderGrid()
    expect(within(rowOf('Materia lista')).getByText('Para revisar')).toBeInTheDocument()
    expect(within(rowOf('Materia observada')).getByText('Observada: espera al docente')).toBeInTheDocument()
    expect(within(rowOf('Materia observada')).getByText('Observado: Notas de las evaluaciones, Juicios')).toBeInTheDocument()
    expect(within(rowOf('Materia corregida')).getByText('Volvió a cerrarse: revisá la corrección')).toBeInTheDocument()
    expect(within(rowOf('Materia visada')).getByText('Visada')).toBeInTheDocument()
  })

  it('desde la bandeja no se visa: cada libreta se abre para revisarla en su reunión', () => {
    renderGrid()
    expect(screen.queryByRole('button', { name: /Visar/ })).toBeNull()
    expect(screen.getByRole('link', { name: 'Revisar Materia lista (1.ª Entrega)' })).toHaveAttribute(
      'href',
      '/libreta/gb-lista/visado?reunion=p-1',
    )
    // Lo visado se puede seguir mirando.
    expect(screen.getByRole('link', { name: 'Ver Materia visada (1.ª Entrega)' })).toBeInTheDocument()
  })

  it('la revisión lleva el grupo filtrado', () => {
    renderGrid({ group: { courseOfferingId: 'off-5', courseOrientationId: 'co-1' } })
    expect(screen.getByRole('link', { name: 'Revisar Materia lista (1.ª Entrega)' })).toHaveAttribute(
      'href',
      '/libreta/gb-lista/visado?reunion=p-1&courseOfferingId=off-5&courseOrientationId=co-1',
    )
  })

  it('los filtros propios del visado los maneja la pantalla', () => {
    const props = renderGrid()

    fireEvent.click(screen.getByLabelText('Sólo pendientes de visar'))
    fireEvent.click(screen.getByLabelText('Todas las reuniones'))

    expect(props.onPendingOnlyChange).toHaveBeenCalledWith(false)
    expect(props.onAllMeetingsChange).toHaveBeenCalledWith(true)
  })

  it('muestra el error de carga', () => {
    renderGrid({ rows: [], error: 'Sin permiso' })
    expect(screen.getByRole('alert')).toHaveTextContent('Sin permiso')
    expect(screen.queryByText(/No hay libretas/)).toBeNull()
  })

  it('sin libretas cerradas lo explica', () => {
    renderGrid({ rows: [] })
    expect(screen.getByText(/No hay libretas con períodos cerrados/)).toBeInTheDocument()
  })
})

describe('auxiliares de la grilla', () => {
  it('arma la consulta sólo con los filtros elegidos', () => {
    expect(endorsementGridPath({ periodId: '', group: null, pendingOnly: false })).toBe('/admin/gradebook/endorsements')
    expect(
      endorsementGridPath({ periodId: '', group: { courseOfferingId: 'off-1', courseOrientationId: null }, pendingOnly: true }),
    ).toBe('/admin/gradebook/endorsements?pending=true&courseOfferingId=off-1')
    expect(
      endorsementGridPath({ periodId: 'p-1', group: { courseOfferingId: 'off-1', courseOrientationId: 'co-1' }, pendingOnly: true }),
    ).toBe('/admin/gradebook/endorsements?pending=true&periodId=p-1&courseOfferingId=off-1&courseOrientationId=co-1')
  })
})
