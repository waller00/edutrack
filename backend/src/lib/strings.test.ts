import { describe, expect, it } from "vitest";
import { compareCodeUnits, trimEndChars } from "./strings";

describe("trimEndChars", () => {
  it("saca sólo los caracteres pedidos del final", () => {
    expect(trimEndChars("https://moodle.example.com///", "/")).toBe("https://moodle.example.com");
    expect(trimEndChars("juan.perez.-", ".-")).toBe("juan.perez");
    expect(trimEndChars("/a/b", "/")).toBe("/a/b");
  });

  it("deja vacío lo que es todo de esos caracteres y no toca un texto vacío", () => {
    expect(trimEndChars("////", "/")).toBe("");
    expect(trimEndChars("", "/")).toBe("");
  });

  it("no se demora con muchas barras que no llegan al final", () => {
    const value = `${"/".repeat(200_000)}a`;
    const started = performance.now();
    expect(trimEndChars(value, "/")).toBe(value);
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe("compareCodeUnits", () => {
  it("ordena igual que sort() sin comparador", () => {
    const values = ["b", "a", "B", "á", "10", "9", "2026-03", "2026-01"];
    expect([...values].sort(compareCodeUnits)).toEqual([...values].sort());
  });

  it("da 0 con textos iguales", () => {
    expect(compareCodeUnits("x", "x")).toBe(0);
  });
});
