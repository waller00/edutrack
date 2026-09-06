import { describe, expect, it } from "vitest";
import {
  AcademicConfigError,
  assertLevelsCoverScale,
  findScaleGaps,
  hasLevelFor,
} from "./validation.js";

const SCALE = { minValueHundredths: 100, maxValueHundredths: 1000 };

const OK = [
  { code: "insuficiente", minValueHundredths: 100, maxValueHundredths: 499 },
  { code: "aceptable", minValueHundredths: 500, maxValueHundredths: 699 },
  { code: "logrado", minValueHundredths: 700, maxValueHundredths: 1000 },
];

describe("assertLevelsCoverScale", () => {
  it("acepta tramos contiguos dentro de la escala", () => {
    expect(() => assertLevelsCoverScale(OK, SCALE)).not.toThrow();
  });

  it("acepta una escala sin tramos todavía", () => {
    expect(() => assertLevelsCoverScale([], SCALE)).not.toThrow();
  });

  it("rechaza un tramo invertido", () => {
    const levels = [{ code: "raro", minValueHundredths: 700, maxValueHundredths: 300 }];
    expect(() => assertLevelsCoverScale(levels, SCALE)).toThrow(AcademicConfigError);
    try {
      assertLevelsCoverScale(levels, SCALE);
    } catch (error) {
      expect((error as AcademicConfigError).code).toBe("LEVEL_RANGE_INVERTED");
    }
  });

  it("rechaza tramos solapados aunque vengan desordenados", () => {
    const levels = [
      { code: "b", minValueHundredths: 600, maxValueHundredths: 1000 },
      { code: "a", minValueHundredths: 100, maxValueHundredths: 700 },
    ];
    try {
      assertLevelsCoverScale(levels, SCALE);
      throw new Error("debió lanzar");
    } catch (error) {
      expect((error as AcademicConfigError).code).toBe("LEVELS_OVERLAP");
    }
  });

  it("rechaza un tramo fuera del rango de la escala", () => {
    const levels = [{ code: "x", minValueHundredths: 0, maxValueHundredths: 1000 }];
    try {
      assertLevelsCoverScale(levels, SCALE);
      throw new Error("debió lanzar");
    } catch (error) {
      expect((error as AcademicConfigError).code).toBe("LEVEL_OUT_OF_SCALE");
    }
  });

  it("no exige rango cuando la escala no lo declara (ordinal)", () => {
    const open = { minValueHundredths: null, maxValueHundredths: null };
    expect(() => assertLevelsCoverScale(OK, open)).not.toThrow();
  });
});

describe("findScaleGaps", () => {
  it("no reporta huecos cuando los tramos cubren todo", () => {
    expect(findScaleGaps(OK, SCALE)).toEqual([]);
  });

  it("reporta el hueco del medio", () => {
    const levels = [OK[0], OK[2]];
    expect(findScaleGaps(levels, SCALE)).toEqual([{ fromHundredths: 500, toHundredths: 699 }]);
  });

  it("reporta la cola sin cubrir", () => {
    expect(findScaleGaps([OK[0], OK[1]], SCALE)).toEqual([{ fromHundredths: 700, toHundredths: 1000 }]);
  });

  it("no reporta nada si la escala no declara rango", () => {
    expect(findScaleGaps(OK, { minValueHundredths: null, maxValueHundredths: null })).toEqual([]);
  });
});

describe("hasLevelFor", () => {
  it("responde por valor concreto", () => {
    expect(hasLevelFor(700, OK)).toBe(true);
    expect(hasLevelFor(50, OK)).toBe(false);
  });
});
