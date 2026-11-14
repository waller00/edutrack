import { describe, expect, it } from 'vitest'
import { indicatorAccess, indicatorPaths, indicatorReportPath, nextQuery, resolveSection, visibleSections } from './student-indicators-sections'

const me = (...ids: string[]) => ({ permissions: ids.map((id) => ({ id, scope: 'all' as const })) })

describe('secciones de Indicadores de estudiantes', () => {
  it('con los dos permisos se ven todas, en orden', () => {
    const sections = visibleSections(indicatorAccess(me('academic-analytics.read', 'student-reports.read')))
    expect(sections.map((s) => s.id)).toEqual(['resumen', 'rendimiento', 'materias', 'asistencia', 'trayectoria', 'riesgo'])
  })

  it('adscripción (sólo reportes) no ve rendimiento ni trayectoria', () => {
    const sections = visibleSections(indicatorAccess(me('student-reports.read')))
    expect(sections.map((s) => s.id)).toEqual(['resumen', 'materias', 'asistencia', 'riesgo'])
  })

  it('un permiso propio no alcanza: los indicadores son del centro', () => {
    const own = { permissions: [{ id: 'student-reports.read', scope: 'own' as const }] }
    expect(visibleSections(indicatorAccess(own))).toEqual([])
  })

  it('abre la sección pedida si se puede ver; si no, la primera', () => {
    const sections = visibleSections(indicatorAccess(me('student-reports.read')))
    expect(resolveSection('asistencia', sections)?.id).toBe('asistencia')
    expect(resolveSection('trayectoria', sections)?.id).toBe('resumen')
    expect(resolveSection('inventada', sections)?.id).toBe('resumen')
    expect(resolveSection(null, [])).toBeNull()
  })
})

describe('de dónde sale cada número', () => {
  const base = { query: 'schoolYearId=y26', yearReady: true, periodsReady: true, period: { id: 'e2', level: 'EBI' } }

  it('todo con el ciclo elegido, y las notas con el boletín', () => {
    const paths = indicatorPaths(base)
    expect(paths.trend).toBe('/admin/student-reports/attendance-trend?schoolYearId=y26')
    expect(paths.risk).toBe('/admin/student-reports/risk?periodId=e2&schoolYearId=y26')
    expect(paths.dashboard).toBe('/admin/academic-analytics/dashboard?level=EBI&periodId=e2&schoolYearId=y26')
    expect(paths.lowGrades).toBe('/admin/student-reports/low-grades?periodId=e2')
    expect(paths.drops).toBe('/admin/student-reports/grade-drops?periodId=e2')
    expect(paths.comparison('SUBJECT', 'y25,y26')).toBe(
      '/admin/academic-analytics/comparison?level=EBI&periodId=e2&dimension=SUBJECT&schoolYearId=y26',
    )
    expect(paths.comparison('YEAR', 'y25,y26')).toBe(
      '/admin/academic-analytics/comparison?level=EBI&periodId=e2&dimension=YEAR&schoolYearIds=y25%2Cy26&schoolYearId=y26',
    )
  })

  it('sin boletines en el ciclo, el riesgo y el tablero igual se piden; las notas por materia no', () => {
    const paths = indicatorPaths({ ...base, query: '', period: null })
    expect(paths.risk).toBe('/admin/student-reports/risk')
    expect(paths.dashboard).toBe('/admin/academic-analytics/dashboard')
    expect(paths.lowGrades).toBeNull()
  })

  it('no pide nada mientras falta saber el ciclo o sus boletines', () => {
    const waiting = indicatorPaths({ ...base, yearReady: false, periodsReady: false })
    expect(waiting.trend).toBeNull()
    expect(waiting.risk).toBeNull()
    expect(waiting.comparison('COURSE', '')).toBeNull()
    expect(indicatorPaths({ ...base, periodsReady: false }).trajectory).toBe('/admin/academic-analytics/trajectory?schoolYearId=y26')
  })
})

describe('la URL de la pantalla', () => {
  it('cambia lo pedido, saca lo que va en null y deja el resto', () => {
    expect(nextQuery('seccion=asistencia&lista=faltas&boletin=e2', { seccion: 'riesgo', lista: null })).toBe('seccion=riesgo&boletin=e2')
    expect(nextQuery('', { motivo: 'notas', lista: null })).toBe('motivo=notas')
  })
})

describe('el informe descargable', () => {
  it('del ciclo del menú y el boletín elegido', () => {
    expect(indicatorReportPath({ query: 'schoolYearId=y26', period: { id: 'e2' } }, 'pdf')).toBe(
      '/admin/student-indicators/report?format=pdf&periodId=e2&schoolYearId=y26',
    )
  })

  it('sin boletines todavía, sólo el ciclo', () => {
    expect(indicatorReportPath({ query: '', period: null }, 'xlsx')).toBe('/admin/student-indicators/report?format=xlsx')
  })
})
