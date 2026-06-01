import { describe, it, expect } from "vitest";
import { isYmdWithinSchoolYear } from "./school-year-service.js";

describe("isYmdWithinSchoolYear", () => {
  const year = {
    startsOn: new Date("2026-03-01T00:00:00.000Z"),
    endsOn: new Date("2026-12-15T00:00:00.000Z"),
  };

  it("acepta una fecha dentro del rango", () => {
    expect(isYmdWithinSchoolYear(year, "2026-06-01")).toBe(true);
  });

  it("acepta los límites inclusive", () => {
    expect(isYmdWithinSchoolYear(year, "2026-03-01")).toBe(true);
    expect(isYmdWithinSchoolYear(year, "2026-12-15")).toBe(true);
  });

  it("rechaza fechas anteriores al inicio", () => {
    expect(isYmdWithinSchoolYear(year, "2026-02-28")).toBe(false);
  });

  it("rechaza fechas posteriores al fin", () => {
    expect(isYmdWithinSchoolYear(year, "2026-12-16")).toBe(false);
    expect(isYmdWithinSchoolYear(year, "2027-01-01")).toBe(false);
  });

  it("no restringe si el ciclo no tiene límites definidos", () => {
    expect(isYmdWithinSchoolYear({ startsOn: null, endsOn: null }, "2030-01-01")).toBe(true);
  });

  it("aplica solo el límite definido", () => {
    expect(isYmdWithinSchoolYear({ startsOn: new Date("2026-03-01T00:00:00.000Z"), endsOn: null }, "2026-02-01")).toBe(false);
    expect(isYmdWithinSchoolYear({ startsOn: null, endsOn: new Date("2026-12-15T00:00:00.000Z") }, "2026-12-31")).toBe(false);
  });
});
