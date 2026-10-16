import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminSystemSettingsPage from './page'
import { api } from '@/lib/api/client'

vi.mock('@/components/auth/RoleGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))
vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
vi.mock('@/components/admin/AdminBiometricDevicesPanel', () => ({
  default: () => <div data-testid="readers-panel" />,
}))
vi.mock('@/components/admin/AdminMoodlePanel', () => ({
  default: () => <div data-testid="moodle-panel" />,
}))

const mockedApi = vi.mocked(api)
const settings = {
  attendanceNoShowGraceMinutes: 15,
  attendanceLateToleranceMinutes: 5,
  attendanceEarlyExitToleranceMinutes: 5,
  attendanceClassBridgeGapMinutes: 60,
  attendanceMonitorEnabled: true,
  attendanceMonitorIntervalMs: 120000,
  biometricDuplicateWindowMinutes: 5,
  institutionTimezone: 'America/Montevideo',
  institutionTimezoneOptions: [
    { value: 'America/Montevideo', label: 'Uruguay — Montevideo' },
  ],
  studentRollCallEditWindowHours: 168,
  studentRollCallCopyPreviousEnabled: true,
  studentDailyAbsenceThresholdPercent: 50,
}

async function openAttendance() {
  await screen.findByRole('heading', { name: 'Zona horaria institucional' })
  fireEvent.click(screen.getByRole('button', { name: 'Asistencia' }))
}

describe('AdminSystemSettingsPage', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/admin/settings')
    mockedApi.mockReset()
    mockedApi.mockResolvedValue({ ...settings })
  })

  it('usa cuatro botones y carga las integraciones cuando se abren', async () => {
    render(<AdminSystemSettingsPage />)
    await screen.findByRole('heading', { name: 'Zona horaria institucional' })
    expect(screen.getAllByRole('button', { name: 'Moodle' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Sistema' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.queryByTestId('moodle-panel')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Moodle' }))
    expect(screen.getByTestId('moodle-panel')).toBeVisible()
    expect(window.location.search).toBe('?section=moodle')
    fireEvent.click(screen.getByRole('button', { name: 'Sistema' }))
    expect(screen.getByTestId('moodle-panel')).not.toBeVisible()
    expect(window.location.search).toBe('')
  })

  it.each(['attendance', 'moodle', 'readers'])(
    'respeta el enlace directo a %s',
    async (section) => {
      window.history.replaceState(
        null,
        '',
        `/admin/settings?section=${section}`,
      )
      render(<AdminSystemSettingsPage />)
      if (section === 'attendance')
        expect(
          await screen.findByRole('heading', {
            name: 'Asistencia del personal',
          }),
        ).toBeVisible()
      else expect(await screen.findByTestId(`${section}-panel`)).toBeVisible()
    },
  )

  it('ignora una sección desconocida', async () => {
    window.history.replaceState(null, '', '/admin/settings?section=testing')
    render(<AdminSystemSettingsPage />)
    expect(
      await screen.findByRole('heading', {
        name: 'Zona horaria institucional',
      }),
    ).toBeVisible()
  })

  it('guarda también los tres ajustes del pase de lista y admite tolerancias cero', async () => {
    render(<AdminSystemSettingsPage />)
    await openAttendance()
    fireEvent.click(screen.getByText('Pase de lista estudiantil'))
    fireEvent.change(
      screen.getByLabelText('Plazo para pasar o corregir el pase de lista (horas)'),
      { target: { value: '72' } },
    )
    fireEvent.change(screen.getByLabelText('Umbral de falta diaria (%)'), {
      target: { value: '60' },
    })
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Sugerir copiar la hora anterior' }),
    )
    fireEvent.change(
      screen.getByLabelText('Tolerancia de llegada tarde (minutos)'),
      { target: { value: '0' } },
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Guardar configuración' }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Configuración guardada correctamente.',
    )
    const update = mockedApi.mock.calls.find(
      ([, options]) => options?.method === 'PUT',
    )
    expect(JSON.parse(String(update?.[1]?.body))).toEqual({
      ...settings,
      institutionTimezoneOptions: undefined,
      attendanceLateToleranceMinutes: 0,
      studentRollCallEditWindowHours: 72,
      studentDailyAbsenceThresholdPercent: 60,
      studentRollCallCopyPreviousEnabled: false,
    })
  })

  it('conserva el borrador entre áreas y vuelve a los mismos valores', async () => {
    render(<AdminSystemSettingsPage />)
    await openAttendance()
    fireEvent.change(
      screen.getByLabelText('Tolerancia de salida anticipada (minutos)'),
      { target: { value: '12' } },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Moodle' }))
    fireEvent.click(screen.getByRole('button', { name: 'Asistencia' }))
    expect(
      screen.getByLabelText('Tolerancia de salida anticipada (minutos)'),
    ).toHaveValue(12)
    expect(screen.getByText('Cambios sin guardar')).toBeVisible()
    expect(mockedApi).toHaveBeenCalledTimes(1)
  })

  it('pide descartar cambios antes de recargar y permite seguir editando', async () => {
    render(<AdminSystemSettingsPage />)
    await openAttendance()
    fireEvent.change(
      screen.getByLabelText('Tolerancia de llegada tarde (minutos)'),
      { target: { value: '10' } },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Recargar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('se perderán')
    expect(mockedApi).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Seguir editando' }))
    expect(
      screen.getByLabelText('Tolerancia de llegada tarde (minutos)'),
    ).toHaveValue(10)
    fireEvent.click(screen.getByRole('button', { name: 'Recargar' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Descartar cambios y recargar' }),
    )
    await waitFor(() =>
      expect(
        screen.getByLabelText('Tolerancia de llegada tarde (minutos)'),
      ).toHaveValue(5),
    )
    expect(mockedApi).toHaveBeenCalledTimes(2)
  })

  it('convierte segundos a milisegundos al guardar la frecuencia del monitor', async () => {
    render(<AdminSystemSettingsPage />)
    await screen.findByRole('heading', { name: 'Zona horaria institucional' })
    expect(
      screen.getByLabelText('Intervalo de revisión (segundos)'),
    ).not.toBeVisible()
    fireEvent.click(screen.getByText('Frecuencia de revisión'))
    expect(
      screen.getByLabelText('Intervalo de revisión (segundos)'),
    ).toHaveValue(120)
    fireEvent.change(
      screen.getByLabelText('Intervalo de revisión (segundos)'),
      { target: { value: '60' } },
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Guardar configuración' }),
    )
    await screen.findByText('Configuración guardada correctamente.')
    const update = mockedApi.mock.calls.find(
      ([, options]) => options?.method === 'PUT',
    )
    expect(
      JSON.parse(String(update?.[1]?.body)).attendanceMonitorIntervalMs,
    ).toBe(60000)
  })

  it('una carga fallida deja reintentar sin mostrar un indicador eterno', async () => {
    mockedApi.mockRejectedValueOnce(new Error('offline'))
    render(<AdminSystemSettingsPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudo cargar',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(
      await screen.findByRole('heading', {
        name: 'Zona horaria institucional',
      }),
    ).toBeVisible()
  })

  it('conserva el borrador cuando falla el guardado', async () => {
    mockedApi
      .mockResolvedValueOnce({ ...settings })
      .mockRejectedValueOnce(new Error('offline'))
    render(<AdminSystemSettingsPage />)
    await openAttendance()
    fireEvent.change(
      screen.getByLabelText('Tolerancia de llegada tarde (minutos)'),
      { target: { value: '10' } },
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Guardar configuración' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudo guardar',
    )
    expect(
      screen.getByLabelText('Tolerancia de llegada tarde (minutos)'),
    ).toHaveValue(10)
    expect(
      screen.getByRole('button', { name: 'Guardar configuración' }),
    ).toBeEnabled()
  })
})
