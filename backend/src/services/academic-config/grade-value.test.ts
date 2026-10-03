import { describe, expect, it } from "vitest";
import {
  formatGradeValue,
  fromHundredths,
  isWithinLevel,
  resolveLevel,
  toHundredths,
} from "./grade-value.js";

const LEVELS = [
  { code: "rojo", minValueHundredths: 100, maxValueHundredths: 499 },
  { code: "amarillo", minValueHundredths: 500, maxValueHundredths: 699 },
  { code: "verde", minValueHundredths: 700, maxValueHundredths: 1000 },
];

describe("toHundredths / fromHundredths", () => {
  it("hace ida y vuelta sin perder el decimal", () => {
    expect(toHundredths(7.3)).toBe(730);
    expect(fromHundredths(730)).toBe(7.3);
  });

  it("compara exacto donde el float falla", () => {
    // Un 5,1 con una décima de bonificación debería dar 5,2; en float da 5,199999… y el umbral
    // `>= 5,2` no se dispara. En centésimos la comparación es exacta.
    const composed = 5.1 + 0.1;
    expect(composed >= 5.2).toBe(false);
    expect(toHundredths(composed)! >= toHundredths(5.2)!).toBe(true);
  });

  it("redondea al centésimo más cercano", () => {
    expect(toHundredths(7.256)).toBe(726);
    expect(toHundredths(7.254)).toBe(725);
  });

  it("devuelve null ante valores no representables", () => {
    expect(toHundredths(null)).toBeNull();
    expect(toHundredths(undefined)).toBeNull();
    expect(toHundredths(Number.NaN)).toBeNull();
    expect(toHundredths(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toHundredths(9_999_999)).toBeNull();
  });
});

describe("formatGradeValue", () => {
  it("usa coma decimal y los decimales de la escala", () => {
    expect(formatGradeValue(750, 1)).toBe("7,5");
    expect(formatGradeValue(800, 0)).toBe("8");
    expect(formatGradeValue(725, 2)).toBe("7,25");
  });

  it("acota los decimales pedidos a [0, 2]", () => {
    expect(formatGradeValue(800, -3)).toBe("8");
    expect(formatGradeValue(800, 9)).toBe("8,00");
  });

  it("devuelve null si no hay valor", () => {
    expect(formatGradeValue(null)).toBeNull();
  });
});

describe("resolveLevel", () => {
  it("resuelve el tramo, con extremos inclusivos", () => {
    expect(resolveLevel(700, LEVELS)?.code).toBe("verde");
    expect(resolveLevel(699, LEVELS)?.code).toBe("amarillo");
    expect(resolveLevel(1000, LEVELS)?.code).toBe("verde");
  });

  it("devuelve null fuera de todo tramo o sin valor", () => {
    expect(resolveLevel(50, LEVELS)).toBeNull();
    expect(resolveLevel(null, LEVELS)).toBeNull();
  });

  it("isWithinLevel respeta ambos bordes", () => {
    expect(isWithinLevel(500, LEVELS[1])).toBe(true);
    expect(isWithinLevel(499, LEVELS[1])).toBe(false);
  });
});
