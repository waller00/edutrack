import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GradeSheet from './GradeSheet'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

const SCALE = {
  id: 'sc-1',
  name: 'Numérica 1 a 10',
  kind: 'NUMERIC' as const,
  decimals: 0,
  minValueHundredths: 100,
  maxValueHundredths: 1000,
}

const SHEET = {
  assessment: { id: 'a-1', title: 'Escrito 1', date: '2026-05-10', gradingScale: SCALE },
  permissions: { canEdit: true, blockedReason: null, editableUntil: '2026-06-09T12:00:00.000Z', outsideWindow: false },
  students: [
    { studentId: 's1', studentEnrollmentId: 'e1', firstName: 'Ana', lastName: 'Benítez', documentId: null },
    { studentId: 's2', studentEnrollmentId: 'e2', firstName: 'Beto', lastName: 'Cardozo', documentId: null },
  ],
  grades: [{ studentId: 's1', valueHundredths: 700, isAbsent: false, comment: null }],
}

function cellFor(name: string) {
  return screen.getByLabelText(`Calificación de ${name}`) as HTMLInputElement
}

beforeEach(() => {
  mockedApi.mockReset()
  mockedApi.mockResolvedValue(SHEET as any)
})

describe('GradeSheet', () => {
  it('precarga lo guardado y deja vacío lo pendiente', async () => {
    render(<GradeSheet gradeBookId="gb-1" assessmentId="a-1" />)
    await waitFor(() => expect(cellFor('Benítez, Ana').value).toBe('7'))
    expect(cellFor('Cardozo, Beto').value).toBe('')
  })

  it('el botón de guardar arranca deshabilitado y se habilita al editar', async () => {
    render(<GradeSheet gradeBookId="gb-1" assessmentId="a-1" />)
    const save = await screen.findByRole('button', { name: /Guardar/ })
    expect(save).toBeDisabled()

    fireEvent.change(cellFor('Cardozo, Beto'), { target: { value: '9' } })
    expect(save).toBeEnabled()
    expect(screen.getByText('Tenés cambios sin guardar.')).toBeInTheDocument()
  })

  it('manda sólo las celdas que cambiaron', async () => {
    render(<GradeSheet gradeBookId="gb-1" assessmentId="a-1" />)
    await waitFor(() => expect(cellFor('Cardozo, Beto')).toBeInTheDocument())

    fireEvent.change(cellFor('Cardozo, Beto'), { target: { value: '9' } })
    mockedApi.mockResolvedValueOnce({ data: { created: 1, updated: 0, unchanged: 0 } } as any)
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }))

    await waitFor(() => {
      const put = mockedApi.mock.calls.find(([, init]) => (init as any)?.method === 'PUT')
      expect(JSON.parse((put?.[1] as any).body).entries).toEqual([
        { studentId: 's2', valueHundredths: 900, isAbsent: false, comment: null },
      ])
    })
  })

  it('no deja guardar con formato inválido', async () => {
    render(<GradeSheet gradeBookId="gb-1" assessmentId="a-1" />)
    await waitFor(() => expect(cellFor('Cardozo, Beto')).toBeInTheDocument())

    fireEvent.change(cellFor('Cardozo, Beto'), { target: { value: 'ocho' } })
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('formato inválido')
    expect(mockedApi.mock.calls.some(([, init]) => (init as any)?.method === 'PUT')).toBe(false)
  })

  it('marcar ausente deshabilita la celda de nota', async () => {
    render(<GradeSheet gradeBookId="gb-1" assessmentId="a-1" />)
    await waitFor(() => expect(cellFor('Cardozo, Beto')).toBeInTheDocument())

    fireEvent.click(screen.getByLabelText('Marcar ausente a Cardozo, Beto'))
    expect(cellFor('Cardozo, Beto')).toBeDisabled()
  })

  it('Enter baja a la celda siguiente: la planilla se recorre con el teclado', async () => {
    render(<GradeSheet gradeBookId="gb-1" assessmentId="a-1" />)
    await waitFor(() => expect(cellFor('Benítez, Ana')).toBeInTheDocument())

    const first = cellFor('Benítez, Ana')
    first.focus()
    fireEvent.keyDown(first, { key: 'Enter' })
    expect(document.activeElement).toBe(cellFor('Cardozo, Beto'))
  })

  it('en sólo lectura explica por qué y no ofrece guardar', async () => {
    mockedApi.mockResolvedValue({
      ...SHEET,
      permissions: { ...SHEET.permissions, canEdit: false, blockedReason: 'WINDOW_EXPIRED' },
    } as any)

    render(<GradeSheet gradeBookId="gb-1" assessmentId="a-1" />)

    expect(await screen.findByText(/Venció el plazo/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Guardar/ })).not.toBeInTheDocument()
    expect(cellFor('Benítez, Ana')).toBeDisabled()
  })

  it('muestra el recuento de calificados, ausentes y pendientes', async () => {
    render(<GradeSheet gradeBookId="gb-1" assessmentId="a-1" />)
    expect(await screen.findByText('1 calificados · 0 ausentes · 1 pendientes')).toBeInTheDocument()
  })
})
