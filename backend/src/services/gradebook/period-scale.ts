import { prisma } from '../../db/prisma.js'
import { PERIOD_SCALE_CODE_BY_LEVEL } from './period-closure.js'

const SCALE_INCLUDE = { levels: { orderBy: { sortOrder: 'asc' as const } } }

/**
 * Escala de C y R del nivel (1–10 en EBI, 1–12 en EMS). Los descriptores, el semáforo y la
 * definición de "nota baja" salen de ella; si no está sembrada, cae en la primera escala activa.
 */
export async function periodScaleFor(level: string | null | undefined) {
  const code = PERIOD_SCALE_CODE_BY_LEVEL[level === 'EMS' ? 'EMS' : 'EBI']
  const byLevel = await prisma.gradingScale.findFirst({ where: { isActive: true, code }, include: SCALE_INCLUDE })
  if (byLevel) return byLevel
  return prisma.gradingScale.findFirst({ where: { isActive: true }, include: SCALE_INCLUDE, orderBy: { sortOrder: 'asc' } })
}

/** Escala de conducta: la del docente en su asignatura y la institucional de adscripción. */
export const CONDUCT_SCALE_CODE = 'CONDUCTA'

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
