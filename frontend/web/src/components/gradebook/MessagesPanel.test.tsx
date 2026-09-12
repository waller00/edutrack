import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MessagesPanel, { buildThreads } from './MessagesPanel'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

function msg(over: any = {}) {
  return {
    id: 'm-1',
    body: 'Falta un alumno.',
    authorRoleCode: 'ADSCRIPTO',
    author: { id: 'a-1', name: 'Laura A' },
    period: { id: 'p-1', name: 'Mayo' },
    parentId: null,
    createdAt: '2026-06-01T12:00:00.000Z',
    ...over,
  }
}

describe('buildThreads', () => {
  it('agrupa las respuestas bajo su raíz', () => {
    const threads = buildThreads([msg(), msg({ id: 'm-2', parentId: 'm-1', body: 'Ya lo cargué.' })])
    expect(threads).toHaveLength(1)
    expect(threads[0].replies.map((r) => r.id)).toEqual(['m-2'])
  })

  it('una respuesta huérfana se muestra como raíz en vez de desaparecer', () => {
    // Perder un mensaje del intercambio es peor que mostrarlo fuera de su hilo.
    const threads = buildThreads([msg({ id: 'm-9', parentId: 'no-esta' })])
    expect(threads).toHaveLength(1)
    expect(threads[0].root.id).toBe('m-9')
  })

  it('sin mensajes no arma hilos', () => {
    expect(buildThreads([])).toEqual([])
  })
})

describe('MessagesPanel', () => {
  beforeEach(() => {
    mockedApi.mockReset()
    mockedApi.mockResolvedValue({ data: [msg()] } as any)
  })

  it('muestra autor, rol y período del mensaje', async () => {
    render(<MessagesPanel gradeBookId="gb-1" />)
    expect(await screen.findByText('Laura A')).toBeInTheDocument()
    expect(screen.getByText('Adscripto')).toBeInTheDocument()
    expect(screen.getByText('· Mayo')).toBeInTheDocument()
  })

  it('explica el vacío en vez de mostrar nada', async () => {
    mockedApi.mockResolvedValue({ data: [] } as any)
    render(<MessagesPanel gradeBookId="gb-1" />)
    expect(await screen.findByText(/Todavía no hay mensajes/)).toBeInTheDocument()
  })

  it('no deja publicar en blanco', async () => {
    render(<MessagesPanel gradeBookId="gb-1" />)
    expect(await screen.findByRole('button', { name: /Publicar/ })).toBeDisabled()
  })

  it('publica el mensaje y recarga el hilo', async () => {
    render(<MessagesPanel gradeBookId="gb-1" />)
    fireEvent.change(await screen.findByLabelText('Escribir un mensaje'), { target: { value: 'Ya lo cargué.' } })

    mockedApi.mockResolvedValueOnce({ data: { id: 'm-2' } } as any)
    fireEvent.click(screen.getByRole('button', { name: /Publicar/ }))

    await waitFor(() => {
      const post = mockedApi.mock.calls.find(([, init]) => (init as any)?.method === 'POST')
      expect(JSON.parse((post?.[1] as any).body)).toEqual({ body: 'Ya lo cargué.' })
    })
  })

  it('responder manda el parentId del hilo', async () => {
    render(<MessagesPanel gradeBookId="gb-1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Responder' }))
    fireEvent.change(screen.getByLabelText('Escribir un mensaje'), { target: { value: 'Corregido.' } })

    mockedApi.mockResolvedValueOnce({ data: { id: 'm-3' } } as any)
    fireEvent.click(screen.getByRole('button', { name: /Publicar/ }))

    await waitFor(() => {
      const post = mockedApi.mock.calls.find(([, init]) => (init as any)?.method === 'POST')
      expect(JSON.parse((post?.[1] as any).body).parentId).toBe('m-1')
    })
  })

  it('un autor dado de baja no rompe el hilo', async () => {
    mockedApi.mockResolvedValue({ data: [msg({ author: null })] } as any)
    render(<MessagesPanel gradeBookId="gb-1" />)
    expect(await screen.findByText('Usuario dado de baja')).toBeInTheDocument()
  })

  it('informa el error al publicar', async () => {
    render(<MessagesPanel gradeBookId="gb-1" />)
    fireEvent.change(await screen.findByLabelText('Escribir un mensaje'), { target: { value: 'x' } })

    mockedApi.mockRejectedValueOnce(new Error('API 500'))
    fireEvent.click(screen.getByRole('button', { name: /Publicar/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('API 500')
  })
})
