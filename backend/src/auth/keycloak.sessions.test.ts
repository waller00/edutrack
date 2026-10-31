import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * "Cerrar las otras sesiones" cierra también el ingreso único de Keycloak de los otros navegadores:
 * si no, al tocar "Ingresar" volverían a entrar sin contraseña. La de este navegador queda.
 */

const BASE = "http://keycloak:8080";
const REALM = "/admin/realms/edutrack";

function json(status: number, body: unknown = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function loadModule() {
  vi.resetModules();
  return import("./keycloak");
}

function jwt(payload: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;
}

describe("keycloakSessionIdOf", () => {
  it("lee el sid del token", async () => {
    const kc = await loadModule();
    expect(kc.keycloakSessionIdOf(jwt({ sub: "kc-1", sid: "sess-1" }))).toBe("sess-1");
  });

  it("sin token, sin sid o con un token roto devuelve null", async () => {
    const kc = await loadModule();
    expect(kc.keycloakSessionIdOf(undefined)).toBeNull();
    expect(kc.keycloakSessionIdOf(jwt({ sub: "kc-1" }))).toBeNull();
    expect(kc.keycloakSessionIdOf("no-es-un-jwt")).toBeNull();
    expect(kc.keycloakSessionIdOf("a.%%%.b")).toBeNull();
  });
});

describe("logoutOtherKeycloakSessions", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    process.env.KEYCLOAK_ADMIN_BASE_URL = BASE;
    process.env.KEYCLOAK_ADMIN_REALM = "edutrack";
  });

  function keycloak(sessions: Array<{ id: string }>, deleteStatus: (id: string) => number = () => 204) {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const method = (init?.method || "GET").toUpperCase();
      const path = String(input).replace(BASE, "");
      calls.push(`${method} ${path}`);
      if (path === "/realms/master/protocol/openid-connect/token") return json(200, { access_token: "t", expires_in: 60 });
      if (method === "GET" && path === `${REALM}/users/kc-1/sessions`) return json(200, sessions);
      if (method === "DELETE" && path.startsWith(`${REALM}/sessions/`)) return json(deleteStatus(path.split("/").pop() ?? ""));
      throw new Error(`Ruta no mockeada: ${method} ${path}`);
    });
    return { fetchMock, calls };
  }

  it("cierra todas menos la de este navegador", async () => {
    const { fetchMock, calls } = keycloak([{ id: "s-actual" }, { id: "s-celular" }, { id: "s-otra-pc" }]);
    vi.stubGlobal("fetch", fetchMock);
    const kc = await loadModule();

    await expect(kc.logoutOtherKeycloakSessions("kc-1", "s-actual")).resolves.toBe(2);

    expect(calls.filter((call) => call.startsWith("DELETE"))).toEqual([
      `DELETE ${REALM}/sessions/s-celular`,
      `DELETE ${REALM}/sessions/s-otra-pc`,
    ]);
  });

  it("una sesión que ya venció (404) no es un error", async () => {
    const { fetchMock } = keycloak([{ id: "s-actual" }, { id: "s-vencida" }], () => 404);
    vi.stubGlobal("fetch", fetchMock);
    const kc = await loadModule();

    await expect(kc.logoutOtherKeycloakSessions("kc-1", "s-actual")).resolves.toBe(1);
  });

  it("si Keycloak no la cierra, falla", async () => {
    const { fetchMock } = keycloak([{ id: "s-actual" }, { id: "s-otra" }], () => 500);
    vi.stubGlobal("fetch", fetchMock);
    const kc = await loadModule();

    await expect(kc.logoutOtherKeycloakSessions("kc-1", "s-actual")).rejects.toThrow(/session logout error 500/);
  });
});
