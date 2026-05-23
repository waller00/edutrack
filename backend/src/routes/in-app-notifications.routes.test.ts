import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { signAccessToken } from "../auth/jwt.js";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    inAppNotification: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("../db/prisma.js", () => ({ prisma: prismaMock }));

import inAppRoutes from "./in-app-notifications.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  a.use("/notifications/in-app", inAppRoutes);
  return a;
}

const uid = "00000000-0000-4000-8000-000000000099";
const auth = () => ({
  Authorization: `Bearer ${signAccessToken({ sub: uid, id: uid, email: "u@u.com", role: "TEACHER" })}`,
});

describe("in-app notifications routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GET / 401 sin token", async () => {
    const res = await request(app()).get("/notifications/in-app");
    expect(res.status).toBe(401);
  });

  it("GET / 200", async () => {
    prismaMock.inAppNotification.findMany.mockResolvedValue([
      {
        id: "n1",
        userId: uid,
        type: "LICENSE_CREATED",
        title: "Licencia registrada",
        body: "x",
        actionUrl: "/teacher/licenses",
        readAt: null,
        createdAt: new Date(),
      },
    ]);
    const res = await request(app()).get("/notifications/in-app").set(auth());
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });

  it("GET /unread-count 200", async () => {
    prismaMock.inAppNotification.count.mockResolvedValue(2);
    const res = await request(app()).get("/notifications/in-app/unread-count").set(auth());
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
  });

  it("PATCH /:id/read 404", async () => {
    prismaMock.inAppNotification.findFirst.mockResolvedValue(null);
    const res = await request(app()).patch("/notifications/in-app/nope/read").set(auth());
    expect(res.status).toBe(404);
  });

  it("PATCH /:id/read 200", async () => {
    prismaMock.inAppNotification.findFirst.mockResolvedValue({ id: "n1", userId: uid });
    prismaMock.inAppNotification.update.mockResolvedValue({
      id: "n1",
      readAt: new Date(),
    });
    const res = await request(app()).patch("/notifications/in-app/n1/read").set(auth());
    expect(res.status).toBe(200);
  });

  it("POST /read-all 200", async () => {
    prismaMock.inAppNotification.updateMany.mockResolvedValue({ count: 3 });
    const res = await request(app()).post("/notifications/in-app/read-all").set(auth()).send({});
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(3);
  });
});
