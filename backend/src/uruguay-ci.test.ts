import { describe, it, expect } from "vitest";
import { onlyDigits, computeCICheckDigit, isValidUruguayanCI } from "./uruguay-ci.js";

describe("onlyDigits", () => {
  it("elimina todo lo que no es dígito", () => {
    expect(onlyDigits("1.234.567-8")).toBe("12345678");
    expect(onlyDigits("abc")).toBe("");
    expect(onlyDigits("")).toBe("");
  });
});

describe("computeCICheckDigit", () => {
  it("calcula dígito verificador para base conocida", () => {
    const base = "1234567";
    const d = computeCICheckDigit(base);
    expect(typeof d).toBe("number");
    expect(d).toBeGreaterThanOrEqual(0);
    expect(d).toBeLessThanOrEqual(9);
    expect(isValidUruguayanCI(base + d)).toBe(true);
  });

  it("acepta base acortada con padding", () => {
    const d = computeCICheckDigit("456789");
    expect(isValidUruguayanCI("0456789" + d)).toBe(true);
  });
});

describe("isValidUruguayanCI", () => {
  it("rechaza vacío o muy corto", () => {
    expect(isValidUruguayanCI("")).toBe(false);
    expect(isValidUruguayanCI("123")).toBe(false);
    expect(isValidUruguayanCI("123456")).toBe(false);
  });

  it("rechaza más de 8 dígitos (solo toma validación 7-8)", () => {
    expect(isValidUruguayanCI("123456789")).toBe(false);
  });

  it("rechaza dígito verificador incorrecto", () => {
    const base = "1234567";
    const good = computeCICheckDigit(base);
    const wrong = good === 0 ? 1 : good - 1;
    expect(isValidUruguayanCI(base + wrong)).toBe(false);
  });

  it("acepta CI formateada con puntos y guión", () => {
    const base = "3045865";
    const check = computeCICheckDigit(base);
    expect(isValidUruguayanCI(`3.045.865-${check}`)).toBe(true);
  });

  it("acepta 7 dígitos totales (6 + verificador)", () => {
    const six = "345678";
    const d = computeCICheckDigit(six);
    expect(isValidUruguayanCI(six + d)).toBe(true);
  });
});
