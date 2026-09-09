import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { signAccessToken } from "../test-utils/bearer-token.js";

const {
  prismaMock,
  enqueueMock,
  getMappedIdMock,
  getMappedIdsMock,
  provisionMock,
  resendMock,
  verificationsMock,
} = vi.hoisted(() => ({
  prismaMock: {
    student: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    user: { findFirst: vi.fn(), findUnique: vi.fn() },
    course: { findUnique: vi.fn() },
    studentPhoto: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    schoolYear: { findMany: vi.fn() },
    studentEnrollment: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    courseOffering: { findUnique: vi.fn() },
    courseOrientation: { findFirst: vi.fn() },
    studentTuitionYear: { createMany: vi.fn(), deleteMany: vi.fn() },
    studentTuitionMonth: { findMany: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  },
  enqueueMock: vi.fn(),
  getMappedIdMock: vi.fn(),
  getMappedIdsMock: vi.fn(),
  provisionMock: vi.fn(),
  resendMock: vi.fn(),
  verificationsMock: vi.fn(),
}));

vi.mock("../db/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../integrations/moodle/outbox.js", () => ({ enqueueStudentUserUpsert: enqueueMock }));
vi.mock("../integrations/moodle/object-map.js", () => ({
  getMappedId: getMappedIdMock,
  getMappedIds: getMappedIdsMock,
}));
vi.mock("../integrations/moodle/student-users.js", () => ({
  getStudentMoodleVerifications: verificationsMock,
  provisionStudentMoodleAccount: provisionMock,
  resendStudentMoodleWelcome: resendMock,
}));
vi.mock("../services/school-year-service.js", () => ({
  getActiveSchoolYearId: vi.fn().mockResolvedValue("sy-1"),
  resolveSchoolYearIdForList: vi.fn().mockResolvedValue("sy-1"),
  assertCourseOfferedInSchoolYear: vi.fn().mockResolvedValue({ id: "off-1" }),
}));

import adminStudentsRoutes from "./admin-students.js";
import { authGuard, requirePermission } from "../middlewares/auth.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  // Montado igual que en admin.ts.
  a.use("/admin/students", authGuard, requirePermission("students.manage", "all"), adminStudentsRoutes);
  return a;
}

const tok = (role = "ADMIN", sub = "admin-1") =>
  signAccessToken({ sub, email: "a@a.com", role: role as "ADMIN" });

const STUDENT_ID = "44444444-4444-4444-8444-444444444444";

/** Fila tal como la devuelven `create` / `findUniqueOrThrow` dentro de la transacción. */
function studentRow(over: Record<string, unknown> = {}) {
  return {
    id: STUDENT_ID,
    firstName: "Ana",
    lastName: "Díaz",
    documentId: "51234561",
    username: "ana.diaz",
    email: "ana@test.com",
    contactPhone: null,
    tutorPhone: null,
    address: null,
    healthCardExpiresAt: null,
    liceoAccessNotes: null,
    internalNotes: null,
    moodleWelcomeSentAt: null,
    enrollments: [],
    tuitionYears: [],
    createdAt: new Date("2026-03-01T12:00:00Z"),
    updatedAt: new Date("2026-03-01T12:00:00Z"),
    ...over,
  };
}

const VALID_CREATE = {
  firstName: "Ana",
  lastName: "Díaz",
  documentId: "5.123.456-1",
  email: "ana@test.com",
  username: "ana.diaz",
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation((fn: any) => fn(prismaMock));
  prismaMock.student.create.mockResolvedValue(studentRow());
  prismaMock.student.findUniqueOrThrow.mockResolvedValue(studentRow());
  prismaMock.student.findUnique.mockResolvedValue(studentRow());
  prismaMock.student.update.mockResolvedValue(studentRow());
  prismaMock.student.findFirst.mockResolvedValue(null);
  prismaMock.user.findFirst.mockResolvedValue(null);
  prismaMock.studentTuitionMonth.findMany.mockResolvedValue([]);
  prismaMock.studentEnrollment.findUnique.mockResolvedValue(null);
  prismaMock.studentEnrollment.upsert.mockResolvedValue({});
  prismaMock.courseOffering.findUnique.mockResolvedValue(null);
  prismaMock.courseOrientation.findFirst.mockResolvedValue(null);
  prismaMock.studentTuitionYear.deleteMany.mockResolvedValue({ count: 0 });
  prismaMock.schoolYear.findMany.mockResolvedValue([]);
  prismaMock.$queryRaw.mockResolvedValue([]);
  prismaMock.$executeRaw.mockResolvedValue(1);
  prismaMock.studentPhoto.findUnique.mockResolvedValue(null);
  prismaMock.studentPhoto.deleteMany.mockResolvedValue({ count: 1 });
  getMappedIdMock.mockResolvedValue(null);
  getMappedIdsMock.mockResolvedValue(new Map());
  verificationsMock.mockResolvedValue(new Map());
});

describe("alta: la cuenta de Moodle ya no se crea sola", () => {
  it("crea el estudiante sin encolar ninguna tarea de Moodle", async () => {
    const res = await request(app())
      .post("/admin/students")
      .set("Authorization", `Bearer ${tok()}`)
      .send(VALID_CREATE);

    expect(res.status).toBe(201);
    // La regresión que sostiene toda la funcionalidad: crear no provisiona.
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("deja crear sin email ni usuario", async () => {
    prismaMock.student.create.mockResolvedValue(studentRow({ email: null, username: null }));
    prismaMock.student.findUniqueOrThrow.mockResolvedValue(studentRow({ email: null, username: null }));

    const res = await request(app())
      .post("/admin/students")
      .set("Authorization", `Bearer ${tok()}`)
      .send({ firstName: "Ana", lastName: "Díaz", documentId: "5.123.456-1" });

    expect(res.status).toBe(201);
    expect(prismaMock.student.create.mock.calls[0][0].data).toMatchObject({
      email: null,
      username: null,
    });
  });

  it("sin email no consulta conflictos de email", async () => {
    await request(app())
      .post("/admin/students")
      .set("Authorization", `Bearer ${tok()}`)
      .send({ firstName: "Ana", lastName: "Díaz", documentId: "5.123.456-1" });

    expect(prismaMock.student.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
  });

  it("sigue validando el formato del email cuando viene", async () => {
    const res = await request(app())
      .post("/admin/students")
      .set("Authorization", `Bearer ${tok()}`)
      .send({ ...VALID_CREATE, email: "no-es-un-email" });

    expect(res.status).toBe(400);
    expect(res.body.detail).toMatch(/Email inválido/);
  });

  it("sigue rechazando un email ya usado", async () => {
    prismaMock.student.findFirst.mockResolvedValue({ id: "otro" });

    const res = await request(app())
      .post("/admin/students")
      .set("Authorization", `Bearer ${tok()}`)
      .send(VALID_CREATE);

    expect(res.status).toBe(409);
  });
});

describe("edición: sólo se propaga a quien ya tiene cuenta", () => {
  const RENAME = { firstName: "Ana María" };

  it("encola si el estudiante ya está vinculado a Moodle", async () => {
    getMappedIdMock.mockResolvedValue(90);
    prismaMock.student.update.mockResolvedValue(studentRow({ firstName: "Ana María" }));
    prismaMock.student.findUniqueOrThrow.mockResolvedValue(studentRow({ firstName: "Ana María" }));

    const res = await request(app())
      .put(`/admin/students/${STUDENT_ID}`)
      .set("Authorization", `Bearer ${tok()}`)
      .send(RENAME);

    expect(res.status).toBe(200);
    expect(enqueueMock).toHaveBeenCalledWith(STUDENT_ID);
  });

  it("NO encola si el estudiante nunca tuvo cuenta", async () => {
    prismaMock.studentPhoto.findUnique.mockResolvedValue(null);
  prismaMock.studentPhoto.deleteMany.mockResolvedValue({ count: 1 });
  getMappedIdMock.mockResolvedValue(null);
    prismaMock.student.update.mockResolvedValue(studentRow({ firstName: "Ana María" }));
    prismaMock.student.findUniqueOrThrow.mockResolvedValue(studentRow({ firstName: "Ana María" }));

    const res = await request(app())
      .put(`/admin/students/${STUDENT_ID}`)
      .set("Authorization", `Bearer ${tok()}`)
      .send(RENAME);

    expect(res.status).toBe(200);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("no encola si no cambió nada de la cuenta", async () => {
    getMappedIdMock.mockResolvedValue(90);

    await request(app())
      .put(`/admin/students/${STUDENT_ID}`)
      .set("Authorization", `Bearer ${tok()}`)
      .send({ contactPhone: "099111222" });

    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("409 al querer quitarle el email a un alumno con cuenta de Moodle", async () => {
    // Dejaría la cuenta de Moodle con la dirección vieja y sin forma de volver a alinearla.
    getMappedIdMock.mockResolvedValue(90);

    const res = await request(app())
      .put(`/admin/students/${STUDENT_ID}`)
      .set("Authorization", `Bearer ${tok()}`)
      .send({ email: "" });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/cuenta de Moodle/);
    expect(prismaMock.student.update).not.toHaveBeenCalled();
  });

  it("deja quitar el email si el alumno no tiene cuenta", async () => {
    prismaMock.studentPhoto.findUnique.mockResolvedValue(null);
  prismaMock.studentPhoto.deleteMany.mockResolvedValue({ count: 1 });
  getMappedIdMock.mockResolvedValue(null);
    prismaMock.student.update.mockResolvedValue(studentRow({ email: null }));
    prismaMock.student.findUniqueOrThrow.mockResolvedValue(studentRow({ email: null }));

    const res = await request(app())
      .put(`/admin/students/${STUDENT_ID}`)
      .set("Authorization", `Bearer ${tok()}`)
      .send({ email: "" });

    expect(res.status).toBe(200);
    expect(res.body.email).toBeNull();
  });
});

describe("POST /:id/moodle-account", () => {
  it("crea la cuenta y devuelve el estado vinculado", async () => {
    provisionMock.mockResolvedValue({
      moodleId: 90,
      welcomeSentAt: new Date("2026-03-02T10:00:00Z"),
      alreadyLinked: false,
    });
    getMappedIdMock.mockResolvedValue(90);

    const res = await request(app())
      .post(`/admin/students/${STUDENT_ID}/moodle-account`)
      .set("Authorization", `Bearer ${tok()}`);

    expect(res.status).toBe(200);
    expect(provisionMock).toHaveBeenCalledWith(STUDENT_ID);
    expect(res.body.moodle.linked).toBe(true);
    expect(res.body.moodle.welcomeSentAt).toBe("2026-03-02T10:00:00.000Z");
  });

  it("400 si le faltan email o usuario", async () => {
    provisionMock.mockRejectedValue(new Error("MOODLE_STUDENT_ACCOUNT_FIELDS_REQUIRED"));

    const res = await request(app())
      .post(`/admin/students/${STUDENT_ID}/moodle-account`)
      .set("Authorization", `Bearer ${tok()}`);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/email y el usuario/i);
  });

  it("503 si Moodle no está configurado", async () => {
    provisionMock.mockRejectedValue(new Error("MOODLE_NOT_CONFIGURED"));

    const res = await request(app())
      .post(`/admin/students/${STUDENT_ID}/moodle-account`)
      .set("Authorization", `Bearer ${tok()}`);

    expect(res.status).toBe(503);
  });

  it("404 si el estudiante no existe", async () => {
    provisionMock.mockRejectedValue(new Error("MOODLE_STUDENT_NOT_FOUND"));

    const res = await request(app())
      .post(`/admin/students/${STUDENT_ID}/moodle-account`)
      .set("Authorization", `Bearer ${tok()}`);

    expect(res.status).toBe(404);
  });

  it("un docente no puede provisionar cuentas", async () => {
    const res = await request(app())
      .post(`/admin/students/${STUDENT_ID}/moodle-account`)
      .set("Authorization", `Bearer ${tok("TEACHER", "t-1")}`);

    expect(res.status).toBe(403);
    expect(provisionMock).not.toHaveBeenCalled();
  });
});

describe("estado Moodle en la respuesta", () => {
  it("linked=false cuando no hay mapeo", async () => {
    prismaMock.studentPhoto.findUnique.mockResolvedValue(null);
  prismaMock.studentPhoto.deleteMany.mockResolvedValue({ count: 1 });
  getMappedIdMock.mockResolvedValue(null);

    const res = await request(app())
      .post("/admin/students")
      .set("Authorization", `Bearer ${tok()}`)
      .send(VALID_CREATE);

    expect(res.body.moodle.linked).toBe(false);
    expect(res.body.moodle.canProvision).toBe(true);
  });

  it("canProvision=false sin email ni usuario", async () => {
    prismaMock.student.create.mockResolvedValue(studentRow({ email: null, username: null }));
    prismaMock.student.findUniqueOrThrow.mockResolvedValue(studentRow({ email: null, username: null }));

    const res = await request(app())
      .post("/admin/students")
      .set("Authorization", `Bearer ${tok()}`)
      .send({ firstName: "Ana", lastName: "Díaz", documentId: "5.123.456-1" });

    expect(res.body.moodle.canProvision).toBe(false);
  });
});

describe("foto del alumno", () => {
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const STORED = {
    studentId: STUDENT_ID,
    bytes: JPEG,
    mimeType: "image/jpeg",
    byteSize: JPEG.length,
    updatedAt: new Date("2026-03-05T09:00:00Z"),
  };

  it("404 si el alumno no tiene foto", async () => {
    const res = await request(app())
      .get(`/admin/students/${STUDENT_ID}/photo`)
      .set("Authorization", `Bearer ${tok()}`);

    expect(res.status).toBe(404);
  });

  it("devuelve los bytes con el tipo guardado y cabeceras seguras", async () => {
    prismaMock.studentPhoto.findUnique.mockResolvedValue(STORED);

    const res = await request(app())
      .get(`/admin/students/${STUDENT_ID}/photo`)
      .set("Authorization", `Bearer ${tok()}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/jpeg");
    expect(Buffer.from(res.body)).toEqual(JPEG);
    // Nunca cacheable en compartido: es dato personal de un menor y hay Cloudflare adelante.
    expect(res.headers["cache-control"]).toContain("private");
    expect(res.headers["cache-control"]).not.toContain("public");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers.etag).toBeDefined();
  });

  it("responde 304 si el navegador ya tiene esa versión", async () => {
    prismaMock.studentPhoto.findUnique.mockResolvedValue(STORED);
    const first = await request(app())
      .get(`/admin/students/${STUDENT_ID}/photo`)
      .set("Authorization", `Bearer ${tok()}`);

    const res = await request(app())
      .get(`/admin/students/${STUDENT_ID}/photo`)
      .set("Authorization", `Bearer ${tok()}`)
      .set("If-None-Match", first.headers.etag);

    expect(res.status).toBe(304);
  });

  it("guarda un JPEG válido", async () => {
    prismaMock.studentPhoto.upsert.mockResolvedValue({ ...STORED });

    const res = await request(app())
      .put(`/admin/students/${STUDENT_ID}/photo`)
      .set("Authorization", `Bearer ${tok()}`)
      .set("Content-Type", "image/jpeg")
      .send(JPEG);

    expect(res.status).toBe(200);
    const data = prismaMock.studentPhoto.upsert.mock.calls[0][0].update;
    expect(data.mimeType).toBe("image/jpeg");
    expect(data.byteSize).toBe(JPEG.length);
    expect(Buffer.isBuffer(data.bytes)).toBe(true);
  });

  it("400 si el contenido no coincide con el tipo declarado", async () => {
    const res = await request(app())
      .put(`/admin/students/${STUDENT_ID}/photo`)
      .set("Authorization", `Bearer ${tok()}`)
      .set("Content-Type", "image/jpeg")
      .send(PNG);

    expect(res.status).toBe(400);
    expect(prismaMock.studentPhoto.upsert).not.toHaveBeenCalled();
  });

  it("415 ante un SVG, sin romperse", async () => {
    // Sin re-codificación posible, un SVG servido inline sería XSS almacenado.
    const res = await request(app())
      .put(`/admin/students/${STUDENT_ID}/photo`)
      .set("Authorization", `Bearer ${tok()}`)
      .set("Content-Type", "image/svg+xml")
      .send(Buffer.from("<svg><script>alert(1)</script></svg>"));

    expect(res.status).toBe(415);
    expect(prismaMock.studentPhoto.upsert).not.toHaveBeenCalled();
  });

  it("413 en JSON cuando la foto excede el límite del parser", async () => {
    const res = await request(app())
      .put(`/admin/students/${STUDENT_ID}/photo`)
      .set("Authorization", `Bearer ${tok()}`)
      .set("Content-Type", "image/jpeg")
      .send(Buffer.concat([JPEG, Buffer.alloc(1_600_000)]));

    expect(res.status).toBe(413);
    // En JSON, no el HTML por defecto de Express: `api()` no sabe parsear HTML.
    expect(res.body.message).toMatch(/1 MB/);
  });

  it("404 si el estudiante no existe", async () => {
    prismaMock.student.findUnique.mockResolvedValue(null);

    const res = await request(app())
      .put(`/admin/students/${STUDENT_ID}/photo`)
      .set("Authorization", `Bearer ${tok()}`)
      .set("Content-Type", "image/jpeg")
      .send(JPEG);

    expect(res.status).toBe(404);
    expect(prismaMock.studentPhoto.upsert).not.toHaveBeenCalled();
  });

  it("borrar es idempotente", async () => {
    const res = await request(app())
      .delete(`/admin/students/${STUDENT_ID}/photo`)
      .set("Authorization", `Bearer ${tok()}`);

    expect(res.status).toBe(204);
    expect(prismaMock.studentPhoto.deleteMany).toHaveBeenCalledWith({
      where: { studentId: STUDENT_ID },
    });
  });

  it("un docente no puede tocar la foto", async () => {
    const res = await request(app())
      .delete(`/admin/students/${STUDENT_ID}/photo`)
      .set("Authorization", `Bearer ${tok("TEACHER", "t-1")}`);

    expect(res.status).toBe(403);
  });

  it("el detalle expone los metadatos de la foto pero nunca los bytes", async () => {
    prismaMock.student.create.mockResolvedValue(studentRow({ photo: STORED }));
    prismaMock.student.findUniqueOrThrow.mockResolvedValue(studentRow({ photo: STORED }));

    const res = await request(app())
      .post("/admin/students")
      .set("Authorization", `Bearer ${tok()}`)
      .send(VALID_CREATE);

    expect(res.body.photo).toEqual({
      mimeType: "image/jpeg",
      byteSize: JPEG.length,
      updatedAt: "2026-03-05T09:00:00.000Z",
    });
    expect(JSON.stringify(res.body)).not.toContain("bytes");
  });
});
