import {
  getDefaultAttendanceStartDate,
  getAttendanceTypeStyle,
  getAttendanceTypeLabel,
  getAttendanceStatusStyle,
  getAttendanceStatusLabel,
  getAttendanceStatusLabelForType,
} from '@/lib/attendance/my-attendance-display'

describe('my-attendance-display', () => {
  it('uses the first day of the current year as default start date', () => {
    const year = new Date().getFullYear()
    expect(getDefaultAttendanceStartDate()).toBe(`${year}-01-01`)
  })

  it('returns type labels and styles for check in/out', () => {
    expect(getAttendanceTypeLabel('CHECK_IN')).toBe('Entrada')
    expect(getAttendanceTypeLabel('CHECK_OUT')).toBe('Salida')
    expect(getAttendanceTypeStyle('CHECK_IN')).toContain('bg-green-100')
    expect(getAttendanceTypeStyle('CHECK_OUT')).toContain('bg-red-100')
  })

  it('returns the visible label for each attendance status', () => {
    expect(getAttendanceStatusLabel('PRESENT')).toBe('Presente')
    expect(getAttendanceStatusLabel('LATE')).toBe('Tarde')
    expect(getAttendanceStatusLabel('MEDICAL_LEAVE')).toBe('Licencia Médica')
    expect(getAttendanceStatusLabel('JUSTIFIED_ABSENCE')).toBe('Ausencia Justificada')
    expect(getAttendanceStatusLabel('ABSENT_NOT_JUSTIFIED')).toBe('Ausencia sin justificar')
    expect(getAttendanceStatusLabel('ABSENT_JUSTIFIED')).toBe('Ausencia Justificada')
    expect(getAttendanceStatusLabel('EXIT')).toBe('Salida')
    expect(getAttendanceStatusLabel('EARLY_EXIT')).toBe('Salida anticipada')
    expect(getAttendanceStatusLabel('ABSENT')).toBe('Ausente')
  })

  it('returns stable badge styles for each status family', () => {
    expect(getAttendanceStatusStyle('PRESENT')).toContain('bg-green-100')
    expect(getAttendanceStatusStyle('EXIT')).toContain('bg-green-100')
    expect(getAttendanceStatusStyle('LATE')).toContain('bg-yellow-100')
    expect(getAttendanceStatusStyle('EARLY_EXIT')).toContain('bg-yellow-100')
    expect(getAttendanceStatusStyle('MEDICAL_LEAVE')).toContain('bg-blue-100')
    expect(getAttendanceStatusStyle('ABSENT_NOT_JUSTIFIED')).toContain('bg-red-100')
    expect(getAttendanceStatusStyle('ABSENT')).toContain('bg-gray-100')
  })

  it('does not show absence labels for CHECK_OUT records', () => {
    expect(getAttendanceStatusLabelForType('CHECK_OUT', 'EXIT')).toBe('Salida')
    expect(getAttendanceStatusLabelForType('CHECK_OUT', 'EARLY_EXIT')).toBe('Salida anticipada')
    expect(getAttendanceStatusLabelForType('CHECK_OUT', 'ABSENT_NOT_JUSTIFIED')).toBe('Salida pendiente')
    expect(getAttendanceStatusLabelForType('CHECK_IN', 'ABSENT_NOT_JUSTIFIED')).toBe('Ausencia sin justificar')
  })
})
