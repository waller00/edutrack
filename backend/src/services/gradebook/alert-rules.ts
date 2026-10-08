import { prisma } from '../../db/prisma.js'
import type { AlertRule } from './analytics.js'

/**
 * Umbrales de alerta académica (§5.7, RF-200).
 *
 * Los usan la matriz de reunión ("en alerta") e Inteligencia académica, que tienen que contar lo
 * mismo. Hasta ahora no coincidían: la matriz usaba un 3 fijo y los indicadores sólo las reglas
 * cargadas en la base, que no había ninguna, así que ahí nunca nadie estaba en alerta.
 */

export type AlertRuleType = AlertRule['type']

export const ALERT_RULE_TYPES: readonly AlertRuleType[] = ['ALERT_SUBJECTS', 'SCORE_DROP', 'NO_ASSESSMENTS']

/**
 * Lo que rige sin ninguna regla cargada. Asignaturas en alerta con 3 es lo que la matriz usó
 * siempre; las otras dos arrancan apagadas para que "en alerta" signifique lo mismo en la reunión
 * y en los indicadores hasta que administración decida otra cosa.
 */
export const DEFAULT_ALERT_RULES: Record<AlertRuleType, { threshold: number; isActive: boolean }> = {
  ALERT_SUBJECTS: { threshold: 3, isActive: true },
  SCORE_DROP: { threshold: 200, isActive: false },
  NO_ASSESSMENTS: { threshold: 0, isActive: false },
}

/** Rango admitido por tipo, en su unidad: asignaturas, o centésimos para la caída. */
export const ALERT_RULE_LIMITS: Record<AlertRuleType, { min: number; max: number }> = {
  ALERT_SUBJECTS: { min: 1, max: 30 },
  SCORE_DROP: { min: 10, max: 1200 },
  NO_ASSESSMENTS: { min: 0, max: 0 },
}

export type AlertRuleSource = 'YEAR' | 'GENERAL' | 'DEFAULT'

export type EffectiveAlertRule = {
  type: AlertRuleType
  threshold: number
  isActive: boolean
  /** De dónde sale: regla del ciclo, regla general o el valor por defecto. */
  source: AlertRuleSource
}

type RuleRow = { type: string; schoolYearId: string | null; threshold: number; isActive: boolean }

/**
 * Regla vigente de cada tipo para un ciclo: la del ciclo pisa a la general, y la general al valor
 * por defecto. Así una comparativa histórica se evalúa con el umbral que regía ese año y no cambia
 * sola cuando alguien mueve el actual. Una regla apagada también pisa: apagar la alerta en un
 * ciclo no puede dejar que se cuele la general.
 */
export function resolveAlertRules(rows: readonly RuleRow[], schoolYearId: string): EffectiveAlertRule[] {
  return ALERT_RULE_TYPES.map((type) => {
    const own = rows.find((row) => row.type === type && row.schoolYearId === schoolYearId)
    const general = rows.find((row) => row.type === type && row.schoolYearId === null)
    const picked = own ?? general
    if (!picked) return { type, ...DEFAULT_ALERT_RULES[type], source: 'DEFAULT' }
    return { type, threshold: picked.threshold, isActive: picked.isActive, source: own ? 'YEAR' : 'GENERAL' }
  })
}

export async function loadAlertRules(schoolYearId: string): Promise<EffectiveAlertRule[]> {
  const rows = await prisma.academicAlertRule.findMany({
    where: { OR: [{ schoolYearId }, { schoolYearId: null }] },
    select: { type: true, schoolYearId: true, threshold: true, isActive: true },
  })
  return resolveAlertRules(rows, schoolYearId)
}

/** Reglas activas del ciclo, en la forma que usa la analítica. */
export async function alertRulesForYear(schoolYearId: string): Promise<AlertRule[]> {
  const rules = await loadAlertRules(schoolYearId)
  return rules.filter((rule) => rule.isActive).map(({ type, threshold }) => ({ type, threshold }))
}

/** Cantidad de asignaturas en alerta que marca a un estudiante; infinito si la regla está apagada. */
export function alertSubjectsThreshold(rules: readonly AlertRule[]): number {
  return rules.find((rule) => rule.type === 'ALERT_SUBJECTS')?.threshold ?? Number.POSITIVE_INFINITY
}
