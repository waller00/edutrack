import { prisma } from '../../db/prisma.js'
import { PERIOD_SCALE_CODE_BY_LEVEL } from './period-closure.js'

const SCALE_INCLUDE = { levels: { orderBy: { sortOrder: 'asc' as const } } }

/**
 * Escala de C y R del nivel (1–10 en EBI, 1–12 en EMS). Los descriptores, el semáforo y la
 * definición de "nota baja" salen de ella. Se lee aunque esté desactivada, igual que al calificar
 * (`loadPeriodScale`): sólo si nunca se sembró cae en la primera escala activa.
 */
export async function periodScaleFor(level: string | null | undefined) {
  const code = PERIOD_SCALE_CODE_BY_LEVEL[level === 'EMS' ? 'EMS' : 'EBI']
  const byLevel = await prisma.gradingScale.findFirst({ where: { code }, include: SCALE_INCLUDE })
  if (byLevel) return byLevel
  return prisma.gradingScale.findFirst({ where: { isActive: true }, include: SCALE_INCLUDE, orderBy: { sortOrder: 'asc' } })
}

/** Escala de conducta: la del docente en su asignatura y la institucional de adscripción. */
export const CONDUCT_SCALE_CODE = 'CONDUCTA'

/**
 * Escalas que la libreta busca por código, con lo que hace con cada una. Configuración no las
 * deja desactivar ni quedarse sin rango o sin tramos (`assertGradebookScaleKept`): la libreta no
 * tiene con qué reemplazarlas.
 */
const GRADEBOOK_SCALE_ROLES = new Map<string, string>([
  [PERIOD_SCALE_CODE_BY_LEVEL.EBI, 'C y R de ciclo básico'],
  [PERIOD_SCALE_CODE_BY_LEVEL.EMS, 'C y R de bachillerato'],
  [CONDUCT_SCALE_CODE, 'la conducta'],
])

/** Para qué usa la libreta esta escala, o `null` si es una escala más de evaluaciones. */
export function gradebookScaleRole(code: string): string | null {
  return GRADEBOOK_SCALE_ROLES.get(code) ?? null
}

type ConductLevel = { minValueHundredths: number; maxValueHundredths: number; label: string }

/**
 * La escala de conducta se consulta también para las exportaciones y la configuración.
 */
export async function conductScale() {
  return prisma.gradingScale.findFirst({ where: { code: CONDUCT_SCALE_CODE }, include: SCALE_INCLUDE })
}

/** La conducta es una nota numérica; las etiquetas antiguas no son juicios de conducta. */
export function conductLabel(value: number | null | undefined, _levels: readonly ConductLevel[]): string | null {
  if (value == null) return null
  return String(value / 100).replace('.', ',')
}

/** Notas enteras del 1 al 10, incluso si todavía está sembrada la antigua escala ordinal. */
export function conductOptions(_levels: readonly ConductLevel[]): Array<{ valueHundredths: number; label: string }> {
  return Array.from({ length: 10 }, (_, i) => ({ valueHundredths: (i + 1) * 100, label: String(i + 1) }))
}

/** Conducta del 1 al 10, sin decimales. `null` (borrar) siempre vale. */
export function isConductValue(value: number | null | undefined, _levels: readonly ConductLevel[]): boolean {
  if (value == null) return true
  return Number.isInteger(value) && value >= 100 && value <= 1000 && value % 100 === 0
}
