import { describe, it, expect, vi } from "vitest";
import {
  assertValidSchoolYearDates,
  isYmdWithinSchoolYear,
  resolveSchoolYearIdForList,
  ensureDefaultSchoolYear,
  activateSchoolYearById,
  copyCoursesBetweenSchoolYears,
  ensureCourseOffering,
  assertCourseOfferedInSchoolYear,
  findActiveCourseOffering,
} from "./school-year-service.js";

function fakePrisma(over: Record<string, any> = {}) {
  return {
    schoolYear: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
      create: vi.fn(),
    },
    course: { findUnique: vi.fn() },
    courseOffering: { count: vi.fn(), findMany: vi.fn(), create: vi.fn(), upsert: vi.fn(), findFirst: vi.fn() },
    subject: { findMany: vi.fn(), createMany: vi.fn() },
    subjectCourseAssignment: { findMany: vi.fn(), createMany: vi.fn() },
    $transaction: vi.fn(async (cb: any) => cb({})),
    ...over,
  } as never;
}

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

describe("ensureDefaultSchoolYear", () => {
  it("no hace nada si ya hay ciclo activo", async () => {
    const p = fakePrisma() as any;
    p.schoolYear.findFirst.mockResolvedValue({ id: "sy", status: "ACTIVE" });
    await ensureDefaultSchoolYear(p);
    expect(p.schoolYear.create).not.toHaveBeenCalled();
  });
  it("reactiva un ciclo del año actual si existe", async () => {
    const p = fakePrisma() as any;
    p.schoolYear.findFirst.mockResolvedValue(null);
    p.schoolYear.findUnique.mockResolvedValue({ id: "sy-existing" });
    p.schoolYear.update.mockResolvedValue({ id: "sy-existing", status: "ACTIVE" });
    await ensureDefaultSchoolYear(p);
    expect(p.schoolYear.update).toHaveBeenCalled();
    expect(p.schoolYear.create).not.toHaveBeenCalled();
  });
  it("crea uno nuevo si no hay ninguno", async () => {
    const p = fakePrisma() as any;
    p.schoolYear.findFirst.mockResolvedValue(null);
    p.schoolYear.findUnique.mockResolvedValue(null);
    p.schoolYear.create.mockResolvedValue({ id: "sy-new", status: "ACTIVE" });
    await ensureDefaultSchoolYear(p);
    expect(p.schoolYear.create).toHaveBeenCalled();
  });
});

describe("activateSchoolYearById", () => {
  it("lanza si ya hay otro activo", async () => {
    const tx = { schoolYear: { findFirst: vi.fn().mockResolvedValue({ id: "other" }), update: vi.fn() } };
    const p = fakePrisma({ $transaction: vi.fn(async (cb: any) => cb(tx)) });
    await expect(activateSchoolYearById(p, "sy")).rejects.toThrow("ACTIVE_SCHOOL_YEAR_EXISTS");
  });
  it("activa cuando no hay otro activo", async () => {
    const tx = {
      schoolYear: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn().mockResolvedValue({ id: "sy", status: "ACTIVE" }) },
    };
    const p = fakePrisma({ $transaction: vi.fn(async (cb: any) => cb(tx)) });
    expect((await activateSchoolYearById(p, "sy")).status).toBe("ACTIVE");
  });
});

describe("copyCoursesBetweenSchoolYears", () => {
  it("rechaza copiar al mismo ciclo", async () => {
    await expect(copyCoursesBetweenSchoolYears(fakePrisma(), "a", "a")).rejects.toThrow("SAME_SCHOOL_YEAR");
  });
  it("lanza si falta target o source", async () => {
    const p = fakePrisma() as any;
    p.schoolYear.findUnique.mockResolvedValue(null);
    await expect(copyCoursesBetweenSchoolYears(p, "a", "b")).rejects.toThrow("SCHOOL_YEAR_NOT_FOUND");
  });
  it("lanza si el target ya tiene ofertas", async () => {
    const p = fakePrisma() as any;
    p.schoolYear.findUnique.mockResolvedValue({ id: "x", code: 2025 });
    p.courseOffering.count.mockResolvedValue(2);
    await expect(copyCoursesBetweenSchoolYears(p, "a", "b")).rejects.toThrow("TARGET_YEAR_HAS_COURSES");
  });
  it("replica ofertas, materias y asignaciones", async () => {
    const tx = {
      courseOffering: { create: vi.fn().mockResolvedValue({ id: "off-new" }) },
      subject: {
        findMany: vi.fn().mockResolvedValue([{ name: "Mate", code: "M", description: null, sortOrder: 0, isActive: true }]),
        createMany: vi.fn(),
      },
      subjectCourseAssignment: { findMany: vi.fn().mockResolvedValue([{ subjectId: "s1", courseId: "c1" }]), createMany: vi.fn() },
    };
    const p = fakePrisma({ $transaction: vi.fn(async (cb: any) => cb(tx)) }) as any;
    p.schoolYear.findUnique.mockResolvedValue({ id: "x", code: 2025 });
    p.courseOffering.count.mockResolvedValue(0);
    p.courseOffering.findMany.mockResolvedValue([{ id: "off-src", courseId: "c1", isActive: true, course: {} }]);
    const res = await copyCoursesBetweenSchoolYears(p, "target", "source");
    expect(res).toEqual({ created: 1, subjectsCreated: 1 });
    expect(tx.subject.createMany).toHaveBeenCalled();
    expect(tx.subjectCourseAssignment.createMany).toHaveBeenCalled();
  });
});

describe("ensureCourseOffering", () => {
  it("lanza si el curso no existe", async () => {
    const p = fakePrisma() as any;
    p.course.findUnique.mockResolvedValue(null);
    await expect(ensureCourseOffering(p, "c1", "sy")).rejects.toThrow("COURSE_NOT_FOUND");
  });
  it("upsert de la oferta cuando el curso existe", async () => {
    const p = fakePrisma() as any;
    p.course.findUnique.mockResolvedValue({ id: "c1", isActive: true });
    p.courseOffering.upsert.mockResolvedValue({ id: "off", courseId: "c1", schoolYearId: "sy", isActive: true });
    expect((await ensureCourseOffering(p, "c1", "sy")).id).toBe("off");
  });
});

describe("lookups de oferta", () => {
  it("assertCourseOfferedInSchoolYear delega en findFirst", async () => {
    const p = fakePrisma() as any;
    p.courseOffering.findFirst.mockResolvedValue({ id: "off", courseId: "c1", schoolYearId: "sy" });
    expect(await assertCourseOfferedInSchoolYear(p, "c1", "sy")).toMatchObject({ id: "off" });
  });
  it("findActiveCourseOffering delega en findFirst", async () => {
    const p = fakePrisma() as any;
    p.courseOffering.findFirst.mockResolvedValue({ id: "off", courseId: "c1", schoolYearId: "sy", isActive: true });
    expect(await findActiveCourseOffering(p, "c1", "sy")).toMatchObject({ isActive: true });
  });
});
