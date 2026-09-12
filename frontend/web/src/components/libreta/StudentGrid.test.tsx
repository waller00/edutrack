import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import StudentGrid, { initialsOf } from './StudentGrid'
import type { RosterStudent } from '@/lib/gradebook/types'

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
  })

  it('no rompe con nombre o apellido vacío', () => {
    expect(initialsOf({ firstName: '', lastName: 'Benítez' })).toBe('B')
    expect(initialsOf({ firstName: '', lastName: '' })).toBe('')
  })
})

describe('<StudentGrid />', () => {
  it('explica el caso sin estudiantes en vez de mostrar una grilla vacía', () => {
    render(<StudentGrid students={[]} />)
    expect(screen.getByText(/no tiene estudiantes matriculados/i)).toBeInTheDocument()
  })

  it('numera y nombra a cada estudiante', () => {
    render(<StudentGrid students={[student(), student({ studentId: 's2', firstName: 'Carlos', lastName: 'Díaz' })]} />)

    expect(screen.getByText('Benítez, Ana')).toBeInTheDocument()
    expect(screen.getByText('Díaz, Carlos')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('escribe siempre el número de faltas, no sólo el color', () => {
    // RNF 7.2: el color es refuerzo; el conteo tiene que poder leerse.
    render(<StudentGrid students={[student({ absences: '12', absenceHundredths: 1200, lates: 3 })]} />)

    expect(screen.getByText(/12 faltas/)).toBeInTheDocument()
    expect(screen.getByText(/3 tardes/)).toBeInTheDocument()
  })

  it('trata las faltas ausentes como cero y singulariza en una falta entera', () => {
    render(<StudentGrid students={[student()]} />)
    expect(screen.getByText(/0 faltas/)).toBeInTheDocument()
    expect(screen.getByText(/0 tardes/)).toBeInTheDocument()

    render(
      <StudentGrid students={[student({ studentId: 's9', absences: '1', absenceHundredths: 100, lates: 1 })]} />,
    )
    expect(screen.getByText(/1 falta$/)).toBeInTheDocument()
    expect(screen.getByText(/1 tarde$/)).toBeInTheDocument()
  })

  it('media falta se escribe con coma y en plural', () => {
    render(<StudentGrid students={[student({ absences: '0,5', absenceHundredths: 50 })]} />)
    expect(screen.getByText(/0,5 faltas/)).toBeInTheDocument()
  })

  it('omite la cédula cuando el estudiante no la tiene cargada', () => {
    const { container } = render(<StudentGrid students={[student({ documentId: null })]} />)
    expect(container.querySelector('.font-mono')).toBeNull()
  })
})
