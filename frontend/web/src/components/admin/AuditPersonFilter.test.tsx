import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AuditPersonFilter from './AuditPersonFilter'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)
const ana = { id: 'ana', name: 'Ana García', email: 'ana@example.com' }
const martin = {
  id: 'martin',
  name: 'Martín Rodríguez',
  email: 'martin@example.com',
}

describe('AuditPersonFilter', () => {
  beforeEach(() => {
    mockedApi.mockReset()
    mockedApi.mockResolvedValue({ total: 2, data: [ana, martin] } as never)
  })

  it('carga usuarios al abrir y permite seleccionarlos con el teclado', async () => {
    const onChange = vi.fn()
    render(<AuditPersonFilter value={null} onChange={onChange} />)
    expect(mockedApi).not.toHaveBeenCalled()
    const trigger = screen.getByRole('button', {
      name: 'Persona Todos los usuarios',
    })
    fireEvent.click(trigger)
    await screen.findByRole('option', { name: 'Ana García ana@example.com' })
    const search = screen.getByRole('combobox')
    expect(search).toHaveFocus()
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(ana)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('pagina en el servidor y reinicia la lista al buscar por correo', async () => {
    const onChange = vi.fn()
    mockedApi.mockResolvedValueOnce({ total: 2, data: [ana] } as never)
    mockedApi.mockResolvedValueOnce({ total: 2, data: [martin] } as never)
    mockedApi.mockResolvedValueOnce({ total: 1, data: [martin] } as never)
    render(<AuditPersonFilter value={ana} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Persona Ana García' }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Cargar más usuarios' }),
    )
    await screen.findByRole('option', {
      name: 'Martín Rodríguez martin@example.com',
    })
    expect(
      screen.getByRole('option', { name: 'Ana García ana@example.com' }),
    ).toBeVisible()
    expect(String(mockedApi.mock.calls.at(-1)?.[0])).toContain('page=2')
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'martin@' },
    })
    await screen.findByRole('option', {
      name: 'Martín Rodríguez martin@example.com',
    })
    expect(
      screen.queryByRole('option', { name: 'Ana García ana@example.com' }),
    ).not.toBeInTheDocument()
    expect(String(mockedApi.mock.calls.at(-1)?.[0])).toContain(
      'page=1&pageSize=20&q=martin%40',
    )
    expect(
      screen.getByRole('button', { name: 'Persona Ana García' }),
    ).toBeVisible()
    fireEvent.click(screen.getByRole('option', { name: 'Todos los usuarios' }))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('"Cargar más" conserva el foco mientras carga y no repite personas entre páginas', async () => {
    let finishPage2!: (data: unknown) => void
    mockedApi.mockResolvedValueOnce({ total: 3, data: [ana, martin] } as never)
    mockedApi.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishPage2 = resolve
        }),
    )
    render(<AuditPersonFilter value={null} onChange={vi.fn()} />)
    fireEvent.click(
      screen.getByRole('button', { name: 'Persona Todos los usuarios' }),
    )
    const more = await screen.findByRole('button', {
      name: 'Cargar más usuarios',
    })
    more.focus()
    fireEvent.click(more)
    await waitFor(() => expect(more).toHaveAttribute('aria-disabled', 'true'))
    expect(more).toHaveFocus()
    // Mientras carga, otro click no pide una página más.
    fireEvent.click(more)
    expect(mockedApi).toHaveBeenCalledTimes(2)

    // La página 2 repite a Martín (se creó un usuario entre medio).
    const lucia = { id: 'lucia', name: 'Lucía Pérez', email: 'lucia@example.com' }
    await act(async () => finishPage2({ total: 3, data: [martin, lucia] }))
    expect(
      screen.getAllByRole('option', { name: 'Martín Rodríguez martin@example.com' }),
    ).toHaveLength(1)
    expect(
      screen.getByRole('option', { name: 'Lucía Pérez lucia@example.com' }),
    ).toBeVisible()
  })

  it('ignora respuestas de búsquedas anteriores y no altera la persona seleccionada', async () => {
    let finishFirst!: (data: unknown) => void
    mockedApi.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve
        }),
    )
    mockedApi.mockResolvedValue({ total: 1, data: [martin] } as never)
    const onChange = vi.fn()
    render(<AuditPersonFilter value={ana} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Persona Ana García' }))
    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'martin' },
    })
    await screen.findByRole('option', {
      name: 'Martín Rodríguez martin@example.com',
    })
    await act(async () => finishFirst({ total: 1, data: [ana] }))
    expect(
      screen.queryByRole('option', { name: 'Ana García ana@example.com' }),
    ).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('permite reintentar la carga y muestra cuando no hay coincidencias', async () => {
    mockedApi.mockRejectedValueOnce(new Error('Sin conexión'))
    mockedApi.mockResolvedValueOnce({ total: 0, data: [] } as never)
    render(<AuditPersonFilter value={null} onChange={vi.fn()} />)
    fireEvent.click(
      screen.getByRole('button', { name: 'Persona Todos los usuarios' }),
    )
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar usuarios' }))
    await screen.findByText('No se encontraron usuarios.')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Persona Todos los usuarios' }),
    ).toHaveFocus()
  })
})
