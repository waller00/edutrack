import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests de syncKeycloakUserIdentity: con "Edit username" apagado en el realm, Keycloak rechaza el
 * PUT entero si cambia el username. La sincronización debe conservar el username de Keycloak y
 * actualizar igual email y nombre (el registro con Google fallaba con un 502 por esto).
 */

const BASE = "http://keycloak:8080";
const USER_URL = "/admin/realms/edutrack/users/kc-1";
const READ_ONLY = { field: "username", errorMessage: "error-user-attribute-read-only", params: ["username"] };

type PutResult = { status: number; body?: unknown };

function jsonResponse(status: number, body: unknown = {}): Response {
  if (status === 204) return new Response(null, { status });
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function buildFetchMock(putResults: PutResult[]) {
  const puts: Array<Record<string, unknown>> = [];
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const key = `${(init?.method || "GET").toUpperCase()} ${String(input).replace(BASE, "")}`;
    if (key === "POST /realms/master/protocol/openid-connect/token") return jsonResponse(200, { access_token: "admin-token" });
    if (key === `GET ${USER_URL}`) {
      return jsonResponse(200, { id: "kc-1", username: "leopoldogimenez88@gmail.com", email: "leopoldogimenez88@gmail.com" });
    }
    if (key === `PUT ${USER_URL}`) {
      puts.push(JSON.parse(String(init?.body)));
      const result = putResults[puts.length - 1] ?? { status: 204 };
      return jsonResponse(result.status, result.body);
    }
    throw new Error(`Ruta no mockeada: ${key}`);
  });
  return { fetchMock, puts };
}

async function loadModule() {
  vi.resetModules();
  return import("./keycloak");
}

const input = {
  kcId: "kc-1",
  email: "leopoldogimenez88@gmail.com",
  username: "leopoldo.gimenez",
  firstName: "Leopoldo",
  lastName: "Gimenez",
  emailVerified: true,
};

describe("syncKeycloakUserIdentity", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.KEYCLOAK_ADMIN_BASE_URL = BASE;
    process.env.KEYCLOAK_ADMIN_REALM = "edutrack";
  });

  it("actualiza username, email y nombre cuando el realm permite editar el username", async () => {
    const { fetchMock, puts } = buildFetchMock([{ status: 204 }]);
    vi.stubGlobal("fetch", fetchMock);
    const kc = await loadModule();

    await kc.syncKeycloakUserIdentity(input);

    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ username: "leopoldo.gimenez", firstName: "Leopoldo", emailVerified: true });
  });

  it("si el username es de sólo lectura, reintenta conservando el de Keycloak", async () => {
    const { fetchMock, puts } = buildFetchMock([{ status: 400, body: READ_ONLY }, { status: 204 }]);
    vi.stubGlobal("fetch", fetchMock);
    const kc = await loadModule();

    await expect(kc.syncKeycloakUserIdentity(input)).resolves.toBeUndefined();

    expect(puts).toHaveLength(2);
    expect(puts[1]).toMatchObject({
      username: "leopoldogimenez88@gmail.com",
      firstName: "Leopoldo",
      lastName: "Gimenez",
      emailVerified: true,
    });
  });

  it("sigue fallando con otros errores de Keycloak, sin reintentar", async () => {
    const { fetchMock, puts } = buildFetchMock([{ status: 409, body: { errorMessage: "User exists with same email" } }]);
    vi.stubGlobal("fetch", fetchMock);
    const kc = await loadModule();

    await expect(kc.syncKeycloakUserIdentity(input)).rejects.toThrow(/Keycloak update user error 409/);
    expect(puts).toHaveLength(1);
  });

  it("falla si el reintento sin cambiar el username también es rechazado", async () => {
    const { fetchMock, puts } = buildFetchMock([
      { status: 400, body: READ_ONLY },
      { status: 400, body: { field: "email", errorMessage: "error-user-attribute-read-only" } },
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const kc = await loadModule();

    await expect(kc.syncKeycloakUserIdentity(input)).rejects.toThrow(/Keycloak update user error 400/);
    expect(puts).toHaveLength(2);
  });
});
