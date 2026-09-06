/**
 * Conversión entre el valor de calificación que ve el usuario (8; 7,5) y el que guarda la BD
 * (centésimos: 800; 750).
 *
 * Los enteros evitan el arrastre del punto flotante, que en una escala de notas no es cosmético:
 * con `Float`, 7,3 se almacena como 7,2999… y un umbral de alerta `>= 7,3` deja de dispararse.
 * Es la misma decisión que ya tomó el repo con `StudentTuitionYear.amountCents`.
 */

export const HUNDREDTHS = 100;

/** Máximo representable: cubre cualquier escala académica y frena entradas absurdas. */
const MAX_ABS_HUNDREDTHS = 100_000;

/** `8` → `800`. Devuelve `null` si el valor no es un número finito o se va de rango. */
export function toHundredths(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const scaled = Math.round(value * HUNDREDTHS);
  if (Math.abs(scaled) > MAX_ABS_HUNDREDTHS) return null;
  return scaled;
}

/** `800` → `8`. */
export function fromHundredths(hundredths: number | null | undefined): number | null {
  if (hundredths == null || !Number.isFinite(hundredths)) return null;
  return hundredths / HUNDREDTHS;
}

/**
 * Texto para mostrar, con los decimales que declara la escala y coma decimal (es-UY).
 * `formatGradeValue(750, 1)` → `"7,5"`.
 */
export function formatGradeValue(hundredths: number | null | undefined, decimals = 0): string | null {
  const value = fromHundredths(hundredths);
  if (value == null) return null;
  return value.toFixed(Math.max(0, Math.min(2, decimals))).replace(".", ",");
}

/**
 * ¿El valor cae dentro del tramo? Ambos extremos son inclusivos, así que los tramos de una
 * escala deben ser contiguos sin solaparse (lo valida `assertLevelsCoverScale`).
 */
export function isWithinLevel(
  hundredths: number,
  level: { minValueHundredths: number; maxValueHundredths: number },
): boolean {
  return hundredths >= level.minValueHundredths && hundredths <= level.maxValueHundredths;
}

/**
 * Tramo que corresponde a un valor: es lo que produce el descriptor automático (RF-053) y el
 * color/icono del semáforo. `null` si ningún tramo lo cubre (escala incompleta).
 */
export function resolveLevel<T extends { minValueHundredths: number; maxValueHundredths: number }>(
  hundredths: number | null | undefined,
  levels: readonly T[],
): T | null {
  if (hundredths == null) return null;
  return levels.find((level) => isWithinLevel(hundredths, level)) ?? null;
}
