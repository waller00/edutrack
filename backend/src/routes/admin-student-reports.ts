import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db/prisma.js'
import { resolveSchoolYearIdForList } from '../services/school-year-service.js'
import {
  loadAbsenceStreaks,
  loadAbsenceThresholds,
  loadGradeDrops,
  loadLowGrades,
} from '../services/student-reports/reports.js'
import { loadAttendanceTrend, loadRisk, loadSubjectsApe } from '../services/student-indicators/loaders.js'

/**
 * Reportes de estudiantes para adscripción, dirección y administración.
 *
 * Montado bajo `/admin/student-reports` con `student-reports.read` de alcance ALL. Todo se deriva
 * al leer; lo único persistido son las alertas ya avisadas (`GET /alerts`).
 */
const r = Router()

const periodQuery = z.object({ periodId: z.string().uuid() })
const alertsQuery = z.object({ type: z.enum(['GRADE_DROP', 'ABSENCE_STREAK', 'ABSENCE_THRESHOLD']).optional() })
const riskQuery = z.object({ periodId: z.string().uuid().optional() })

async function schoolYearOf(req: any): Promise<string | null> {
  return resolveSchoolYearIdForList(prisma, {
    role: req.user?.role,
    // Montado con alcance `all`: quien llega ve todo el centro y elige el ciclo.
    institutionWide: true,
    requestedSchoolYearId: req.query.schoolYearId ? String(req.query.schoolYearId) : undefined,
  })
}

function fail(res: any, label: string, error: unknown) {
  console.error(`[student-reports] ${label}:`, error)
  return res.status(500).json({ message: 'Error interno del servidor' })
}

/** % de alumnos con nota baja por materia y curso, en una reunión de boletín. */
r.get('/low-grades', async (req: any, res) => {
  const parsed = periodQuery.safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ message: 'Falta el período de boletín' })
  try {
    const result = await loadLowGrades(parsed.data.periodId!)
    if (!result) return res.status(404).json({ message: 'No es una reunión de boletín' })
    return res.json(result)
  } catch (error) {
    return fail(res, 'low-grades', error)
  }
})

/** Materias en las que la R bajó respecto del boletín anterior. */
r.get('/grade-drops', async (req: any, res) => {
  const parsed = periodQuery.safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ message: 'Falta el período de boletín' })
  try {
    const result = await loadGradeDrops(parsed.data.periodId!)
    if (!result) return res.status(404).json({ message: 'No es una reunión de boletín' })
    return res.json(result)
  } catch (error) {
    return fail(res, 'grade-drops', error)
  }
})

/** Rachas de 3 o más días de clase seguidos con falta entera sin justificar. */
r.get('/absence-streaks', async (req: any, res) => {
  try {
    const schoolYearId = await schoolYearOf(req)
    if (!schoolYearId) return res.status(400).json({ message: 'No hay ciclo lectivo activo' })
    return res.json({ data: await loadAbsenceStreaks(schoolYearId) })
  } catch (error) {
    return fail(res, 'absence-streaks', error)
  }
})

/** Estudiantes con 18 faltas o más (y los que ya pasaron las 25). */
r.get('/absence-thresholds', async (req: any, res) => {
  try {
    const schoolYearId = await schoolYearOf(req)
    if (!schoolYearId) return res.status(400).json({ message: 'No hay ciclo lectivo activo' })
    return res.json({ data: await loadAbsenceThresholds(schoolYearId) })
  } catch (error) {
    return fail(res, 'absence-thresholds', error)
  }
})

/**
 * Asistencia por mes y por curso, contada por día como el boletín: días con lista, con falta
 * (justificadas aparte) y con llegada tarde. Los porcentajes los calcula la pantalla.
 */
r.get('/attendance-trend', async (req: any, res) => {
  try {
    const schoolYearId = await schoolYearOf(req)
    if (!schoolYearId) return res.status(400).json({ message: 'No hay ciclo lectivo activo' })
    return res.json(await loadAttendanceTrend(schoolYearId))
  } catch (error) {
    return fail(res, 'attendance-trend', error)
  }
})

/** Quién necesita atención por notas y por faltas, con los motivos de cada uno. */
r.get('/risk', async (req: any, res) => {
  const parsed = riskQuery.safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ message: 'Boletín inválido' })
  try {
    const schoolYearId = await schoolYearOf(req)
    if (!schoolYearId) return res.status(400).json({ message: 'No hay ciclo lectivo activo' })
    return res.json(await loadRisk(schoolYearId, parsed.data.periodId))
  } catch (error) {
    return fail(res, 'risk', error)
  }
})

/** Qué pasó con las materias que fueron a APE, y quiénes deben materias de años anteriores. */
r.get('/subjects-ape', async (req: any, res) => {
  try {
    const schoolYearId = await schoolYearOf(req)
    if (!schoolYearId) return res.status(400).json({ message: 'No hay ciclo lectivo activo' })
    return res.json(await loadSubjectsApe(schoolYearId))
  } catch (error) {
    return fail(res, 'subjects-ape', error)
  }
})

/** Alertas ya detectadas y avisadas, las más recientes primero. */
r.get('/alerts', async (req: any, res) => {
  const parsed = alertsQuery.safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ message: 'Tipo de alerta inválido' })
  try {
    const schoolYearId = await schoolYearOf(req)
    if (!schoolYearId) return res.status(400).json({ message: 'No hay ciclo lectivo activo' })
    const data = await prisma.studentAlert.findMany({
      where: { schoolYearId, ...(parsed.data.type ? { type: parsed.data.type } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 300,
      select: { id: true, type: true, studentId: true, key: true, payload: true, createdAt: true },
    })
    return res.json({ data })
  } catch (error) {
    return fail(res, 'alerts', error)
  }
})

export default r
