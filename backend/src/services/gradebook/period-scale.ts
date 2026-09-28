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
