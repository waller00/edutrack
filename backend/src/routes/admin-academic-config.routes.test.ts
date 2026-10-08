import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { signAccessToken } from "../test-utils/bearer-token.js";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    gradingScale: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    gradingScaleLevel: { deleteMany: vi.fn(), createMany: vi.fn() },
    academicPeriod: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    activityType: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    assessment: { groupBy: vi.fn() },
    gradeBookPeriod: { groupBy: vi.fn() },
    academicAlertRule: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../db/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../services/school-year-service.js", () => ({
  resolveSchoolYearIdForList: vi.fn().mockResolvedValue("sy-1"),
}));

import adminAcademicConfigRoutes from "./admin-academic-config.js";
import { authGuard, requirePermission } from "../middlewares/auth.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  // Montado igual que en admin.ts.
  a.use(
    "/admin/academic-config",
    authGuard,
    requirePermission("academic-config.manage", "all"),
    adminAcademicConfigRoutes,
  );
  return a;
}

const tok = (role = "ADMIN", sub = "admin-1") =>
  signAccessToken({ sub, email: "a@a.com", role: role as "ADMIN" });

const SCALE_ID = "11111111-1111-4111-8111-111111111111";
const PERIOD_ID = "22222222-2222-4222-8222-222222222222";
const TYPE_ID = "33333333-3333-4333-8333-333333333333";

const NUMERIC_LEVELS = [
  { code: "BAJO", label: "Bajo", minValueHundredths: 100, maxValueHundredths: 599 },
  { code: "ALTO", label: "Alto", minValueHundredths: 600, maxValueHundredths: 1000 },
];

const NEW_SCALE = {
  code: "NUMERICA_1_10",
  name: "Numérica 1 a 10",
  kind: "NUMERIC",
  minValueHundredths: 100,
  maxValueHundredths: 1000,
  decimals: 0,
  levels: NUMERIC_LEVELS,
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation((fn: any) => fn(prismaMock));
  // Los GET agregan contadores de uso; sin datos, todo va en cero.
  prismaMock.assessment.groupBy.mockResolvedValue([]);
  prismaMock.gradeBookPeriod.groupBy.mockResolvedValue([]);
});

describe("permisos", () => {
  it("rechaza a un docente", async () => {
    const res = await request(app())
      .get("/admin/academic-config/scales")
      .set("Authorization", `Bearer ${tok("TEACHER", "t-1")}`);
    expect(res.status).toBe(403);
  });

  it("rechaza sin sesión", async () => {
    const res = await request(app()).get("/admin/academic-config/scales");
    expect(res.status).toBe(401);
  });
});

describe("escalas", () => {
  it("lista sólo las activas y anota los huecos de cobertura", async () => {
    prismaMock.gradingScale.findMany.mockResolvedValue([
      {
        id: SCALE_ID,
        minValueHundredths: 100,
        maxValueHundredths: 1000,
        levels: [{ code: "BAJO", minValueHundredths: 100, maxValueHundredths: 599 }],
      },
    ]);

    const res = await request(app())
      .get("/admin/academic-config/scales")
      .set("Authorization", `Bearer ${tok()}`);

    expect(res.status).toBe(200);
    expect(prismaMock.gradingScale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );
    // El tramo 6,00–10,00 no está cubierto: la UI tiene que poder avisarlo.
    expect(res.body.data[0].gaps).toEqual([{ fromHundredths: 600, toHundredths: 1000 }]);
  });

  it("incluye inactivas con includeInactive=true", async () => {
    prismaMock.gradingScale.findMany.mockResolvedValue([]);
    await request(app())
      .get("/admin/academic-config/scales?includeInactive=true")
      .set("Authorization", `Bearer ${tok()}`);
    expect(prismaMock.gradingScale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it("crea la escala con sus tramos", async () => {
    prismaMock.gradingScale.create.mockResolvedValue({
      id: SCALE_ID,
      code: "NUMERICA_1_10",
      minValueHundredths: 100,
      maxValueHundredths: 1000,
      levels: NUMERIC_LEVELS,
    });

    const res = await request(app())
      .post("/admin/academic-config/scales")
      .set("Authorization", `Bearer ${tok()}`)
      .send(NEW_SCALE);

    expect(res.status).toBe(201);
    const data = prismaMock.gradingScale.create.mock.calls[0][0].data;
    expect(data.code).toBe("NUMERICA_1_10");
    expect(data.levels.create).toHaveLength(2);
    // Los defaults del tramo llegan resueltos, no como undefined.
    expect(data.levels.create[0]).toMatchObject({ isPassing: false, isAlert: false, sortOrder: 0 });
  });

  it("rechaza tramos solapados con código semántico", async () => {
    const res = await request(app())
      .post("/admin/academic-config/scales")
      .set("Authorization", `Bearer ${tok()}`)
      .send({
        ...NEW_SCALE,
        levels: [
          { code: "A", label: "A", minValueHundredths: 100, maxValueHundredths: 700 },
          { code: "B", label: "B", minValueHundredths: 600, maxValueHundredths: 1000 },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("LEVELS_OVERLAP");
    expect(prismaMock.gradingScale.create).not.toHaveBeenCalled();
  });

  it("rechaza un tramo fuera del rango de la escala", async () => {
    const res = await request(app())
      .post("/admin/academic-config/scales")
      .set("Authorization", `Bearer ${tok()}`)
      .send({
        ...NEW_SCALE,
        levels: [{ code: "A", label: "A", minValueHundredths: 0, maxValueHundredths: 1000 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("LEVEL_OUT_OF_SCALE");
  });

  it("traduce el código duplicado de Prisma a 409", async () => {
    prismaMock.gradingScale.create.mockRejectedValue({ code: "P2002" });
    const res = await request(app())
      .post("/admin/academic-config/scales")
      .set("Authorization", `Bearer ${tok()}`)
      .send(NEW_SCALE);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("DUPLICATE_CODE");
  });

  it("rechaza un código con minúsculas", async () => {
    const res = await request(app())
      .post("/admin/academic-config/scales")
      .set("Authorization", `Bearer ${tok()}`)
      .send({ ...NEW_SCALE, code: "numerica" });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Datos inválidos");
  });

  it("al editar reemplaza el conjunto de tramos entero", async () => {
    prismaMock.gradingScale.findUnique.mockResolvedValue({
      id: SCALE_ID,
      minValueHundredths: 100,
      maxValueHundredths: 1000,
      levels: NUMERIC_LEVELS,
    });
    prismaMock.gradingScale.update.mockResolvedValue({
      id: SCALE_ID,
      code: "X",
      minValueHundredths: 100,
      maxValueHundredths: 1000,
      levels: [],
    });

    const res = await request(app())
      .patch(`/admin/academic-config/scales/${SCALE_ID}`)
      .set("Authorization", `Bearer ${tok()}`)
      .send({ levels: [{ code: "UNICO", label: "Único", minValueHundredths: 100, maxValueHundredths: 1000 }] });

    expect(res.status).toBe(200);
    expect(prismaMock.gradingScaleLevel.deleteMany).toHaveBeenCalledWith({ where: { scaleId: SCALE_ID } });
    expect(prismaMock.gradingScaleLevel.createMany).toHaveBeenCalled();
  });

  it("no toca los tramos si el body no los trae", async () => {
    prismaMock.gradingScale.findUnique.mockResolvedValue({
      id: SCALE_ID,
      minValueHundredths: 100,
      maxValueHundredths: 1000,
      levels: NUMERIC_LEVELS,
    });
    prismaMock.gradingScale.update.mockResolvedValue({
      id: SCALE_ID,
      code: "X",
      minValueHundredths: 100,
      maxValueHundredths: 1000,
      levels: NUMERIC_LEVELS,
    });

    await request(app())
      .patch(`/admin/academic-config/scales/${SCALE_ID}`)
      .set("Authorization", `Bearer ${tok()}`)
      .send({ name: "Otro nombre" });

    expect(prismaMock.gradingScaleLevel.deleteMany).not.toHaveBeenCalled();
  });

  it("404 al editar una escala inexistente", async () => {
    prismaMock.gradingScale.findUnique.mockResolvedValue(null);
    const res = await request(app())
      .patch(`/admin/academic-config/scales/${SCALE_ID}`)
      .set("Authorization", `Bearer ${tok()}`)
      .send({ name: "X" });
    expect(res.status).toBe(404);
  });

  it("DELETE desactiva en vez de borrar", async () => {
    prismaMock.gradingScale.findUnique.mockResolvedValue({
      id: SCALE_ID,
      code: "X",
      minValueHundredths: 100,
      maxValueHundredths: 1000,
      _count: { levels: 2 },
    });
    prismaMock.gradingScale.update.mockResolvedValue({ id: SCALE_ID, code: "X" });
    const res = await request(app())
      .delete(`/admin/academic-config/scales/${SCALE_ID}`)
      .set("Authorization", `Bearer ${tok()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, deactivated: true });
    expect(prismaMock.gradingScale.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: false } }),
    );
  });

  it("404 al desactivar una escala inexistente", async () => {
    prismaMock.gradingScale.findUnique.mockResolvedValue(null);
    const res = await request(app())
      .delete(`/admin/academic-config/scales/${SCALE_ID}`)
      .set("Authorization", `Bearer ${tok()}`);
    expect(res.status).toBe(404);
    expect(prismaMock.gradingScale.update).not.toHaveBeenCalled();
  });
});

describe("escalas que usa la libreta", () => {
  const PERIOD_SCALE = {
    id: SCALE_ID,
    code: "NUMERICA_1_12",
    isActive: true,
    minValueHundredths: 100,
    maxValueHundredths: 1200,
    levels: NUMERIC_LEVELS,
  };

  it("el listado dice para qué usa la libreta cada una", async () => {
    prismaMock.gradingScale.findMany.mockResolvedValue([
      { ...PERIOD_SCALE, code: "NUMERICA_1_10" },
      { ...PERIOD_SCALE, code: "CONDUCTA" },
      { ...PERIOD_SCALE, code: "OTRA" },
    ]);

    const res = await request(app())
      .get("/admin/academic-config/scales")
      .set("Authorization", `Bearer ${tok()}`);

    expect(res.body.data.map((s: { gradebookRole: string | null }) => s.gradebookRole)).toEqual([
      "C y R de ciclo básico",
      "la conducta",
      null,
    ]);
  });

  it("no se desactiva por DELETE: antes la libreta pasaba en silencio a otra escala", async () => {
    prismaMock.gradingScale.findUnique.mockResolvedValue({
      ...PERIOD_SCALE,
      code: "CONDUCTA",
      _count: { levels: 4 },
    });

    const res = await request(app())
      .delete(`/admin/academic-config/scales/${SCALE_ID}`)
      .set("Authorization", `Bearer ${tok()}`);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("GRADEBOOK_SCALE_REQUIRED");
    expect(res.body.message).toContain("la conducta");
    expect(prismaMock.gradingScale.update).not.toHaveBeenCalled();
  });

  it("tampoco se desactiva al editarla", async () => {
    prismaMock.gradingScale.findUnique.mockResolvedValue(PERIOD_SCALE);

    const res = await request(app())
      .patch(`/admin/academic-config/scales/${SCALE_ID}`)
      .set("Authorization", `Bearer ${tok()}`)
      .send({ isActive: false });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("GRADEBOOK_SCALE_REQUIRED");
    expect(prismaMock.gradingScale.update).not.toHaveBeenCalled();
  });

  it("no se queda sin rango ni sin tramos", async () => {
    prismaMock.gradingScale.findUnique.mockResolvedValue(PERIOD_SCALE);

    const sinRango = await request(app())
      .patch(`/admin/academic-config/scales/${SCALE_ID}`)
      .set("Authorization", `Bearer ${tok()}`)
      .send({ maxValueHundredths: null });
    expect(sinRango.status).toBe(400);
    expect(sinRango.body.code).toBe("GRADEBOOK_SCALE_NEEDS_RANGE");

    const sinTramos = await request(app())
      .patch(`/admin/academic-config/scales/${SCALE_ID}`)
      .set("Authorization", `Bearer ${tok()}`)
      .send({ levels: [] });
    expect(sinTramos.status).toBe(400);
    expect(sinTramos.body.code).toBe("GRADEBOOK_SCALE_NEEDS_LEVELS");

    expect(prismaMock.gradingScale.update).not.toHaveBeenCalled();
  });

  it("si ya estaba desactivada, editarla y activarla vale", async () => {
    prismaMock.gradingScale.findUnique.mockResolvedValue({ ...PERIOD_SCALE, isActive: false });
    prismaMock.gradingScale.update.mockResolvedValue({ ...PERIOD_SCALE, isActive: true });

    const res = await request(app())
      .patch(`/admin/academic-config/scales/${SCALE_ID}`)
      .set("Authorization", `Bearer ${tok()}`)
      .send({ name: "Numérica 1 a 12", isActive: true });

    expect(res.status).toBe(200);
    expect(prismaMock.gradingScale.update.mock.calls[0][0].data).toMatchObject({ isActive: true });
  });

  it("una escala cualquiera se sigue pudiendo desactivar al editarla", async () => {
    prismaMock.gradingScale.findUnique.mockResolvedValue({ ...PERIOD_SCALE, code: "OTRA" });
    prismaMock.gradingScale.update.mockResolvedValue({ ...PERIOD_SCALE, code: "OTRA", isActive: false });

    const res = await request(app())
      .patch(`/admin/academic-config/scales/${SCALE_ID}`)
      .set("Authorization", `Bearer ${tok()}`)
      .send({ isActive: false });

    expect(res.status).toBe(200);
  });
});

describe("períodos", () => {
  const NEW_PERIOD = {
    schoolYearId: "44444444-4444-4444-8444-444444444444",
    level: "EBI",
    code: "MAYO",
    name: "Mayo",
    startsOn: "2026-05-01",
    endsOn: "2026-05-31",
    closesOn: "2026-06-08",
  };

  it("lista por ciclo y nivel, y devuelve fechas como día civil", async () => {
    prismaMock.academicPeriod.findMany.mockResolvedValue([
      {
        id: PERIOD_ID,
        code: "MAYO",
        startsOn: new Date("2026-05-01T12:00:00.000Z"),
        endsOn: new Date("2026-05-31T12:00:00.000Z"),
        closesOn: null,
      },
    ]);

    const res = await request(app())
      .get("/admin/academic-config/periods?level=EBI")
      .set("Authorization", `Bearer ${tok()}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].startsOn).toBe("2026-05-01");
    expect(res.body.data[0].closesOn).toBeNull();
    expect(prismaMock.academicPeriod.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { schoolYearId: "sy-1", level: "EBI", isActive: true } }),
    );
  });

  it("crea una entrega con reunión y el nombre de su texto", async () => {
    prismaMock.academicPeriod.create.mockResolvedValue({
      id: PERIOD_ID,
      code: "ENTREGA_1",
      level: "EBI",
      startsOn: null,
      endsOn: null,
      closesOn: null,
    });

    const res = await request(app())
      .post("/admin/academic-config/periods")
      .set("Authorization", `Bearer ${tok()}`)
      .send({
        ...NEW_PERIOD,
        code: "ENTREGA_1",
        kind: "ENTREGA",
        isMeeting: true,
        judgementLabel: "Informe de actuación",
      });

    expect(res.status).toBe(201);
    expect(prismaMock.academicPeriod.create.mock.calls[0][0].data).toMatchObject({
      kind: "ENTREGA",
      isMeeting: true,
      judgementLabel: "Informe de actuación",
    });
  });

  it("un período nuevo es un tramo sin reunión si no se dice otra cosa", async () => {
    prismaMock.academicPeriod.create.mockResolvedValue({ id: PERIOD_ID, code: "MAYO", level: "EBI", startsOn: null, endsOn: null, closesOn: null });
    await request(app()).post("/admin/academic-config/periods").set("Authorization", `Bearer ${tok()}`).send(NEW_PERIOD);
    expect(prismaMock.academicPeriod.create.mock.calls[0][0].data).toMatchObject({
      kind: "TRAMO",
      isMeeting: false,
      judgementLabel: null,
    });
  });

  it("ignora un nivel inválido en vez de romper", async () => {
    prismaMock.academicPeriod.findMany.mockResolvedValue([]);
    await request(app())
      .get("/admin/academic-config/periods?level=PRIMARIA")
      .set("Authorization", `Bearer ${tok()}`);
    expect(prismaMock.academicPeriod.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { schoolYearId: "sy-1", isActive: true } }),
    );
  });

  it("crea el período guardando las fechas al mediodía UTC", async () => {
    prismaMock.academicPeriod.create.mockResolvedValue({
      id: PERIOD_ID,
      code: "MAYO",
      level: "EBI",
      startsOn: null,
      endsOn: null,
      closesOn: null,
    });

    const res = await request(app())
      .post("/admin/academic-config/periods")
      .set("Authorization", `Bearer ${tok()}`)
      .send(NEW_PERIOD);

    expect(res.status).toBe(201);
    const data = prismaMock.academicPeriod.create.mock.calls[0][0].data;
    // Mediodía y no medianoche: en UTC-3 un T00:00:00Z se lee como el día anterior.
    expect(data.startsOn.toISOString()).toBe("2026-05-01T12:00:00.000Z");
    expect(data.requiresGeneralGrade).toBe(true);
  });

  it("rechaza una ventana invertida", async () => {
    const res = await request(app())
      .post("/admin/academic-config/periods")
      .set("Authorization", `Bearer ${tok()}`)
      .send({ ...NEW_PERIOD, startsOn: "2026-05-31", endsOn: "2026-05-01" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PERIOD_WINDOW_INVERTED");
    expect(prismaMock.academicPeriod.create).not.toHaveBeenCalled();
  });

  it("rechaza un cierre anterior al fin del período", async () => {
    const res = await request(app())
      .post("/admin/academic-config/periods")
      .set("Authorization", `Bearer ${tok()}`)
      .send({ ...NEW_PERIOD, closesOn: "2026-05-15" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PERIOD_CLOSES_BEFORE_END");
  });

  it("al editar conserva las fechas que el body no menciona", async () => {
    const existing = {
      id: PERIOD_ID,
      code: "MAYO",
      startsOn: new Date("2026-05-01T12:00:00.000Z"),
      endsOn: new Date("2026-05-31T12:00:00.000Z"),
      closesOn: null,
    };
    prismaMock.academicPeriod.findUnique.mockResolvedValue(existing);
    prismaMock.academicPeriod.update.mockResolvedValue(existing);

    await request(app())
      .patch(`/admin/academic-config/periods/${PERIOD_ID}`)
      .set("Authorization", `Bearer ${tok()}`)
      .send({ name: "Mayo (ajustado)" });

    const data = prismaMock.academicPeriod.update.mock.calls[0][0].data;
    expect(data.startsOn).toEqual(existing.startsOn);
    expect(data.name).toBe("Mayo (ajustado)");
  });

  it("permite blanquear una fecha mandándola en null", async () => {
    const existing = {
      id: PERIOD_ID,
      code: "MAYO",
      startsOn: new Date("2026-05-01T12:00:00.000Z"),
      endsOn: null,
      closesOn: null,
    };
    prismaMock.academicPeriod.findUnique.mockResolvedValue(existing);
    prismaMock.academicPeriod.update.mockResolvedValue(existing);

    await request(app())
      .patch(`/admin/academic-config/periods/${PERIOD_ID}`)
      .set("Authorization", `Bearer ${tok()}`)
      .send({ startsOn: null });

    expect(prismaMock.academicPeriod.update.mock.calls[0][0].data.startsOn).toBeNull();
  });
});

describe("tipos de actividad", () => {
  it("lista sólo los globales: los del docente no son del catálogo institucional", async () => {
    prismaMock.activityType.findMany.mockResolvedValue([]);
    await request(app())
      .get("/admin/academic-config/activity-types")
      .set("Authorization", `Bearer ${tok()}`);
    expect(prismaMock.activityType.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { scope: "GLOBAL", isActive: true } }),
    );
  });

  it("crea siempre con scope GLOBAL", async () => {
    prismaMock.activityType.create.mockResolvedValue({ id: TYPE_ID, code: "ESCRITO" });
    const res = await request(app())
      .post("/admin/academic-config/activity-types")
      .set("Authorization", `Bearer ${tok()}`)
      .send({ code: "ESCRITO", name: "Escrito", scope: "TEACHER" });

    expect(res.status).toBe(201);
    expect(prismaMock.activityType.create.mock.calls[0][0].data.scope).toBe("GLOBAL");
  });

  it("guarda la columna de la planilla del tipo (Or / Otras / Ev / Prueba)", async () => {
    prismaMock.activityType.create.mockResolvedValue({ id: TYPE_ID, code: "PRUEBA" });
    await request(app())
      .post("/admin/academic-config/activity-types")
      .set("Authorization", `Bearer ${tok()}`)
      .send({ code: "PRUEBA", name: "Prueba semestral", category: "PRUEBA" });
    expect(prismaMock.activityType.create.mock.calls[0][0].data.category).toBe("PRUEBA");

    await request(app())
      .post("/admin/academic-config/activity-types")
      .set("Authorization", `Bearer ${tok()}`)
      .send({ code: "DEBATE", name: "Debate" });
    expect(prismaMock.activityType.create.mock.calls[1][0].data.category).toBe("OTRAS");
  });

  it("rechaza una columna que no existe en la planilla", async () => {
    const res = await request(app())
      .post("/admin/academic-config/activity-types")
      .set("Authorization", `Bearer ${tok()}`)
      .send({ code: "X", name: "X", category: "CONDUCTA" });
    expect(res.status).toBe(400);
  });

  it("no deja que administración toque un tipo propio de un docente", async () => {
    prismaMock.activityType.findUnique.mockResolvedValue({
      id: TYPE_ID,
      scope: "TEACHER",
      code: "MI_TIPO",
    });

    const res = await request(app())
      .patch(`/admin/academic-config/activity-types/${TYPE_ID}`)
      .set("Authorization", `Bearer ${tok()}`)
      .send({ name: "Otro" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NOT_GLOBAL");
    expect(prismaMock.activityType.update).not.toHaveBeenCalled();
  });

  it("DELETE desactiva el tipo global", async () => {
    prismaMock.activityType.findUnique.mockResolvedValue({ id: TYPE_ID, scope: "GLOBAL", code: "ESCRITO" });
    prismaMock.activityType.update.mockResolvedValue({ id: TYPE_ID });

    const res = await request(app())
      .delete(`/admin/academic-config/activity-types/${TYPE_ID}`)
      .set("Authorization", `Bearer ${tok()}`);

    expect(res.status).toBe(200);
    expect(prismaMock.activityType.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: false } }),
    );
  });
});


describe("contadores de uso en los GET", () => {
  it("cuenta las evaluaciones vivas que usan cada escala", async () => {
    prismaMock.gradingScale.findMany.mockResolvedValue([
      { id: SCALE_ID, code: "NUM", minValueHundredths: 100, maxValueHundredths: 1000, levels: [] },
      { id: "otra", code: "ORD", minValueHundredths: null, maxValueHundredths: null, levels: [] },
    ]);
    prismaMock.assessment.groupBy.mockResolvedValue([
      { gradingScaleId: SCALE_ID, _count: { _all: 4 } },
    ]);

    const res = await request(app())
      .get("/admin/academic-config/scales")
      .set("Authorization", `Bearer ${tok()}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].usage).toEqual({ assessments: 4 });
    // Una escala sin evaluaciones informa cero, nunca undefined.
    expect(res.body.data[1].usage).toEqual({ assessments: 0 });
    // Las borradas no cuentan: una evaluación eliminada no ata la escala.
    expect(prismaMock.assessment.groupBy.mock.calls[0][0].where).toEqual({ deletedAt: null });
  });

  it("un período informa evaluaciones y libretas ya cerradas por separado", async () => {
    prismaMock.academicPeriod.findMany.mockResolvedValue([
      { id: PERIOD_ID, code: "MAYO", level: "EBI", startsOn: null, endsOn: null, closesOn: null },
    ]);
    prismaMock.assessment.groupBy.mockResolvedValue([{ periodId: PERIOD_ID, _count: { _all: 3 } }]);
    prismaMock.gradeBookPeriod.groupBy.mockResolvedValue([{ periodId: PERIOD_ID, _count: { _all: 2 } }]);

    const res = await request(app())
      .get("/admin/academic-config/periods")
      .set("Authorization", `Bearer ${tok()}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].usage).toEqual({ assessments: 3, closedGradeBooks: 2 });
    // Una libreta con el período todavía abierto no cuenta como cerrada.
    expect(prismaMock.gradeBookPeriod.groupBy.mock.calls[0][0].where).toEqual({
      status: { not: "OPEN" },
    });
  });

  it("cuenta las evaluaciones de cada tipo de actividad", async () => {
    prismaMock.activityType.findMany.mockResolvedValue([{ id: TYPE_ID, code: "ESCRITO" }]);
    prismaMock.assessment.groupBy.mockResolvedValue([
      { activityTypeId: TYPE_ID, _count: { _all: 7 } },
      // Las evaluaciones sin tipo vienen con null y no deben sumarse a nadie.
      { activityTypeId: null, _count: { _all: 5 } },
    ]);

    const res = await request(app())
      .get("/admin/academic-config/activity-types")
      .set("Authorization", `Bearer ${tok()}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].usage).toEqual({ assessments: 7 });
  });
});

describe("alertas académicas (§5.7)", () => {
  beforeEach(() => {
    prismaMock.academicAlertRule.findMany.mockResolvedValue([]);
    prismaMock.academicAlertRule.findFirst.mockResolvedValue(null);
    prismaMock.academicAlertRule.create.mockResolvedValue({ id: "r-1" });
    prismaMock.academicAlertRule.update.mockResolvedValue({ id: "r-1" });
    prismaMock.auditLog.create.mockResolvedValue({ id: "a-1" });
  });

  it("muestra la regla vigente del ciclo y de dónde sale", async () => {
    prismaMock.academicAlertRule.findMany.mockResolvedValue([
      { type: "ALERT_SUBJECTS", schoolYearId: null, threshold: 4, isActive: true },
    ]);
    const res = await request(app()).get("/admin/academic-config/alert-rules").set("Authorization", `Bearer ${tok()}`);

    expect(res.status).toBe(200);
    expect(res.body.schoolYearId).toBe("sy-1");
    expect(res.body.data).toEqual([
      { type: "ALERT_SUBJECTS", threshold: 4, isActive: true, source: "GENERAL" },
      { type: "SCORE_DROP", threshold: 200, isActive: false, source: "DEFAULT" },
      { type: "NO_ASSESSMENTS", threshold: 0, isActive: false, source: "DEFAULT" },
    ]);
  });

  it("guarda la regla para el ciclo, no la general: el pasado no cambia solo", async () => {
    const res = await request(app())
      .put("/admin/academic-config/alert-rules")
      .set("Authorization", `Bearer ${tok()}`)
      .send({ type: "SCORE_DROP", threshold: 250, isActive: true });

    expect(res.status).toBe(200);
    expect(prismaMock.academicAlertRule.findFirst.mock.calls[0][0].where).toEqual({ type: "SCORE_DROP", schoolYearId: "sy-1" });
    expect(prismaMock.academicAlertRule.create.mock.calls[0][0].data).toEqual({
      type: "SCORE_DROP",
      schoolYearId: "sy-1",
      threshold: 250,
      isActive: true,
    });
  });

  it("actualiza la del ciclo en vez de duplicarla", async () => {
    prismaMock.academicAlertRule.findFirst.mockResolvedValue({ id: "r-9" });
    await request(app())
      .put("/admin/academic-config/alert-rules")
      .set("Authorization", `Bearer ${tok()}`)
      .send({ type: "ALERT_SUBJECTS", threshold: 2, isActive: false });

    expect(prismaMock.academicAlertRule.create).not.toHaveBeenCalled();
    expect(prismaMock.academicAlertRule.update.mock.calls[0][0]).toEqual({
      where: { id: "r-9" },
      data: { threshold: 2, isActive: false },
    });
  });

  it("rechaza un umbral fuera de rango con el mensaje en la unidad del tipo", async () => {
    const drop = await request(app())
      .put("/admin/academic-config/alert-rules")
      .set("Authorization", `Bearer ${tok()}`)
      .send({ type: "SCORE_DROP", threshold: 5, isActive: true });
    expect(drop.status).toBe(400);
    expect(drop.body.message).toContain("puntos");

    const subjects = await request(app())
      .put("/admin/academic-config/alert-rules")
      .set("Authorization", `Bearer ${tok()}`)
      .send({ type: "ALERT_SUBJECTS", threshold: 0, isActive: true });
    expect(subjects.status).toBe(400);
    expect(subjects.body.code).toBe("THRESHOLD_OUT_OF_RANGE");
  });

  it("sin evaluaciones no tiene umbral: se guarda en cero", async () => {
    await request(app())
      .put("/admin/academic-config/alert-rules")
      .set("Authorization", `Bearer ${tok()}`)
      .send({ type: "NO_ASSESSMENTS", threshold: 7, isActive: true });
    expect(prismaMock.academicAlertRule.create.mock.calls[0][0].data.threshold).toBe(0);
  });
});
