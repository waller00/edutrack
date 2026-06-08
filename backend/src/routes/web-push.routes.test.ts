import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { signAccessToken } from "../test-utils/bearer-token.js";

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn().mockResolvedValue({}),
  },
}));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    webPushSubscription: {
      upsert: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("../db/prisma.js", () => ({ prisma: prismaMock }));

import webPushRoutes from "./web-push.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  a.use("/notifications/web-push", webPushRoutes);
  return a;
}

const uid = "00000000-0000-4000-8000-000000000099";
const auth = () => ({
  Authorization: `Bearer ${signAccessToken({ sub: uid, id: uid, email: "u@u.com", role: "TEACHER" })}`,
});

describe("web-push routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
  });

  afterEach(() => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
  });

  it("GET /vapid-public-key 503 sin VAPID", async () => {
    const res = await request(app()).get("/notifications/web-push/vapid-public-key");
    expect(res.status).toBe(503);
  });

  it("GET /vapid-public-key 200 con VAPID", async () => {
    process.env.VAPID_SUBJECT = "mailto:test@example.com";
    process.env.VAPID_PUBLIC_KEY = "BKxTestPublicKeyDummyValue123456789012345678901234567890123456789012345678901234567890";
    process.env.VAPID_PRIVATE_KEY = "8TestPrivateKeyDummyValue12345678901234567890123456789012";
    const res = await request(app()).get("/notifications/web-push/vapid-public-key");
    expect(res.status).toBe(200);
    expect(res.body.publicKey).toContain("BKx");
  });

  it("GET /status 401 sin token", async () => {
    const res = await request(app()).get("/notifications/web-push/status");
    expect(res.status).toBe(401);
  });

  it("GET /status 200", async () => {
    prismaMock.webPushSubscription.count.mockResolvedValue(2);
    const res = await request(app()).get("/notifications/web-push/status").set(auth());
    expect(res.status).toBe(200);
    expect(res.body.subscriptionCount).toBe(2);
    expect(res.body.configured).toBe(false);
  });

  it("POST /subscribe 503 sin VAPID", async () => {
    const res = await request(app()).post("/notifications/web-push/subscribe").set(auth()).send({
      subscription: {
        endpoint: "https://example.com/push/1",
        keys: { p256dh: "x", auth: "y" },
      },
    });
    expect(res.status).toBe(503);
  });

  it("POST /subscribe 201", async () => {
    process.env.VAPID_SUBJECT = "mailto:test@example.com";
    process.env.VAPID_PUBLIC_KEY = "BKxTestPublicKeyDummyValue123456789012345678901234567890123456789012345678901234567890";
    process.env.VAPID_PRIVATE_KEY = "8TestPrivateKeyDummyValue12345678901234567890123456789012";
    prismaMock.webPushSubscription.upsert.mockResolvedValue({});
    const res = await request(app()).post("/notifications/web-push/subscribe").set(auth()).send({
      subscription: {
        endpoint: "https://updates.push.services.mozilla.com/wpush/v2/gAAAAA",
        keys: { p256dh: "dGVzdA", auth: "dGVzdDI" },
      },
    });
    expect(res.status).toBe(201);
    expect(prismaMock.webPushSubscription.upsert).toHaveBeenCalled();
  });

  it("DELETE /subscribe 200", async () => {
    prismaMock.webPushSubscription.deleteMany.mockResolvedValue({ count: 1 });
    const res = await request(app())
      .delete("/notifications/web-push/subscribe")
      .set(auth())
      .send({});
    expect(res.status).toBe(200);
  });

  it("POST /test 503 sin VAPID", async () => {
    const res = await request(app()).post("/notifications/web-push/test").set(auth()).send({});
    expect(res.status).toBe(503);
  });

  it("POST /test 200 con VAPID", async () => {
    process.env.VAPID_SUBJECT = "mailto:test@example.com";
    process.env.VAPID_PUBLIC_KEY = "BKxTestPublicKeyDummyValue123456789012345678901234567890123456789012345678901234567890";
    process.env.VAPID_PRIVATE_KEY = "8TestPrivateKeyDummyValue12345678901234567890123456789012";
    prismaMock.webPushSubscription.findMany.mockResolvedValue([
      { id: "s1", userId: uid, endpoint: "https://updates.push.services.mozilla.com/wpush/v2/abc", p256dh: "x", auth: "y", userAgent: null },
    ]);
    const res = await request(app()).post("/notifications/web-push/test").set(auth()).send({});
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(1);
    expect(res.body.failed).toBe(0);
  });

  function withVapid() {
    process.env.VAPID_SUBJECT = "mailto:test@example.com";
    process.env.VAPID_PUBLIC_KEY = "BKxTestPublicKeyDummyValue123456789012345678901234567890123456789012345678901234567890";
    process.env.VAPID_PRIVATE_KEY = "8TestPrivateKeyDummyValue12345678901234567890123456789012";
  }

  it("POST /subscribe 201 con VAPID y body válido", async () => {
    withVapid();
    prismaMock.webPushSubscription.upsert.mockResolvedValue({});
    const res = await request(app()).post("/notifications/web-push/subscribe").set(auth()).send({
      subscription: { endpoint: "https://push.example.com/abc", keys: { p256dh: "p", auth: "a" } },
      userAgent: "test-agent",
    });
    expect(res.status).toBe(201);
  });

  it("POST /subscribe 400 con VAPID y body inválido", async () => {
    withVapid();
    const res = await request(app())
      .post("/notifications/web-push/subscribe")
      .set(auth())
      .send({ subscription: { endpoint: "no-es-url" } });
    expect(res.status).toBe(400);
  });

  it("DELETE /subscribe 401 sin token", async () => {
    const res = await request(app()).delete("/notifications/web-push/subscribe");
    expect(res.status).toBe(401);
  });

  it("DELETE /subscribe 200 con endpoint específico", async () => {
    prismaMock.webPushSubscription.deleteMany.mockResolvedValue({ count: 1 });
    const res = await request(app())
      .delete("/notifications/web-push/subscribe")
      .set(auth())
      .send({ endpoint: "https://push.example.com/abc" });
    expect(res.status).toBe(200);
    expect(prismaMock.webPushSubscription.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ endpoint: "https://push.example.com/abc" }) }),
    );
  });

  it("DELETE /subscribe 200 borra todas sin endpoint", async () => {
    prismaMock.webPushSubscription.deleteMany.mockResolvedValue({ count: 2 });
    const res = await request(app()).delete("/notifications/web-push/subscribe").set(auth()).send({});
    expect(res.status).toBe(200);
  });
});
