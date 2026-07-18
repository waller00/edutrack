import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests de verifyKeycloakUserOtpCode: la validación del código TOTP se delega
 * en Keycloak vía un flujo de direct grant (usuario + OTP, sin contraseña) con
 * un cliente confidencial aprovisionado de forma idempotente por Admin API.
 */

const BASE = "http://keycloak:8080";

type RouteHandler = (init?: RequestInit) => { status: number; body?: unknown };

function jsonResponse(status: number, body: unknown = {}): Response {
  if (status === 204) return new Response(null, { status });
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function buildFetchMock(overrides: Record<string, RouteHandler> = {}) {
  const calls: Array<{ method: string; url: string; body?: string }> = [];
  let flowCreated = false;
  let clientCreated = false;

  const defaults: Record<string, RouteHandler> = {
    "POST /realms/master/protocol/openid-connect/token": () => ({ status: 200, body: { access_token: "admin-token" } }),
    "GET /admin/realms/edutrack/users/kc-1": () => ({ status: 200, body: { id: "kc-1", username: "admin" } }),
    "GET /admin/realms/edutrack/authentication/flows": () => ({
      status: 200,
      body: flowCreated ? [{ id: "flow-1", alias: "edutrack-direct-grant-otp" }] : [],
    }),
    "POST /admin/realms/edutrack/authentication/flows": () => {
      flowCreated = true;
      return { status: 201 };
    },
    "POST /admin/realms/edutrack/authentication/flows/edutrack-direct-grant-otp/executions/execution": () => ({ status: 201 }),
    "GET /admin/realms/edutrack/authentication/flows/edutrack-direct-grant-otp/executions": () => ({
      status: 200,
      body: [
        { id: "exec-1", requirement: "REQUIRED" },
        { id: "exec-2", requirement: "DISABLED" },
      ],
    }),
    "PUT /admin/realms/edutrack/authentication/flows/edutrack-direct-grant-otp/executions": () => ({ status: 204 }),
    "GET /admin/realms/edutrack/clients?clientId=edutrack-otp-check": () => ({
      status: 200,
      body: clientCreated
        ? [{ id: "client-uuid", clientId: "edutrack-otp-check", authenticationFlowBindingOverrides: { direct_grant: "flow-1" } }]
        : [],
    }),
    "POST /admin/realms/edutrack/clients": () => {
      clientCreated = true;
      return { status: 201 };
    },
    "GET /admin/realms/edutrack/clients/client-uuid/client-secret": () => ({ status: 200, body: { value: "otp-client-secret" } }),
    "POST /realms/edutrack/protocol/openid-connect/token": () => ({ status: 200, body: { access_token: "user-token" } }),
  };

  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method || "GET").toUpperCase();
    const key = `${method} ${url.replace(BASE, "")}`;
    calls.push({ method, url, body: typeof init?.body === "string" ? init.body : init?.body?.toString() });
    const handler = overrides[key] ?? defaults[key];
    if (!handler) throw new Error(`Ruta no mockeada: ${key}`);
    const result = handler(init);
    return jsonResponse(result.status, result.body ?? {});
  });

  return { fetchMock, calls };
}

async function loadModule() {
  vi.resetModules();
  return import("./keycloak");
}

describe("verifyKeycloakUserOtpCode", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    process.env.KEYCLOAK_ADMIN_BASE_URL = BASE;
    process.env.KEYCLOAK_ADMIN_REALM = "edutrack";
  });

  it("aprovisiona flujo + cliente y devuelve true con código válido", async () => {
    const { fetchMock, calls } = buildFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    const kc = await loadModule();

    await expect(kc.verifyKeycloakUserOtpCode("kc-1", "123456")).resolves.toBe(true);

    const flowCreate = calls.find((c) => c.method === "POST" && c.url.endsWith("/authentication/flows"));
    expect(flowCreate?.body).toContain("edutrack-direct-grant-otp");
    const executionCreates = calls.filter((c) => c.url.endsWith("/executions/execution"));
    expect(executionCreates.map((c) => c.body)).toEqual([
      JSON.stringify({ provider: "direct-grant-validate-username" }),
      JSON.stringify({ provider: "direct-grant-validate-otp" }),
    ]);
    const clientCreate = calls.find((c) => c.method === "POST" && c.url.endsWith("/clients"));
    expect(clientCreate?.body).toContain('"directAccessGrantsEnabled":true');
    expect(clientCreate?.body).toContain('"direct_grant":"flow-1"');
    const tokenCall = calls.find((c) => c.url.endsWith("/realms/edutrack/protocol/openid-connect/token"));
    expect(tokenCall?.body).toContain("totp=123456");
    expect(tokenCall?.body).toContain("client_secret=otp-client-secret");
    expect(tokenCall?.body).toContain("username=admin");
  });

  it("devuelve false si Keycloak responde invalid_grant (código incorrecto)", async () => {
    const { fetchMock } = buildFetchMock({
      "POST /realms/edutrack/protocol/openid-connect/token": () => ({
        status: 401,
        body: { error: "invalid_grant", error_description: "Invalid user credentials" },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const kc = await loadModule();

    await expect(kc.verifyKeycloakUserOtpCode("kc-1", "000000")).resolves.toBe(false);
  });

  it("reutiliza el aprovisionamiento cacheado en la segunda verificación", async () => {
    const { fetchMock, calls } = buildFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    const kc = await loadModule();

    await kc.verifyKeycloakUserOtpCode("kc-1", "123456");
    const setupCallsAfterFirst = calls.filter((c) => c.url.includes("/authentication/flows")).length;
    await kc.verifyKeycloakUserOtpCode("kc-1", "123456");

    expect(calls.filter((c) => c.url.includes("/authentication/flows")).length).toBe(setupCallsAfterFirst);
  });

  it("reprovisiona y reintenta una vez si el secreto cacheado quedó obsoleto", async () => {
    let tokenAttempts = 0;
    const { fetchMock } = buildFetchMock({
      "POST /realms/edutrack/protocol/openid-connect/token": () => {
        tokenAttempts += 1;
        if (tokenAttempts === 1) return { status: 401, body: { error: "invalid_client" } };
        return { status: 200, body: { access_token: "user-token" } };
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    const kc = await loadModule();

    await expect(kc.verifyKeycloakUserOtpCode("kc-1", "123456")).resolves.toBe(true);
    expect(tokenAttempts).toBe(2);
  });

  it("lanza error ante fallas inesperadas de Keycloak (ni invalid_grant ni invalid_client)", async () => {
    const { fetchMock } = buildFetchMock({
      "POST /realms/edutrack/protocol/openid-connect/token": () => ({ status: 500, body: { error: "unknown_error" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const kc = await loadModule();

    await expect(kc.verifyKeycloakUserOtpCode("kc-1", "123456")).rejects.toThrow(/OTP verify error 500/);
  });

  it("rechaza códigos con formato inválido sin llamar a Keycloak", async () => {
    const { fetchMock } = buildFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    const kc = await loadModule();

    await expect(kc.verifyKeycloakUserOtpCode("kc-1", "12ab56")).resolves.toBe(false);
    await expect(kc.verifyKeycloakUserOtpCode("", "123456")).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
