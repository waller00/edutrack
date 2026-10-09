import type { Request, Response, NextFunction } from 'express'
import { requirePermission, userPermissionScope } from './auth.js'

// El selector compartido necesita el catálogo, sin habilitar la gestión ni las métricas del ciclo.
const CATALOG_PERMISSIONS: Array<[string, 'own' | 'all']> = [
  ['school-years.manage', 'all'],
  ['gradebook.read', 'own'],
  ['courses.read', 'own'],
  ['attendance.read', 'all'],
  ['events.read', 'all'],
  ['licenses.read', 'all'],
  ['students.manage', 'all'],
  ['student-attendance.read', 'all'],
  ['academic-config.manage', 'all'],
  ['academic-analytics.read', 'all'],
  ['student-reports.read', 'all'],
]

const requireManagement = requirePermission('school-years.manage', 'all')

export async function requireSchoolYearAccess(req: Request, res: Response, next: NextFunction) {
  const path = req.path.toLowerCase().replace(/\/+$/, '')
  const catalog = (req.method === 'GET' || req.method === 'HEAD') && (path === '' || path === '/active')
  if (!catalog) return requireManagement(req, res, next)

  const user = (req as any).user
  const userId = user?.id ?? user?.sub
  if (!userId) return res.status(403).json({ message: 'Prohibido' })
  try {
    for (const [permission, requiredScope] of CATALOG_PERMISSIONS) {
      const scope = await userPermissionScope(userId, permission, user.role)
      if (scope && (requiredScope === 'own' || scope === 'all')) return next()
    }
  } catch {
    return res.status(403).json({ message: 'Prohibido' })
  }
  return res.status(403).json({ message: 'Prohibido' })
}
