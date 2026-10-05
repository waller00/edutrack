import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { signAccessToken } from "../test-utils/bearer-token.js";

/**
 * Cubre lo único que el alta de un ciclo decide por su cuenta: que nazca con la parametrización de
 * su libreta. El resto del router es CRUD de Prisma y está fuera de la medición de cobertura.
 */

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    schoolYear: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), count: vi.fn() },
    academicPeriod: { findMany: vi.fn(), createMany: vi.fn() },
    courseOffering: { count: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../db/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../services/school-year-service.js", () => ({
  assertCanCreateSchoolYear: vi.fn().mockResolvedValue(undefined),
  assertValidSchoolYearDates: vi.fn(),
  activateSchoolYearById: vi.fn(),
  copyCoursesBetweenSchoolYears: vi.fn(),
  buildSubjectAssignmentsToCopy: vi.fn().mockReturnValue([]),
}));
vi.mock("../services/gradebook/archive.js", () => ({
  archiveSchoolYearGradeBooks: vi.fn(),
  historicalSummary: vi.fn(),
  unarchiveSchoolYearGradeBooks: vi.fn(),
}));
vi.mock("../services/gradebook/provision-trigger.js", () => ({
  scheduleGradeBookProvision: vi.fn(),
}));

import adminSchoolYearsRoutes from "./admin-school-years.js";
import { authGuard, requirePermission } from "../middlewares/auth.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  // Montado igual que en admin.ts.
  a.use("/admin/school-years", authGuard, requirePermission("school-years.manage", "all"), adminSchoolYearsRoutes);
  return a;
}

const tok = (role = "ADMIN", sub = "admin-1") => signAccessToken({ sub, email: "a@a.com", role: role as "ADMIN" });

const TARGET = { id: "sy-2027", code: 2027, label: "Ciclo lectivo 2027" };
const SOURCE_ID = "44444444-4444-4444-8444-444444444444";

const created = {
  ...TARGET,
  startsOn: null,
  endsOn: null,
  status: "PLANNED",
  createdAt: new Date("2026-10-04T12:00:00.000Z"),
  updatedAt: new Date("2026-10-04T12:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation((fn: any) => fn(prismaMock));
  prismaMock.schoolYear.create.mockResolvedValue(created);
  prismaMock.schoolYear.findUnique.mockImplementation(({ where }: any) =>
    Promise.resolve(where.id === SOURCE_ID ? { id: SOURCE_ID, code: 2026 } : { id: TARGET.id, code: TARGET.code }),
  );
  prismaMock.academicPeriod.findMany.mockResolvedValue([]);
  prismaMock.academicPeriod.createMany.mockResolvedValue({ count: 16 });
});

describe("POST /admin/school-years", () => {
  it("crea el ciclo y hereda los períodos del ciclo origen en la misma transacción", async () => {
    const res = await request(app())
      .post("/admin/school-years")
      .set("Authorization", `Bearer ${tok()}`)
      .send({ code: 2027, label: "Ciclo lectivo 2027", sourceSchoolYearId: SOURCE_ID });

    expect(res.status).toBe(201);
    expect(res.body.academicPeriods.sourceSchoolYearCode).toBe(2026);
    expect(res.body.academicPeriods.created).toBeGreaterThan(0);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.academicPeriod.createMany).toHaveBeenCalledTimes(1);
  });

  it("sin ciclo origen siembra la plantilla reglamentaria", async () => {
    const res = await request(app())
      .post("/admin/school-years")
      .set("Authorization", `Bearer ${tok()}`)
      .send({ code: 2027, label: "Ciclo lectivo 2027" });

    expect(res.status).toBe(201);
    expect(res.body.academicPeriods.sourceSchoolYearId).toBeNull();
    expect(res.body.academicPeriods.byLevel.EBI.origin).toBe("TEMPLATE");
  });

  it("respeta que no se quiera heredar nada", async () => {
    const res = await request(app())
      .post("/admin/school-years")
      .set("Authorization", `Bearer ${tok()}`)
      .send({ code: 2027, label: "Ciclo lectivo 2027", inheritAcademicPeriods: false });

    expect(res.status).toBe(201);
    expect(res.body.academicPeriods).toBeNull();
    expect(prismaMock.academicPeriod.createMany).not.toHaveBeenCalled();
  });

  it("devuelve 404 si el ciclo origen no existe", async () => {
    prismaMock.schoolYear.findUnique.mockImplementation(({ where }: any) =>
      Promise.resolve(where.id === TARGET.id ? { id: TARGET.id, code: TARGET.code } : null),
    );

    const res = await request(app())
      .post("/admin/school-years")
      .set("Authorization", `Bearer ${tok()}`)
      .send({ code: 2027, label: "Ciclo lectivo 2027", sourceSchoolYearId: SOURCE_ID });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("SOURCE_SCHOOL_YEAR_NOT_FOUND");
  });

  it("rechaza a un docente", async () => {
    const res = await request(app())
      .post("/admin/school-years")
      .set("Authorization", `Bearer ${tok("TEACHER", "teacher-1")}`)
      .send({ code: 2027, label: "Ciclo lectivo 2027" });

    expect(res.status).toBe(403);
    expect(prismaMock.schoolYear.create).not.toHaveBeenCalled();
  });
});
