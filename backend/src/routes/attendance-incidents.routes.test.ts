import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { signAccessToken } from "../jwt.js";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    attendanceIncident: {
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("../prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../services/attendance-incidents.js", () => ({
  scanAndCreateTeacherNoShowIncidents: vi.fn(),
}));

import routes from "./attendance-incidents.js";
import { scanAndCreateTeacherNoShowIncidents } from "../services/attendance-incidents.js";

const scanMock = vi.mocked(scanAndCreateTeacherNoShowIncidents);

function app() {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  a.use("/attendance-incidents", routes);
  return a;
}

const tok = (role = "ADMIN") =>
  signAccessToken({ sub: "user-1", email: "u@u.com", role: role as "ADMIN" });

describe("attendance incidents routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.attendanceIncident.count.mockResolvedValue(1);
    prismaMock.attendanceIncident.findMany.mockResolvedValue([{ id: "inc-1", status: "OPEN" }]);
    scanMock.mockResolvedValue({ scanned: 2, opened: 1, resolved: 0, graceMinutes: 15 });
  });

  it("GET /attendance-incidents lista incidentes para admin", async () => {
    const res = await request(app()).get("/attendance-incidents").set("Authorization", `Bearer ${tok("ADMIN")}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });

  it("POST /attendance-incidents/scan-now dispara escaneo", async () => {
    const res = await request(app())
      .post("/attendance-incidents/scan-now")
      .set("Authorization", `Bearer ${tok("ADMIN")}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.opened).toBe(1);
  });
});
