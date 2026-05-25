import {
  getEventTypeLabel,
  getAssignedEventStatusLabel,
  getAssignedEventStatusColor,
  getDaysOfWeekLabel,
} from '@/lib/events/assigned-event-display'

describe('assigned-event-display', () => {
  it('returns localized labels for known event types and falls back otherwise', () => {
    expect(getEventTypeLabel('CLASE')).toBe('Clase')
    expect(getEventTypeLabel('REUNION')).toBe('Reunión')
    expect(getEventTypeLabel('JORNADA_LABORAL')).toBe('Jornada laboral')
    expect(getEventTypeLabel('EVENTO')).toBe('Evento')
    expect(getEventTypeLabel('CAPACITACION')).toBe('Capacitación')
    expect(getEventTypeLabel('CITA_MEDICA')).toBe('Cita médica')
    expect(getEventTypeLabel('CUSTOM')).toBe('CUSTOM')
  })

  it('returns localized labels for known event statuses and falls back otherwise', () => {
    expect(getAssignedEventStatusLabel('SCHEDULED')).toBe('Programado')
    expect(getAssignedEventStatusLabel('IN_PROGRESS')).toBe('En curso')
    expect(getAssignedEventStatusLabel('COMPLETED')).toBe('Completado')
    expect(getAssignedEventStatusLabel('CANCELLED')).toBe('Cancelado')
    expect(getAssignedEventStatusLabel('UNKNOWN')).toBe('UNKNOWN')
  })

  it('returns consistent badge colors for known and unknown statuses', () => {
    expect(getAssignedEventStatusColor('SCHEDULED')).toBe('bg-blue-100 text-blue-800')
    expect(getAssignedEventStatusColor('IN_PROGRESS')).toBe('bg-yellow-100 text-yellow-800')
    expect(getAssignedEventStatusColor('COMPLETED')).toBe('bg-green-100 text-green-800')
    expect(getAssignedEventStatusColor('CANCELLED')).toBe('bg-red-100 text-red-800')
    expect(getAssignedEventStatusColor('UNKNOWN')).toBe('bg-gray-100 text-gray-800')
  })

  it('renders selected weekdays in order and empty string for no days', () => {
    expect(getDaysOfWeekLabel([1, 3, 5])).toBe('Lun, Mié, Vie')
    expect(getDaysOfWeekLabel([])).toBe('')
    expect(getDaysOfWeekLabel(undefined as unknown as number[])).toBe('')
  })
})
