import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db/prisma.js'
import { resolveSchoolYearIdForList } from '../services/school-year-service.js'
import { alertRulesForYear } from '../services/gradebook/alert-rules.js'
import { loadTrajectory } from '../services/student-indicators/loaders.js'
import { triggeredAlerts, type AnalyticsPeriod, type AnalyticsState } from '../services/gradebook/analytics.js'
import {
  academicFiltersSchema,
  loadAcademicComparison,
  loadAcademicDashboard,
  loadSnapshot,
  scaleFor,
  type AcademicFilters,
  type ComparisonDimension,
} from '../services/student-indicators/academic.js'

/**
 * Backoffice de inteligencia académica (§5); en pantalla, la sección Rendimiento de "Indicadores
 * de estudiantes".
 *
 * Montado bajo `/admin/academic-analytics` con `academic-analytics.read` de alcance ALL. Lee del
 * mismo esquema transaccional: a escala de un liceo no compensa el repositorio analítico aparte
 * que sugiere §5.10, y evita que un indicador quede desfasado del dato que lo originó.
 *
 * Todo se mira **por nivel** y contra **una reunión**: ciclo básico califica de 1 a 10 y
 * bachillerato de 1 a 12, así que un promedio que los junta no significa nada, y un promedio que
 * junta el diagnóstico con febrero tampoco.
 */

const r = Router()

const filtersSchema = academicFiltersSchema
type Filters = AcademicFilters

/** El ciclo pedido, si existe; si no, el activo. El router exige alcance `all`: se elige el ciclo. */
async function schoolYearOf(req: any, filters: Filters): Promise<string | null> {
  return resolveSchoolYearIdForList(prisma, { role: req.user?.role, requestedSchoolYearId: filters.schoolYearId, institutionWide: true })
}

function levelRequired(res: any, levels: string[]) {
  return res.status(400).json({
    message: 'Elegí un nivel: ciclo básico (1 a 10) y bachillerato (1 a 12) no se promedian juntos.',
    code: 'LEVEL_REQUIRED',
    levels,
  })
}

/** Dashboard principal (§5.1). */
r.get('/dashboard', async (req: any, res) => {
  const parsed = filtersSchema.safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ message: 'Parámetros inválidos', errors: parsed.error.errors })

  try {
    const schoolYearId = await schoolYearOf(req, parsed.data)
    if (!schoolYearId) return res.status(400).json({ message: 'No hay ciclo lectivo activo' })

    const dashboard = await loadAcademicDashboard(parsed.data, schoolYearId)
    if ('ambiguous' in dashboard) return levelRequired(res, dashboard.ambiguous)
    return res.json(dashboard)
  } catch (error) {
    console.error('[academic-analytics] dashboard:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

const comparisonSchema = filtersSchema.extend({
  dimension: z.enum(['YEAR', 'COURSE', 'SUBJECT']),
  schoolYearIds: z.string().optional(),
})

/** Comparativas por año, curso o asignatura (§5.3, §5.4, §5.5, RF-200), siempre dentro de un nivel. */
r.get('/comparison', async (req: any, res) => {
  const parsed = comparisonSchema.safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ message: 'Parámetros inválidos', errors: parsed.error.errors })

  try {
    const d = parsed.data
    const years = d.schoolYearIds
      ? d.schoolYearIds.split(',').filter(Boolean)
      : [await schoolYearOf(req, d)].filter((id): id is string => Boolean(id))
    if (years.length === 0) return res.status(400).json({ message: 'No hay ciclo lectivo activo' })

    const comparison = await loadAcademicComparison({ ...d, dimension: d.dimension as ComparisonDimension, years })
    if ('ambiguous' in comparison) return levelRequired(res, comparison.ambiguous)
    return res.json(comparison)
  } catch (error) {
    console.error('[academic-analytics] comparison:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

/**
 * Trayectoria: cómo terminó el año cada curso (promoción, repetición, egreso, bajas, quienes no se
 * reinscribieron), año a año, y qué pasó con cada generación. Se deriva al leer de las matrículas.
 */
r.get('/trajectory', async (req: any, res) => {
  const parsed = filtersSchema.pick({ schoolYearId: true }).safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ message: 'Parámetros inválidos', errors: parsed.error.errors })
  try {
    const schoolYearId = await schoolYearOf(req, parsed.data)
    return res.json(await loadTrajectory(schoolYearId))
  } catch (error) {
    console.error('[academic-analytics] trajectory:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

/** Celdas Estudiante × Materia en la reunión de referencia. */
function cellsAtReference(states: readonly AnalyticsState[], subjectOf: ReadonlyMap<string, string>, reference: AnalyticsPeriod | null) {
  const perStudent = new Map<string, { lastName: string; firstName: string; bySubject: Map<string, number | null> }>()
  for (const state of states.filter((s) => s.period.id === reference?.id)) {
    const subjectId = subjectOf.get(state.gradeBookId)
    if (!subjectId) continue
    for (const grade of state.grades) {
      const entry = perStudent.get(grade.studentId) ?? { lastName: grade.lastName, firstName: grade.firstName, bySubject: new Map() }
      entry.bySubject.set(subjectId, grade.value)
      perStudent.set(grade.studentId, entry)
    }
  }
  return perStudent
}

/** Matriz de riesgo Estudiantes × Materias (§5.8), en la reunión de referencia. */
r.get('/risk-matrix', async (req: any, res) => {
  const parsed = filtersSchema.safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ message: 'Parámetros inválidos', errors: parsed.error.errors })

  try {
    const schoolYearId = await schoolYearOf(req, parsed.data)
    if (!schoolYearId) return res.status(400).json({ message: 'No hay ciclo lectivo activo' })

    const snapshot = await loadSnapshot(parsed.data, schoolYearId)
    if ('ambiguous' in snapshot) return levelRequired(res, snapshot.ambiguous)
    const { level, books, states, reference } = snapshot

    const [{ levels }, rules] = await Promise.all([scaleFor(level), alertRulesForYear(schoolYearId)])
    const subjects = [...new Map(books.map((gb) => [gb.subjectId, gb.subject])).values()]
    const perStudent = cellsAtReference(states, new Map(books.map((gb) => [gb.id, gb.subjectId])), reference)

    const students = [...perStudent.entries()]
      .map(([studentId, entry]) => {
        const cells = subjects.map((subject) => entry.bySubject.get(subject.id) ?? null)
        const alerts = triggeredAlerts(
          {
            studentId,
            lastName: entry.lastName,
            firstName: entry.firstName,
            subjectValues: cells,
            periodValues: [],
            assessmentCount: cells.filter((c) => c != null).length,
          },
          rules,
          levels,
        )
        return { studentId, lastName: entry.lastName, firstName: entry.firstName, cells, alerts }
      })
      .sort((a, b) => a.lastName.localeCompare(b.lastName, 'es'))

    return res.json({
      level,
      referencePeriod: reference ? { id: reference.id, name: reference.name } : null,
      subjects,
      students,
      levels,
    })
  } catch (error) {
    console.error('[academic-analytics] risk-matrix:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

export default r
