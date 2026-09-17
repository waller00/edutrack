import { isWithinLevel } from "./grade-value.js";

/**
 * Invariantes de la parametrización académica.
 *
 * Se validan acá y no en la ruta porque son reglas del dominio, no del transporte: una escala con
 * tramos solapados produce descriptores ambiguos (RF-053) y un semáforo que depende del orden de
 * lectura de las filas. Mejor rechazarla al configurarla que descubrirlo al calificar.
 */

export class AcademicConfigError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export type ScaleLevelInput = {
  code: string;
  minValueHundredths: number;
  maxValueHundredths: number;
};

export type ScaleRange = {
  minValueHundredths: number | null;
  maxValueHundredths: number | null;
};

function assertRangesWellFormed(levels: readonly ScaleLevelInput[]) {
  for (const level of levels) {
    if (level.minValueHundredths > level.maxValueHundredths) {
      throw new AcademicConfigError(
        400,
        "LEVEL_RANGE_INVERTED",
        `El tramo "${level.code}" tiene el mínimo por encima del máximo.`,
      );
    }
  }
}

function assertNoOverlap(sorted: readonly ScaleLevelInput[]) {
  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1];
    const current = sorted[i];
    if (current.minValueHundredths <= previous.maxValueHundredths) {
      throw new AcademicConfigError(
        400,
        "LEVELS_OVERLAP",
        `Los tramos "${previous.code}" y "${current.code}" se solapan.`,
      );
    }
  }
}

function assertWithinScale(sorted: readonly ScaleLevelInput[], scale: ScaleRange) {
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (scale.minValueHundredths != null && first.minValueHundredths < scale.minValueHundredths) {
    throw new AcademicConfigError(
      400,
      "LEVEL_OUT_OF_SCALE",
      `El tramo "${first.code}" empieza por debajo del mínimo de la escala.`,
    );
  }
  if (scale.maxValueHundredths != null && last.maxValueHundredths > scale.maxValueHundredths) {
    throw new AcademicConfigError(
      400,
      "LEVEL_OUT_OF_SCALE",
      `El tramo "${last.code}" termina por encima del máximo de la escala.`,
    );
  }
}

/**
 * Valida el conjunto de tramos de una escala: rangos bien formados, sin solapes y dentro del
 * rango declarado. **No** exige cubrir la escala entera: una escala puede dejar huecos a
 * propósito mientras se está configurando; el hueco se detecta al resolver un valor
 * (`resolveLevel` devuelve `null`) y lo reporta `findScaleGaps`.
 */
export function assertLevelsCoverScale(levels: readonly ScaleLevelInput[], scale: ScaleRange): void {
  if (levels.length === 0) return;
  assertRangesWellFormed(levels);
  const sorted = [...levels].sort((a, b) => a.minValueHundredths - b.minValueHundredths);
  assertNoOverlap(sorted);
  assertWithinScale(sorted, scale);
}

/** Tramos de valor que ninguna fila cubre, para avisar en la UI sin bloquear el guardado. */
export function findScaleGaps(
  levels: readonly ScaleLevelInput[],
  scale: ScaleRange,
): Array<{ fromHundredths: number; toHundredths: number }> {
  if (scale.minValueHundredths == null || scale.maxValueHundredths == null) return [];
  const sorted = [...levels].sort((a, b) => a.minValueHundredths - b.minValueHundredths);
  const gaps: Array<{ fromHundredths: number; toHundredths: number }> = [];
  let cursor = scale.minValueHundredths;

  for (const level of sorted) {
    if (level.minValueHundredths > cursor) {
      gaps.push({ fromHundredths: cursor, toHundredths: level.minValueHundredths - 1 });
    }
    cursor = Math.max(cursor, level.maxValueHundredths + 1);
  }
  if (cursor <= scale.maxValueHundredths) {
    gaps.push({ fromHundredths: cursor, toHundredths: scale.maxValueHundredths });
  }
  return gaps;
}

/** Un valor concreto sólo es válido si algún tramo lo cubre. */
export function hasLevelFor(hundredths: number, levels: readonly ScaleLevelInput[]): boolean {
  return levels.some((level) => isWithinLevel(hundredths, level));
}
