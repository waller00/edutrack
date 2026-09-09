import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import StudentGrid, { initialsOf } from './StudentGrid'
import type { RosterStudent } from '@/lib/gradebook/types'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

vi.mock('@/lib/api/binary', () => ({
  apiBlob: vi.fn().mockResolvedValue(null),
}))

function student(over: Partial<RosterStudent> = {}): RosterStudent {
  return {
    studentId: 's1',
    studentEnrollmentId: 'e1',
    firstName: 'Ana',
    lastName: 'Benítez',
    documentId: '5.123.456-7',
    ...over,
  }
}

describe('initialsOf', () => {
  it('toma la inicial del apellido y la del nombre', () => {
    expect(initialsOf({ firstName: 'Ana', lastName: 'Benítez' })).toBe('BA')
    expect(initialsOf({ firstName: '', lastName: 'Benítez' })).toBe('B')
    expect(initialsOf({ firstName: '', lastName: '' })).toBe('')
  })
})

describe('<StudentGrid />', () => {
  it('explica el caso sin estudiantes en vez de mostrar una grilla vacía', () => {
    render(<StudentGrid gradeBookId="gb-1" students={[]} />)
    expect(screen.getByText(/no tiene estudiantes matriculados/i)).toBeInTheDocument()
  })

  it('numera y nombra a cada estudiante con enlace a evaluaciones', () => {
    render(
      <StudentGrid
        gradeBookId="gb-1"
        students={[student(), student({ studentId: 's2', firstName: 'Carlos', lastName: 'Díaz' })]}
      />,
    )

    const ana = screen.getByRole('link', { name: 'Benítez, Ana' })
    expect(ana).toHaveAttribute('href', '/libreta/gb-1/evaluaciones?alumno=s1')
    expect(screen.getByRole('link', { name: 'Díaz, Carlos' })).toHaveAttribute(
      'href',
      '/libreta/gb-1/evaluaciones?alumno=s2',
    )
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('escribe siempre el número de faltas, no sólo el color', () => {
    // RNF 7.2: el color es refuerzo; el conteo tiene que poder leerse.
    render(<StudentGrid gradeBookId="gb-1" students={[student({ absences: 12, lates: 3 })]} />)

    expect(screen.getByText(/12 faltas/)).toBeInTheDocument()
    expect(screen.getByText(/3 tardes/)).toBeInTheDocument()
  })

  it('trata las faltas ausentes como cero y singulariza en uno', () => {
    render(<StudentGrid gradeBookId="gb-1" students={[student()]} />)
    expect(screen.getByText(/0 faltas/)).toBeInTheDocument()
    expect(screen.getByText(/0 tardes/)).toBeInTheDocument()

    render(<StudentGrid gradeBookId="gb-1" students={[student({ studentId: 's9', absences: 1, lates: 1 })]} />)
    expect(screen.getByText(/1 falta$/)).toBeInTheDocument()
    expect(screen.getByText(/1 tarde$/)).toBeInTheDocument()
  })

  it('omite la cédula cuando el estudiante no la tiene cargada', () => {
    const { container } = render(<StudentGrid gradeBookId="gb-1" students={[student({ documentId: null })]} />)
    expect(container.querySelector('.font-mono')).toBeNull()
  })
})
