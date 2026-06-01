import { describe, it, expect } from "vitest";
import { mergeSchoolYearIntoAttendanceEventWhere } from "./attendance-school-year.js";

describe("mergeSchoolYearIntoAttendanceEventWhere", () => {
  it("filtra por la columna directa schoolYearId (no por la relación event)", () => {
    const where: any = {};
    mergeSchoolYearIntoAttendanceEventWhere(where, "sy-1");
    expect(where.schoolYearId).toBe("sy-1");
    // No debe forzar la relación event (eso ocultaba las marcas sin evento).
    expect(where.event).toBeUndefined();
  });

  it("conserva otros filtros previos del where", () => {
    const where: any = { userId: "u-1", type: "CHECK_IN" };
    mergeSchoolYearIntoAttendanceEventWhere(where, "sy-2");
    expect(where).toEqual({ userId: "u-1", type: "CHECK_IN", schoolYearId: "sy-2" });
  });
});
