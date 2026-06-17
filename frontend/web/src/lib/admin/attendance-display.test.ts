import {
  ADMIN_ATTENDANCE_LEGEND,
  buildAdminAttendanceAllQueryString,
  buildAttendanceExportReportQueryString,
  getAdminAttendanceDefaultStartDate,
  getAdminAttendanceLegendLabel,
  getAdminAttendancePlannedTimeLabel,
  getAdminAttendanceStatusLabel,
  getAdminAttendanceStatusStyle,
  getAdminAttendanceTypeLabel,
  getAdminAttendanceTypeStyle,
} from '@/lib/admin/attendance-display'

const f = {
  startDate: '2025-01-01',
  endDate: '',
  userId: 'u1',
  eventId: '',
  eventType: '',
  type: 'CHECK_IN',
  status: 'PRESENT',
  role: 'TEACHER',
}

describe('admin-attendance-display', () => {
  it('tipo entrada/salida', () => {
    expect(getAdminAttendanceTypeLabel('CHECK_IN')).toBe('Entrada')
    expect(getAdminAttendanceTypeStyle('CHECK_OUT')).toContain('red')
  })

  it('estados asistencia', () => {
    expect(getAdminAttendanceStatusLabel('LATE')).toBe('Tarde')
    expect(getAdminAttendanceStatusLabel('SUBSTITUTED')).toBe('Suplida')
    expect(getAdminAttendanceStatusStyle('ABSENT_JUSTIFIED')).toContain('orange')
    expect(getAdminAttendanceStatusStyle('SUBSTITUTED')).toContain('rose')
  })

  it('leyenda: distingue ausencia prevista suplida de la no suplida', () => {
    // La etiqueta custom prevalece sobre la del estado; sin label cae al rótulo del estado.
    expect(getAdminAttendanceLegendLabel({ status: 'PRESENT', description: '' })).toBe('Presente')
    expect(
      getAdminAttendanceLegendLabel({ status: 'ABSENT_NOT_JUSTIFIED', label: 'Ausencia prevista sin justificar', description: '' }),
    ).toBe('Ausencia prevista sin justificar')

    // Existe la entrada de ausencia prevista NO suplida (rojo, ABSENT_NOT_JUSTIFIED con rótulo propio)
    // además de la SUBSTITUTED (suplida).
    const previstaNoSuplida = ADMIN_ATTENDANCE_LEGEND.find((i) => i.label === 'Ausencia prevista sin justificar')
    expect(previstaNoSuplida?.status).toBe('ABSENT_NOT_JUSTIFIED')
    expect(ADMIN_ATTENDANCE_LEGEND.some((i) => i.status === 'SUBSTITUTED')).toBe(true)
  })

  it('hora planificada', () => {
    expect(
      getAdminAttendancePlannedTimeLabel({
        type: 'CHECK_IN',
        event: { startTime: '2025-06-15T08:30:00.000Z' },
      }),
    ).toMatch(/\d/)
    expect(getAdminAttendancePlannedTimeLabel({ type: 'CHECK_IN' })).toBe('N/A')
  })

  it('queries', () => {
    expect(buildAdminAttendanceAllQueryString(1, f)).toContain('userId=u1')
    expect(buildAttendanceExportReportQueryString('pdf', { ...f, eventId: 'e1' })).toContain('format=pdf')
    expect(getAdminAttendanceDefaultStartDate(2022)).toBe('2022-01-01')
  })
})
