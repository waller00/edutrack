import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SeguimientoSection from './SeguimientoSection'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
vi.mock('@/contexts/LibretaContext', () => ({ useLibreta: () => ({ gradeBookId: 'gb-1' }) }))
const mockedApi = vi.mocked(api)

const DATA = {
  rosterSize: 2,
  attendance: {
    classesWithRollCall: 20,
    marks: 40,
    absent: 3,
    justified: 1,
    late: 2,
    students: [{ studentId: 's2', lastName: 'Gómez', firstName: 'Beto', classes: 20, absent: 3, justified: 1, late: 2 }],
  },
  grades: {
    reference: { periodId: 'e2', name: '2.ª Entrega', closed: false },
    graded: 2,
    alert: 1,
    distribution: [
      { levelId: 'ins', label: 'Insuficiente', isAlert: true, count: 1 },
      { levelId: 'ace', label: 'Aceptable', isAlert: false, count: 1 },
    ],
    students: [{ studentId: 's2', lastName: 'Gómez', firstName: 'Beto', valueHundredths: 300, levelLabel: 'Insuficiente', isAlert: true }],
  },
  evolution: {
    from: { periodId: 'e1', name: '1.ª Entrega' },
    to: { periodId: 'e2', name: '2.ª Entrega' },
    compared: 2,
    improved: 1,
    same: 0,
    declined: 1,
    students: [{ studentId: 's2', lastName: 'Gómez', firstName: 'Beto', fromHundredths: 600, toHundredths: 300 }],
  },
}

beforeEach(() => {
  mockedApi.mockReset()
})

describe('<SeguimientoSection />', () => {
  it('faltas a sus clases, R en alerta y quiénes bajaron, cada número con su base', async () => {
    mockedApi.mockResolvedValue(DATA as never)
    render(<SeguimientoSection />)
    expect(await screen.findByText('36 de 40 marcas, en 20 clases con lista.')).toBeInTheDocument()
    expect(screen.getByText('1 de 2 con la R en alerta en 2.ª Entrega (todavía sin cerrar).')).toBeInTheDocument()
    expect(screen.getByText('6 → 3')).toBeInTheDocument()
    // Cada nombre abre la carta del alumno en Calificaciones.
    expect(screen.getAllByRole('link', { name: 'Gómez, Beto' })[0]).toHaveAttribute('href', '/libreta/gb-1/evaluaciones?alumno=s2')
    expect(mockedApi).toHaveBeenCalledWith('/gradebook/gb-1/indicators')
  })

  it('sin boletines con R ni dos para comparar, lo dice', async () => {
    mockedApi.mockResolvedValue({ ...DATA, grades: { ...DATA.grades, reference: null, students: [] }, evolution: null } as never)
    render(<SeguimientoSection />)
    expect(await screen.findByText('Todavía no cargaste ninguna R de boletín.')).toBeInTheDocument()
    expect(screen.getByText('Hace falta la R de dos boletines para comparar.')).toBeInTheDocument()
  })

  it('un error se puede reintentar', async () => {
    mockedApi.mockRejectedValueOnce(new Error('Sin conexión')).mockResolvedValue(DATA as never)
    render(<SeguimientoSection />)
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo calcular el seguimiento. Sin conexión')
    screen.getByRole('button', { name: 'Reintentar' }).click()
    expect(await screen.findByText('36 de 40 marcas, en 20 clases con lista.')).toBeInTheDocument()
  })
})
