import { describe, expect, it } from 'vitest'
import {
  countActiveStudentFilters,
  getStudentStatusBadgeClass,
  getStudentStatusLabel,
  tuitionMonthChipClass,
  tuitionMonthLabel,
  type StudentListFilters,
} from './students-display'

const filters = (over?: Partial<StudentListFilters>): StudentListFilters => ({
  q: '',
  courseId: '',
  orientationId: '',
  status: '',
  tuitionMonth: '',
  tuitionPaid: '',
  ...over,
})

describe('getStudentStatusLabel', () => {
  it('traduce estados conocidos y cae al valor crudo', () => {
    expect(getStudentStatusLabel('ACTIVE')).toBe('Activo')
    expect(getStudentStatusLabel('WITHDRAWN')).toBe('Abandonó')
    expect(getStudentStatusLabel('GRADUATED')).toBe('Egresó')
    expect(getStudentStatusLabel('TRANSFERRED')).toBe('Transferido')
    expect(getStudentStatusLabel('OTRO')).toBe('OTRO')
    expect(getStudentStatusLabel('')).toBe('—')
  })
})

describe('getStudentStatusBadgeClass', () => {
  it('asigna color por estado', () => {
    expect(getStudentStatusBadgeClass('ACTIVE')).toContain('emerald')
    expect(getStudentStatusBadgeClass('WITHDRAWN')).toContain('red')
    expect(getStudentStatusBadgeClass('GRADUATED')).toContain('blue')
    expect(getStudentStatusBadgeClass('TRANSFERRED')).toContain('amber')
    expect(getStudentStatusBadgeClass('X')).toContain('gray')
  })
})

describe('tuitionMonth helpers', () => {
  it('clase y etiqueta por estado de cuota', () => {
    expect(tuitionMonthChipClass('paid')).toContain('emerald')
    expect(tuitionMonthChipClass('pending')).toContain('amber')
    expect(tuitionMonthChipClass('none')).toContain('gray')
    expect(tuitionMonthLabel('paid')).toBe('pagado')
    expect(tuitionMonthLabel('pending')).toBe('pendiente')
    expect(tuitionMonthLabel('none')).toBe('sin estado')
  })
})

describe('countActiveStudentFilters', () => {
  it('cuenta solo filtros activos', () => {
    expect(countActiveStudentFilters(filters())).toBe(0)
    expect(countActiveStudentFilters(filters({ q: '  ' }))).toBe(0)
    expect(countActiveStudentFilters(filters({ q: 'ana', courseId: 'c1', orientationId: 'o1', status: 'ACTIVE', tuitionMonth: '3', tuitionPaid: 'true' }))).toBe(6)
    expect(countActiveStudentFilters(filters({ orientationId: 'o1' }))).toBe(1)
    expect(countActiveStudentFilters(filters({ tuitionPaid: 'x' }))).toBe(0)
  })
})
