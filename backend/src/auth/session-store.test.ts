import { describe, it, expect, beforeEach, vi } from "vitest";

/** Redis en memoria con lo que usa el almacén de sesiones. */
const { store, sets, redisMock } = vi.hoisted(() => {
  const store = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  const redisMock = {
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return "OK";
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    mget: vi.fn(async (...keys: string[]) => keys.map((key) => store.get(key) ?? null)),
    del: vi.fn(async (...keys: string[]) => keys.filter((key) => store.delete(key) || sets.delete(key)).length),
    sadd: vi.fn(async (key: string, member: string) => {
      if (!sets.has(key)) sets.set(key, new Set());
      sets.get(key)!.add(member);
      return 1;
    }),
    srem: vi.fn(async (key: string, ...members: string[]) => members.filter((member) => sets.get(key)?.delete(member)).length),
    smembers: vi.fn(async (key: string) => [...(sets.get(key) ?? [])]),
    expire: vi.fn(async () => 1),
  };
  return { store, sets, redisMock };
});

vi.mock("../db/redis.js", () => ({ getRedis: () => redisMock }));

import { deleteOtherSessionsForUser, listSessionsForUser, saveSession, type BffSession } from "./session-store.js";

function session(sid: string, over: Partial<BffSession> = {}): BffSession {
  return {
    sid,
    userId: "user-1",
    kcId: "kc-1",
    email: "u@example.com",
    role: "STAFF",
    accessToken: "a",
    accessTokenExpiresAt: 0,
    createdAt: 1,
    ...over,
  };
}

beforeEach(() => {
  store.clear();
  sets.clear();
});

describe("listSessionsForUser", () => {
  it("devuelve las vivas y saca del índice las que vencieron", async () => {
    await saveSession(session("a", { userAgent: "Chrome" }));
    await saveSession(session("b"));
    store.delete("bff:sess:b");

    const sessions = await listSessionsForUser("user-1");

    expect(sessions.map((item) => item.sid)).toEqual(["a"]);
    expect(sessions[0].userAgent).toBe("Chrome");
    expect([...(sets.get("bff:user-sess:user-1") ?? [])]).toEqual(["a"]);
  });

  it("sin sesiones devuelve una lista vacía", async () => {
    await expect(listSessionsForUser("user-1")).resolves.toEqual([]);
  });
});

describe("deleteOtherSessionsForUser", () => {
  it("cierra las demás y conserva la de quien lo pide", async () => {
    await saveSession(session("actual"));
    await saveSession(session("celular"));
    await saveSession(session("otra-pc"));
    await saveSession(session("ajena", { userId: "user-2" }));

    await expect(deleteOtherSessionsForUser("user-1", "actual")).resolves.toBe(2);

    expect(store.has("bff:sess:actual")).toBe(true);
    expect(store.has("bff:sess:celular")).toBe(false);
    expect(store.has("bff:sess:otra-pc")).toBe(false);
    expect(store.has("bff:sess:ajena")).toBe(true);
    expect([...(sets.get("bff:user-sess:user-1") ?? [])]).toEqual(["actual"]);
  });

  it("sin otras sesiones no borra nada", async () => {
    await saveSession(session("actual"));
    redisMock.del.mockClear();
    await expect(deleteOtherSessionsForUser("user-1", "actual")).resolves.toBe(0);
    expect(redisMock.del).not.toHaveBeenCalled();
  });
});
