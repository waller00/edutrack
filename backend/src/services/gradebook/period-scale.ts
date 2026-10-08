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
 * La escala de conducta, aunque esté desactivada: las notas ya puestas tienen que seguir
 * leyéndose con su texto. Las etiquetas salen de acá y no de una tabla escrita en el código, así
 * un cambio en Configuración llega a la reunión y al boletín.
 */
export async function conductScale() {
  return prisma.gradingScale.findFirst({ where: { code: CONDUCT_SCALE_CODE }, include: SCALE_INCLUDE })
}

/** Texto de una nota de conducta; el número si no cae en ningún tramo (nunca sólo un color). */
export function conductLabel(value: number | null | undefined, levels: readonly ConductLevel[]): string | null {
  if (value == null) return null
  const level = levels.find((l) => value >= l.minValueHundredths && value <= l.maxValueHundredths)
  return level?.label ?? String(value / 100).replace('.', ',')
}

/** Lo que se ofrece al elegir la conducta: un valor por tramo, en el orden de la escala. */
export function conductOptions(levels: readonly ConductLevel[]): Array<{ valueHundredths: number; label: string }> {
  return levels.map((level) => ({ valueHundredths: level.minValueHundredths, label: level.label }))
}

/** ¿El valor cae en algún tramo de la escala? `null` (borrar) siempre vale. */
export function isConductValue(value: number | null | undefined, levels: readonly ConductLevel[]): boolean {
  if (value == null) return true
  return levels.some((l) => value >= l.minValueHundredths && value <= l.maxValueHundredths)
}
