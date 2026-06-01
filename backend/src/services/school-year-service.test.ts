import { describe, it, expect, vi } from "vitest";
import {
  assertValidSchoolYearDates,
  isYmdWithinSchoolYear,
  resolveSchoolYearIdForList,
} from "./school-year-service.js";

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

describe("assertValidSchoolYearDates", () => {
  it("rechaza fechas inválidas", () => {
    expect(() => assertValidSchoolYearDates(new Date("invalid"))).toThrow("INVALID_SCHOOL_YEAR_DATE");
    expect(() => assertValidSchoolYearDates(undefined, new Date("invalid"))).toThrow("INVALID_SCHOOL_YEAR_DATE");
  });

  it("rechaza inicio posterior al fin", () => {
    expect(() =>
      assertValidSchoolYearDates(new Date("2026-12-01T00:00:00.000Z"), new Date("2026-03-01T00:00:00.000Z")),
    ).toThrow("SCHOOL_YEAR_DATES_OUT_OF_ORDER");
  });

  it("acepta fechas válidas o ausentes", () => {
    expect(() => assertValidSchoolYearDates()).not.toThrow();
    expect(() =>
      assertValidSchoolYearDates(new Date("2026-03-01T00:00:00.000Z"), new Date("2026-12-01T00:00:00.000Z")),
    ).not.toThrow();
  });
});

describe("resolveSchoolYearIdForList", () => {
  it("ADMIN con schoolYearId válido lo usa", async () => {
    const prisma = {
      schoolYear: {
        findUnique: vi.fn().mockResolvedValue({ id: "sy-1" }),
        findFirst: vi.fn(),
      },
    };
    const id = await resolveSchoolYearIdForList(prisma as never, {
      role: "ADMIN",
      requestedSchoolYearId: "sy-1",
    });
    expect(id).toBe("sy-1");
  });

  it("ADMIN con schoolYearId inexistente cae al ciclo activo", async () => {
    const prisma = {
      schoolYear: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue({ id: "active-1", code: 2026 }),
      },
    };
    const id = await resolveSchoolYearIdForList(prisma as never, {
      role: "STAFF",
      requestedSchoolYearId: "bad",
    });
    expect(id).toBe("active-1");
  });

  it("roles no privilegiados ignoran el año solicitado", async () => {
    const findUnique = vi.fn();
    const prisma = {
      schoolYear: {
        findUnique,
        findFirst: vi.fn().mockResolvedValue({ id: "active-1", code: 2026 }),
      },
    };
    const id = await resolveSchoolYearIdForList(prisma as never, {
      role: "TEACHER",
      requestedSchoolYearId: "sy-1",
    });
    expect(id).toBe("active-1");
    expect(findUnique).not.toHaveBeenCalled();
  });
});
