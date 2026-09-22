import { describe, expect, it } from 'vitest'
import { withSchoolYear } from './school-year-query'

describe('withSchoolYear', () => {
  it('devuelve la ruta intacta si no hay filtro de ciclo', () => {
    expect(withSchoolYear('/admin/students', '')).toBe('/admin/students')
  })

  it('agrega el filtro con ? cuando la ruta no tiene query', () => {
    expect(withSchoolYear('/admin/students', 'schoolYearId=abc')).toBe('/admin/students?schoolYearId=abc')
  })

  it('agrega el filtro con & cuando la ruta ya tiene query', () => {
    expect(withSchoolYear('/admin/students?page=2', 'schoolYearId=abc')).toBe(
      '/admin/students?page=2&schoolYearId=abc',
    )
  })

  it('soporta el modo todos los ciclos', () => {
    expect(withSchoolYear('/admin/students', 'allYears=1')).toBe('/admin/students?allYears=1')
  })
})
