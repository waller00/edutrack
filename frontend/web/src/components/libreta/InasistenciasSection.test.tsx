import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import InasistenciasSection from './InasistenciasSection'
import type { GradeBookDetail, RosterStudent } from '@/lib/gradebook/types'

const detail = vi.fn<() => Partial<GradeBookDetail> | null>()
vi.mock('@/contexts/LibretaContext', () => ({ useLibreta: () => ({ detail: detail() }) }))

function student(over: Partial<RosterStudent> = {}): RosterStudent {
  return {
    studentId: 's1',
    studentEnrollmentId: 'e1',
    firstName: 'Ana',
    lastName: 'Benítez',
    documentId: null,
    ...over,
  }
}

function rowNames() {
  const rows = screen.getAllByRole('row').slice(1) // sin el encabezado
  return rows.map((row) => within(row).getAllByRole('cell')[1].textContent)
}

describe('<InasistenciasSection />', () => {
  it('no renderiza nada mientras la libreta no cargó', () => {
    detail.mockReturnValue(null)
    const { container } = render(<InasistenciasSection />)
    expect(container).toBeEmptyDOMElement()
  })

  it('ordena por quien más faltó y desempata por apellido', () => {
    detail.mockReturnValue({
      students: [
        student({ studentId: 's1', lastName: 'Zeballos', firstName: 'Ana', absences: 2 }),
        student({ studentId: 's2', lastName: 'Álvarez', firstName: 'Beto', absences: 9 }),
        student({ studentId: 's3', lastName: 'Benítez', firstName: 'Caro', absences: 2 }),
      ],
    })

    render(<InasistenciasSection />)

    expect(rowNames()).toEqual(['Álvarez, Beto', 'Benítez, Caro', 'Zeballos, Ana'])
  })

  it('totaliza faltas y llegadas tarde del grupo', () => {
    detail.mockReturnValue({
      students: [
        student({ studentId: 's1', absences: 3, lates: 1 }),
        student({ studentId: 's2', absences: 4, lates: 2 }),
      ],
    })

    render(<InasistenciasSection />)

    expect(screen.getByText('7 faltas · 3 llegadas tarde')).toBeInTheDocument()
  })

  it('singulariza el total cuando hay una sola falta', () => {
    detail.mockReturnValue({ students: [student({ absences: 1, lates: 1 })] })

    render(<InasistenciasSection />)

    expect(screen.getByText('1 falta · 1 llegada tarde')).toBeInTheDocument()
  })

  it('cuenta como cero al estudiante sin datos de asistencia', () => {
    detail.mockReturnValue({ students: [student()] })

    render(<InasistenciasSection />)

    expect(screen.getByText('0 faltas · 0 llegadas tarde')).toBeInTheDocument()
  })

  it('deriva la carga al pase de lista en vez de duplicarla', () => {
    // La sección es de lectura: si además se pudiera marcar acá, habría dos lugares para lo mismo.
    detail.mockReturnValue({ students: [student()] })

    render(<InasistenciasSection />)

    expect(screen.getByText(/Las faltas se registran pasando lista/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Ir al pase de lista/ })).toHaveAttribute('href', '/me/roll-call')
  })

  it('avisa cuando el grupo no tiene estudiantes', () => {
    detail.mockReturnValue({ students: [] })

    render(<InasistenciasSection />)

    expect(screen.getByText('El grupo no tiene estudiantes matriculados.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
