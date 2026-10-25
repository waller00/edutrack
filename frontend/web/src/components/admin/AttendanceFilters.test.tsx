import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import AttendanceFilters from './AttendanceFilters'
import type { AdminAttendanceListFilters } from '@/lib/admin/attendance-display'

const empty: AdminAttendanceListFilters = { startDate: '', endDate: '', userId: '', eventId: '', eventType: '', type: '', status: '', role: '' }
const users = [{ id: 'u1', name: 'María Pérez', username: 'mperez', email: 'maria@liceo.edu.uy' }, { id: 'u2', name: 'Juan López', username: 'jlopez', email: 'juan@liceo.edu.uy' }]
const events = [{ id: 'e1', title: 'Matemática', type: 'CLASE' }]

function setup(initial = empty) {
  const changed = vi.fn()
  function Harness() {
    const [filters, setFilters] = useState(initial)
    return <AttendanceFilters users={users} events={events} filters={filters} onChange={next => { changed(next); setFilters(next) }} />
  }
  render(<Harness />)
  return changed
}

describe('AttendanceFilters', () => {
  it('busca sin tildes por nombre, usuario y correo sin aplicar un filtro hasta elegir una opción', () => {
    const changed = setup()
    const person = screen.getByRole('combobox', { name: 'Persona' })
    fireEvent.focus(person)
    fireEvent.change(person, { target: { value: 'maria perez' } })
    expect(screen.getByRole('option', { name: 'María Pérez @mperez' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Juan López @jlopez' })).not.toBeInTheDocument()
    fireEvent.change(person, { target: { value: 'maria@liceo.edu.uy' } })
    expect(screen.getByRole('option', { name: 'María Pérez @mperez' })).toBeInTheDocument()
    expect(changed).not.toHaveBeenCalled()
    fireEvent.keyDown(person, { key: 'ArrowDown' })
    fireEvent.keyDown(person, { key: 'Enter' })
    expect(changed).toHaveBeenLastCalledWith({ ...empty, userId: 'u1' })
    expect(person).toHaveValue('María Pérez')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    fireEvent.focus(person)
    fireEvent.change(person, { target: { value: 'jlopez' } })
    fireEvent.keyDown(person, { key: 'Escape' })
    expect(person).toHaveValue('María Pérez')
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('quita los filtros dependientes al quitar la persona o el tipo de registro', () => {
    const changed = setup({ ...empty, userId: 'u1', eventId: 'e1', type: 'CHECK_IN', status: 'LATE' })
    fireEvent.click(screen.getByRole('button', { name: 'Quitar filtro: María Pérez' }))
    expect(changed).toHaveBeenLastCalledWith({ ...empty, type: 'CHECK_IN', status: 'LATE' })
    expect(screen.queryByRole('button', { name: 'Quitar filtro: Matemática' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Quitar filtro: Entradas' }))
    expect(changed).toHaveBeenLastCalledWith(empty)
    expect(screen.getByRole('combobox', { name: 'Estado' })).toBeDisabled()
    expect(screen.queryByLabelText('Filtros activos')).not.toBeInTheDocument()
  })

  it('mantiene visibles los filtros avanzados activos y permite restablecer todo', () => {
    const changed = setup({ ...empty, startDate: '2026-10-01', endDate: '2026-10-25', role: 'TEACHER', eventType: 'CLASE' })
    expect(screen.getByRole('button', { name: 'Quitar filtro: Docente' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Quitar filtro: Clase' })).toBeInTheDocument()
    expect(screen.getByText('2 activos')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
    expect(changed).toHaveBeenLastCalledWith(empty)
  })
})
