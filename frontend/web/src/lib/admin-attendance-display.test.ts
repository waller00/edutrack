import {
  buildAdminAttendanceAllQueryString,
  buildAttendanceExportReportQueryString,
  getAdminAttendanceDefaultStartDate,
  getAdminAttendancePlannedTimeLabel,
  getAdminAttendanceStatusLabel,
  getAdminAttendanceStatusStyle,
  getAdminAttendanceTypeLabel,
  getAdminAttendanceTypeStyle,
} from '@/lib/admin-attendance-display'

const f = {
  startDate: '2025-01-01',
  endDate: '',
  userId: 'u1',
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
    expect(getAdminAttendanceStatusStyle('ABSENT_JUSTIFIED')).toContain('orange')
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
