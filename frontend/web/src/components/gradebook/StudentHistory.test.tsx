import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import StudentHistory, { periodChangeText } from './StudentHistory'

const apiMock = vi.fn()
vi.mock('@/lib/api/client', () => ({
  api: (...args: unknown[]) => apiMock(...args),
}))

const CHANGE = {
  id: 'p-1',
  periodName: '1.ª Entrega',
  previousValueHundredths: null,
  newValueHundredths: null,
  previousMeetingValueHundredths: 900,
  newMeetingValueHundredths: 1100,
  previousConductValueHundredths: null,
  newConductValueHundredths: null,
  judgementChanged: true,
  origin: 'TEACHER',
  changedByName: 'Ana G',
  changedAt: '2026-05-02T15:00:00.000Z',
}

describe('<StudentHistory />', () => {
  it('se carga al abrirlo y muestra correcciones y notas borradas', async () => {
    apiMock.mockResolvedValue({
      periods: [CHANGE],
      grades: [
        {
          id: 'g-1',
          assessmentTitle: 'Escrito 1',
          assessmentDate: '2026-04-10',
          previousValueHundredths: 700,
          newValueHundredths: null,
          previousIsAbsent: false,
          newIsAbsent: false,
          deleted: true,
          origin: 'ADMIN_CORRECTION',
          changedByName: 'Dirección',
          changedAt: '2026-04-12T15:00:00.000Z',
        },
      ],
    })
    render(<StudentHistory gradeBookId="gb-1" studentId="s1" />)
    expect(apiMock).not.toHaveBeenCalled()

    await userEvent.click(screen.getByText('Historial de cambios'))

    expect(apiMock).toHaveBeenCalledWith('/gradebook/gb-1/history?studentId=s1')
    expect(await screen.findByText(/R 9 → 11 · informe cambiado/)).toBeInTheDocument()
    expect(screen.getByText(/nota 7 borrada/)).toBeInTheDocument()
    expect(screen.getByText(/corrección de administración/)).toBeInTheDocument()
  })

  it('sin correcciones lo dice', async () => {
    apiMock.mockResolvedValue({ periods: [], grades: [] })
    render(<StudentHistory gradeBookId="gb-1" studentId="s1" />)
    await userEvent.click(screen.getByText('Historial de cambios'))
    expect(await screen.findByText(/Sin correcciones/)).toBeInTheDocument()
  })
})

describe('periodChangeText', () => {
  it('sólo lo que cambió, y borrar se lee "sin nota"', () => {
    expect(periodChangeText({ ...CHANGE, previousValueHundredths: 800, newValueHundredths: null, previousMeetingValueHundredths: null, judgementChanged: false })).toBe(
      'C 8 → sin nota',
    )
  })
})
