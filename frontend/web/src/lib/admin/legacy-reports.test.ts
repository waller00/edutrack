import { describe, expect, it } from 'vitest'
import {
  legacyAcademicTarget,
  legacyAttendanceIndicatorsTarget,
  legacyReportsTarget,
  searchParamsOf,
} from './legacy-reports'

const params = (query: string) => new URLSearchParams(query)

describe('las pantallas viejas de indicadores llevan a Indicadores de estudiantes', () => {
  it('Reportes de estudiantes: las faltas a Asistencia y las notas a Materias', () => {
    expect(legacyReportsTarget(params('tab=faltas'))).toBe('/admin/student-indicators?seccion=asistencia&lista=faltas')
    expect(legacyReportsTarget(params('tab=seguidas'))).toBe('/admin/student-indicators?seccion=asistencia&lista=seguidas')
    expect(legacyReportsTarget(params('tab=alertas'))).toBe('/admin/student-indicators?seccion=asistencia&lista=seguidas')
    expect(legacyReportsTarget()).toBe('/admin/student-indicators?seccion=asistencia&lista=seguidas')
    expect(legacyReportsTarget(params('tab=notas'))).toBe('/admin/student-indicators?seccion=materias')
    expect(legacyReportsTarget(params('tab=bajas'))).toBe('/admin/student-indicators?seccion=materias')
  })

  it('Indicadores de asistencia: cada lista a la suya y la prioridad a quién necesita atención', () => {
    expect(legacyAttendanceIndicatorsTarget(params('tab=faltas&schoolYearId=sy1'))).toBe(
      '/admin/student-indicators?seccion=asistencia&lista=faltas&schoolYearId=sy1',
    )
    expect(legacyAttendanceIndicatorsTarget(params('tab=seguidas'))).toBe('/admin/student-indicators?seccion=asistencia&lista=seguidas')
    expect(legacyAttendanceIndicatorsTarget(params('tab=prioridad'))).toBe('/admin/student-indicators?seccion=riesgo&motivo=faltas')
    expect(legacyAttendanceIndicatorsTarget(params(''))).toBe('/admin/student-indicators?seccion=asistencia')
  })

  it('Rendimiento académico: cada vista a su sección; sin vista, el Resumen', () => {
    expect(legacyAcademicTarget(params('view=seguimiento'))).toBe('/admin/student-indicators?seccion=materias')
    expect(legacyAcademicTarget(params('view=asistencia'))).toBe('/admin/student-indicators?seccion=asistencia')
    expect(legacyAcademicTarget(params('view=rendimiento'))).toBe('/admin/student-indicators?seccion=rendimiento')
    expect(legacyAcademicTarget(params('view=gestion'))).toBe('/admin/student-indicators')
    expect(legacyAcademicTarget(params('schoolYearId=sy2'))).toBe('/admin/student-indicators?schoolYearId=sy2')
  })

  it('lee los parámetros de una página del servidor', () => {
    const read = searchParamsOf({ tab: ['faltas', 'seguidas'], schoolYearId: 'sy1', vacio: undefined })
    expect(read.toString()).toBe('tab=faltas&schoolYearId=sy1')
    expect(searchParamsOf(undefined).toString()).toBe('')
  })
})
