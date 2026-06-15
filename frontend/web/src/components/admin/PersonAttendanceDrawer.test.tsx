import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PersonAttendanceDrawer from './PersonAttendanceDrawer'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

const summary = {
  from: '2026-01-01',
  to: '2026-05-31',
  person: {
    userId: 'u1',
    nombre: 'Ada Lovelace',
    rol: 'Docente',
    email: 'ada@example.com',
    rows: [
      {
        fecha: '2026-05-20',
        evento: 'Clase',
        tipoEvento: 'Clase',
        horaPlanIn: '08:00',
        horaPlanOut: '09:00',
        horaRealIn: '',
        horaRealOut: '',
        estado: 'Ausente no justificado',
        minTarde: 0,
        horasTrab: 0,
        licencia: 'NO',
        observaciones: '-',
      },
    ],
    stats: {
      esperadas: 4,
      presente: 3,
      tarde: 0,
      ausenteJustificado: 0,
      ausenteNoJustificado: 1,
      suplido: 0,
      cobertura: 0,
      pctPuntualidad: 100,
      pctAsistencia: 75,
      pctAusentismo: 25,
      horasTrabajadas: 6,
      horasPlanificadas: 8,
      deltaHoras: -2,
      minTardeAcumulados: 0,
      minTardePromedio: 0,
    },
  },
}

describe('PersonAttendanceDrawer', () => {
  beforeEach(() => mockedApi.mockReset())

  it('muestra KPIs del resumen de la persona', async () => {
    mockedApi.mockResolvedValue(summary as never)
    render(<PersonAttendanceDrawer userId="u1" userName="Ada" from="2026-01-01" to="2026-05-31" onClose={() => {}} />)

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('75%')).toBeInTheDocument()
    expect(mockedApi).toHaveBeenCalledWith(expect.stringContaining('/attendance/summary?userId=u1'))
  })

  it('justifica el rango y refresca', async () => {
    mockedApi.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/attendance/justify-range') && init?.method === 'POST') {
        return { justified: 1, created: 1, total: 1 } as never
      }
      return summary as never
    })
    const onJustified = vi.fn()
    render(<PersonAttendanceDrawer userId="u1" userName="Ada" from="2026-01-01" to="2026-05-31" onClose={() => {}} onJustified={onJustified} />)

    await screen.findByText('Ada Lovelace')
    fireEvent.click(screen.getByRole('button', { name: 'Justificar rango' }))
    fireEvent.change(screen.getByPlaceholderText(/Motivo/), { target: { value: 'Licencia médica' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        '/attendance/justify-range',
        expect.objectContaining({ method: 'POST' }),
      ),
    )
    await waitFor(() => expect(onJustified).toHaveBeenCalled())
  })
})
