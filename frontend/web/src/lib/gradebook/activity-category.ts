/**
 * Columnas de la planilla del liceo en las que cae cada nota suelta de un tramo:
 * Or (orales) · Otras · Ev (escritos) · Prueba.
 *
 * La columna la define el tipo de actividad (`ActivityType.category`, editable en la
 * configuración). Si la API no la trae, se deduce del código del catálogo.
 *
 * Acá no se promedia nada: en la planilla cada celda tiene las notas sueltas, y la calificación
 * del período (C) la decide el docente.
 */

export type ActivityCategory = 'oral' | 'other' | 'written' | 'test'

/** Código de la API (`ActivityCategory` de Prisma). */
export type ActivityCategoryCode = 'ORAL' | 'OTRAS' | 'ESCRITO' | 'PRUEBA'

/** Orden de las columnas en la planilla. */
export const ACTIVITY_CATEGORY_ORDER: readonly ActivityCategory[] = ['oral', 'other', 'written', 'test']

const FROM_CODE: Record<ActivityCategoryCode, ActivityCategory> = {
  ORAL: 'oral',
  OTRAS: 'other',
  ESCRITO: 'written',
  PRUEBA: 'test',
}

export const CATEGORY_CODE: Record<ActivityCategory, ActivityCategoryCode> = {
  oral: 'ORAL',
  other: 'OTRAS',
  written: 'ESCRITO',
  test: 'PRUEBA',
}

const ORAL_TYPE_CODES = new Set(['ORAL', 'EXPOSICION', 'PARTICIPACION'])

export function activityCategory(
  type: { code?: string | null; category?: string | null } | null | undefined,
): ActivityCategory {
  const fromApi = FROM_CODE[(type?.category ?? '') as ActivityCategoryCode]
  if (fromApi) return fromApi
  const code = (type?.code || '').trim().toUpperCase()
  if (ORAL_TYPE_CODES.has(code)) return 'oral'
  if (code === 'ESCRITO') return 'written'
  if (code === 'PRUEBA') return 'test'
  return 'other'
}

/** Rótulo corto, el de la planilla. */
export const ACTIVITY_CATEGORY_LABEL: Record<ActivityCategory, string> = {
  oral: 'Or',
  other: 'Otras',
  written: 'Ev',
  test: 'Prueba',
}

/** Nombre completo, para `title` / `aria-label` y los formularios. */
export const ACTIVITY_CATEGORY_TITLE: Record<ActivityCategory, string> = {
  oral: 'Orales',
  other: 'Otras actividades',
  written: 'Evaluaciones escritas',
  test: 'Prueba semestral',
}
