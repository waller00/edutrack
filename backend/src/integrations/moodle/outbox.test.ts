import { describe, it, expect, beforeEach, vi } from "vitest";

const { enabledMock, syncUserMock, prismaMock } = vi.hoisted(() => ({
  enabledMock: vi.fn(),
  syncUserMock: vi.fn(),
  prismaMock: {
    moodleSyncTask: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("./client.js", () => ({ isMoodleIntegrationEnabled: enabledMock }));
vi.mock("./users.js", () => ({ syncMoodleUserById: syncUserMock }));
vi.mock("../../db/prisma.js", () => ({ prisma: prismaMock }));

import { enqueueUserUpsert, processOutboxOnce, releaseStaleLocks } from "./outbox.js";

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    type: "USER_UPSERT",
    dedupeKey: "user:u1",
    payload: { userId: "u1" },
    attempts: 0,
    maxAttempts: 5,
    runAfter: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  enabledMock.mockReset().mockReturnValue(true);
  syncUserMock.mockReset().mockResolvedValue(1);
  prismaMock.moodleSyncTask.upsert.mockReset().mockResolvedValue({});
  prismaMock.moodleSyncTask.findMany.mockReset().mockResolvedValue([]);
  prismaMock.moodleSyncTask.updateMany.mockReset().mockResolvedValue({ count: 1 });
  prismaMock.moodleSyncTask.update.mockReset().mockResolvedValue({});
});

describe("enqueueUserUpsert", () => {
  it("no encola si la integración está deshabilitada", async () => {
    enabledMock.mockReturnValue(false);
    await enqueueUserUpsert("u1");
    expect(prismaMock.moodleSyncTask.upsert).not.toHaveBeenCalled();
  });

  it("hace upsert idempotente por dedupeKey y reabre la tarea", async () => {
    await enqueueUserUpsert("u1");
    const arg = prismaMock.moodleSyncTask.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ dedupeKey: "user:u1" });
    expect(arg.create.type).toBe("USER_UPSERT");
    expect(arg.update.status).toBe("PENDING");
    expect(arg.update.attempts).toBe(0);
  });

  it("no propaga errores de base (encolar nunca debe romper el flujo de negocio)", async () => {
    prismaMock.moodleSyncTask.upsert.mockRejectedValue(new Error("db down"));
    await expect(enqueueUserUpsert("u1")).resolves.toBeUndefined();
  });
});

describe("processOutboxOnce", () => {
  it("devuelve 0 si la integración está deshabilitada", async () => {
    enabledMock.mockReturnValue(false);
    expect(await processOutboxOnce()).toBe(0);
    expect(prismaMock.moodleSyncTask.findMany).not.toHaveBeenCalled();
  });

  it("reclama y ejecuta una tarea pendiente, marcándola DONE", async () => {
    prismaMock.moodleSyncTask.findMany.mockResolvedValue([task()]);
    const processed = await processOutboxOnce();
    expect(processed).toBe(1);
    expect(syncUserMock).toHaveBeenCalledWith("u1");
    const updateArg = prismaMock.moodleSyncTask.update.mock.calls[0][0];
    expect(updateArg.data.status).toBe("DONE");
    expect(updateArg.data.attempts).toBe(1);
    expect(updateArg.data.lockedAt).toBeNull();
  });

  it("salta la tarea si el claim atómico no la consigue (otra réplica la tomó)", async () => {
    prismaMock.moodleSyncTask.findMany.mockResolvedValue([task()]);
    prismaMock.moodleSyncTask.updateMany.mockResolvedValue({ count: 0 });
    const processed = await processOutboxOnce();
    expect(processed).toBe(0);
    expect(syncUserMock).not.toHaveBeenCalled();
    expect(prismaMock.moodleSyncTask.update).not.toHaveBeenCalled();
  });

  it("ante fallo no agotado, reprograma con backoff y vuelve a PENDING", async () => {
    prismaMock.moodleSyncTask.findMany.mockResolvedValue([task({ attempts: 0, maxAttempts: 5 })]);
    syncUserMock.mockRejectedValue(new Error("MOODLE_HTTP_503"));

    await processOutboxOnce();

    const data = prismaMock.moodleSyncTask.update.mock.calls[0][0].data;
    expect(data.status).toBe("PENDING");
    expect(data.attempts).toBe(1);
    expect(data.lastError).toContain("MOODLE_HTTP_503");
    expect(data.runAfter.getTime()).toBeGreaterThan(Date.now());
  });

  it("ante fallo que agota maxAttempts, marca FAILED", async () => {
    prismaMock.moodleSyncTask.findMany.mockResolvedValue([task({ attempts: 4, maxAttempts: 5 })]);
    syncUserMock.mockRejectedValue(new Error("MOODLE_TIMEOUT"));

    await processOutboxOnce();

    const data = prismaMock.moodleSyncTask.update.mock.calls[0][0].data;
    expect(data.status).toBe("FAILED");
    expect(data.attempts).toBe(5);
  });

  it("falla la tarea si el tipo es desconocido", async () => {
    prismaMock.moodleSyncTask.findMany.mockResolvedValue([
      task({ type: "WHAT_IS_THIS", maxAttempts: 1 }),
    ]);
    await processOutboxOnce();
    const data = prismaMock.moodleSyncTask.update.mock.calls[0][0].data;
    expect(data.status).toBe("FAILED");
    expect(data.lastError).toContain("MOODLE_TASK_UNKNOWN_TYPE");
  });
});

describe("releaseStaleLocks", () => {
  it("libera los locks más viejos que el umbral", async () => {
    await releaseStaleLocks(60_000);
    const arg = prismaMock.moodleSyncTask.updateMany.mock.calls[0][0];
    expect(arg.where.status).toBe("PENDING");
    expect(arg.where.lockedAt.lt).toBeInstanceOf(Date);
    expect(arg.data.lockedAt).toBeNull();
  });
});
