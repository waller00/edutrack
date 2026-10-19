import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests de los helpers de Admin API que usan el alta con Google y "Crear contraseña":
 * si la cuenta tiene contraseña, ponerle la primera y cerrar sus sesiones de Keycloak.
 */

const BASE = "http://keycloak:8080";
const USER = "/admin/realms/edutrack/users/kc-1";

type Route = { status: number; body?: unknown };

function jsonResponse(status: number, body: unknown = {}): Response {
  if (status === 204) return new Response(null, { status });
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function stubFetch(routes: Record<string, Route>) {
  const calls: Array<{ key: string; body?: string }> = [];
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const key = `${(init?.method || "GET").toUpperCase()} ${String(input).replace(BASE, "")}`;
    calls.push({ key, body: typeof init?.body === "string" ? init.body : undefined });
    if (key === "POST /realms/master/protocol/openid-connect/token") return jsonResponse(200, { access_token: "admin-token" });
    const route = routes[key];
    if (!route) throw new Error(`Ruta no mockeada: ${key}`);
    return jsonResponse(route.status, route.body);
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

async function loadModule() {
  vi.resetModules();
  return import("./keycloak");
}

describe("helpers de cuenta (Admin API de Keycloak)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    process.env.KEYCLOAK_ADMIN_BASE_URL = BASE;
    process.env.KEYCLOAK_ADMIN_REALM = "edutrack";
  });

  it("keycloakUserHasPassword: false para una cuenta que sólo tiene Google (y 2FA)", async () => {
    stubFetch({ [`GET ${USER}/credentials`]: { status: 200, body: [{ type: "otp" }] } });
    const kc = await loadModule();

    await expect(kc.keycloakUserHasPassword("kc-1")).resolves.toBe(false);
  });

  it("keycloakUserHasPassword: true si hay una credencial de contraseña", async () => {
    stubFetch({ [`GET ${USER}/credentials`]: { status: 200, body: [{ type: "password" }, { type: "otp" }] } });
    const kc = await loadModule();

    await expect(kc.keycloakUserHasPassword("kc-1")).resolves.toBe(true);
  });

  it("keycloakUserHasPassword: falla si Keycloak no responde bien", async () => {
    stubFetch({ [`GET ${USER}/credentials`]: { status: 500, body: { error: "boom" } } });
    const kc = await loadModule();

    await expect(kc.keycloakUserHasPassword("kc-1")).rejects.toThrow(/credentials error 500/);
  });

  it("setInitialKeycloakPassword: pone una contraseña permanente", async () => {
    const calls = stubFetch({ [`PUT ${USER}/reset-password`]: { status: 204 } });
    const kc = await loadModule();

    await kc.setInitialKeycloakPassword("kc-1", "Segura123!");

    const put = calls.find((c) => c.key === `PUT ${USER}/reset-password`);
    expect(JSON.parse(put?.body ?? "{}")).toEqual({ type: "password", value: "Segura123!", temporary: false });
  });

  it("setInitialKeycloakPassword: el rechazo de la política sale con status 400", async () => {
    stubFetch({ [`PUT ${USER}/reset-password`]: { status: 400, body: { error: "invalidPasswordNotUsernameMessage" } } });
    const kc = await loadModule();

    await expect(kc.setInitialKeycloakPassword("kc-1", "Segura123!")).rejects.toMatchObject({ status: 400 });
  });

  it("logoutKeycloakUserSessions: cierra las sesiones del usuario", async () => {
    const calls = stubFetch({ [`POST ${USER}/logout`]: { status: 204 } });
    const kc = await loadModule();

    await kc.logoutKeycloakUserSessions("kc-1");

    expect(calls.map((c) => c.key)).toContain(`POST ${USER}/logout`);
  });

  it("logoutKeycloakUserSessions: falla si Keycloak lo rechaza", async () => {
    stubFetch({ [`POST ${USER}/logout`]: { status: 404, body: { error: "User not found" } } });
    const kc = await loadModule();

    await expect(kc.logoutKeycloakUserSessions("kc-1")).rejects.toThrow(/logout user error 404/);
  });
});
