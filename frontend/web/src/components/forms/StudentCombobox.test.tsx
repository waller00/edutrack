import { fireEvent, render, screen } from '@testing-library/react'
import StudentCombobox, { studentMatches } from '@/components/forms/StudentCombobox'

const students = [
  { studentId: 's1', firstName: 'Ana', lastName: 'Pérez', documentId: '1.234.567-8' },
  { studentId: 's2', firstName: 'Bruno', lastName: 'Gómez', documentId: '4.444.444-4' },
  { studentId: 's3', firstName: 'Carla', lastName: 'Pereira', documentId: null },
]

describe('studentMatches', () => {
  it('busca sin tildes, sin mayúsculas y en cualquier orden', () => {
    expect(studentMatches(students[0], 'perez')).toBe(true)
    expect(studentMatches(students[0], 'ana per')).toBe(true)
    expect(studentMatches(students[0], 'PÉREZ ANA')).toBe(true)
    expect(studentMatches(students[0], 'bruno')).toBe(false)
  })

  it('encuentra por cédula con o sin puntos', () => {
    expect(studentMatches(students[0], '1234567')).toBe(true)
    expect(studentMatches(students[0], '1.234')).toBe(true)
    expect(studentMatches(students[2], '1234')).toBe(false)
  })
})

describe('StudentCombobox', () => {
  function setup(value: string | null = null, withAll = true) {
    const onChange = vi.fn()
    render(
      <StudentCombobox students={students} value={value} onChange={onChange} allLabel={withAll ? 'Todos los alumnos' : undefined} label="Alumno" />,
    )
    return { onChange, input: screen.getByRole('combobox', { name: 'Alumno' }) }
  }

  it('muestra "Todos los alumnos" como valor y como primera opción', () => {
    const { input } = setup()
    expect(input).toHaveValue('Todos los alumnos')
    fireEvent.focus(input)
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveTextContent('Todos los alumnos')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(options).toHaveLength(4)
  })

  it('filtra al escribir y elige con Enter', () => {
    const { input, onChange } = setup()
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'pere' } })
    const options = screen.getAllByRole('option')
    // Al buscar, "todos" no se ofrece: sólo Pérez y Pereira.
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining('PÉREZ, Ana'),
      expect.stringContaining('PEREIRA, Carla'),
    ])
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('s3')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('elige "todos" con el mouse y devuelve null', () => {
    const { input, onChange } = setup('s2')
    expect(input).toHaveValue('GÓMEZ, Bruno')
    fireEvent.focus(input)
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Todos los alumnos' }))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('avisa cuando nadie coincide', () => {
    const { input } = setup()
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'zzz' } })
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByText(/Ningún alumno coincide/)).toBeInTheDocument()
  })

  it('Escape cierra sin cambiar la selección', () => {
    const { input, onChange } = setup('s1')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'bru' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onChange).not.toHaveBeenCalled()
    expect(input).toHaveValue('PÉREZ, Ana')
  })

  it('sin `allLabel` no ofrece la opción "todos"', () => {
    const { input } = setup('s1', false)
    fireEvent.focus(input)
    expect(screen.getAllByRole('option')).toHaveLength(3)
    // Abre sobre el elegido: las flechas siguen desde ahí.
    expect(input).toHaveAttribute('aria-activedescendant', expect.stringContaining('option-0'))
  })
})
