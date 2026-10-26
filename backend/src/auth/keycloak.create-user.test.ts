import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * `createKeycloakUser` nunca toma una cuenta de Keycloak que ya existe. Antes, ante el mismo correo,
 * reutilizaba esa cuenta y le ponía la contraseña de quien se registraba: con el correo de otro, el
 * alta pública era quedarse con su cuenta (el login vincula por `sub`).
 */

const BASE = "http://keycloak:8080";
const USERS = "/admin/realms/edutrack/users";

type Step = { status: number; body?: unknown; location?: string };

function response(step: Step): Response {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (step.location) headers.location = step.location;
  const body = step.status === 204 || step.status === 201 ? null : JSON.stringify(step.body ?? {});
  return new Response(body, { status: step.status, headers });
}

/** Keycloak simulado: las altas responden en orden; el resto, según la ruta. */
function keycloak(options: { creates: Step[]; byEmail?: Array<{ id: string }> }) {
  const calls: string[] = [];
  let createIndex = 0;
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const method = (init?.method || "GET").toUpperCase();
    const path = String(input).replace(BASE, "");
    calls.push(`${method} ${path}`);
    if (method === "POST" && path === "/realms/master/protocol/openid-connect/token") {
      return response({ status: 200, body: { access_token: "admin-token" } });
    }
    if (method === "POST" && path === USERS) return response(options.creates[createIndex++] ?? { status: 500 });
    if (method === "GET" && path.startsWith(`${USERS}?email=`)) return response({ status: 200, body: options.byEmail ?? [] });
    if (method === "GET" && path.startsWith("/admin/realms/edutrack/roles/")) return response({ status: 404 });
    if (method === "DELETE" && path.startsWith(`${USERS}/`)) return response({ status: 204 });
    throw new Error(`Ruta no mockeada: ${method} ${path}`);
  });
  return { fetchMock, calls };
}

async function loadModule() {
  vi.resetModules();
  return import("./keycloak");
}

const input = { email: "ana@example.com", username: "ana.perez", password: "Secreta123", role: "STAFF" };

describe("createKeycloakUser", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.KEYCLOAK_ADMIN_BASE_URL = BASE;
    process.env.KEYCLOAK_ADMIN_REALM = "edutrack";
  });

  it("crea la cuenta y devuelve su id", async () => {
    const { fetchMock } = keycloak({ creates: [{ status: 201, location: `${BASE}${USERS}/kc-nuevo` }] });
    vi.stubGlobal("fetch", fetchMock);
    const kc = await loadModule();

    await expect(kc.createKeycloakUser(input, { isAppAccount: async () => false })).resolves.toBe("kc-nuevo");
  });

  it("si el correo es de la cuenta de otro usuario de EduTrack, rechaza sin tocar su contraseña", async () => {
    const { fetchMock, calls } = keycloak({ creates: [{ status: 409 }], byEmail: [{ id: "kc-de-otro" }] });
    vi.stubGlobal("fetch", fetchMock);
    const kc = await loadModule();
    const isAppAccount = vi.fn().mockResolvedValue(true);

    await expect(kc.createKeycloakUser(input, { isAppAccount })).rejects.toBeInstanceOf(kc.KeycloakEmailInUseError);

    expect(isAppAccount).toHaveBeenCalledWith("kc-de-otro");
    expect(calls.some((call) => call.includes("reset-password"))).toBe(false);
    expect(calls.some((call) => call.startsWith("PUT") || call.startsWith("DELETE"))).toBe(false);
  });

  it("sin saber de quién es la cuenta existente, también rechaza", async () => {
    const { fetchMock, calls } = keycloak({ creates: [{ status: 409 }], byEmail: [{ id: "kc-x" }] });
    vi.stubGlobal("fetch", fetchMock);
    const kc = await loadModule();

    await expect(kc.createKeycloakUser(input)).rejects.toMatchObject({ code: "KEYCLOAK_EMAIL_IN_USE" });
    expect(calls.some((call) => call.includes("reset-password"))).toBe(false);
  });

  it("una cuenta huérfana con ese correo se borra y se crea una limpia, sin heredar nada", async () => {
    const { fetchMock, calls } = keycloak({
      creates: [{ status: 409 }, { status: 201, location: `${BASE}${USERS}/kc-limpia` }],
      byEmail: [{ id: "kc-huerfana" }],
    });
    vi.stubGlobal("fetch", fetchMock);
    const kc = await loadModule();

    await expect(kc.createKeycloakUser(input, { isAppAccount: async () => false })).resolves.toBe("kc-limpia");

    expect(calls).toContain(`DELETE ${USERS}/kc-huerfana`);
    expect(calls.filter((call) => call === `POST ${USERS}`)).toHaveLength(2);
    expect(calls.some((call) => call.includes("reset-password"))).toBe(false);
  });

  it("si después de liberar el correo vuelve a chocar, es el nombre de usuario", async () => {
    const { fetchMock } = keycloak({ creates: [{ status: 409 }, { status: 409 }], byEmail: [{ id: "kc-huerfana" }] });
    vi.stubGlobal("fetch", fetchMock);
    const kc = await loadModule();

    await expect(kc.createKeycloakUser(input, { isAppAccount: async () => false })).rejects.toMatchObject({
      code: "KEYCLOAK_USERNAME_TAKEN",
    });
  });

  it("un 409 sin nadie con ese correo es el nombre de usuario", async () => {
    const { fetchMock } = keycloak({ creates: [{ status: 409 }], byEmail: [] });
    vi.stubGlobal("fetch", fetchMock);
    const kc = await loadModule();

    await expect(kc.createKeycloakUser(input, { isAppAccount: async () => false })).rejects.toMatchObject({
      code: "KEYCLOAK_USERNAME_TAKEN",
    });
  });
});

describe("freeKeycloakUsernameIfOrphan", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.KEYCLOAK_ADMIN_BASE_URL = BASE;
    process.env.KEYCLOAK_ADMIN_REALM = "edutrack";
  });

  function withUsernameOwner() {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const method = (init?.method || "GET").toUpperCase();
      const path = String(input).replace(BASE, "");
      calls.push(`${method} ${path}`);
      if (path === "/realms/master/protocol/openid-connect/token") return response({ status: 200, body: { access_token: "t" } });
      if (method === "GET" && path.startsWith(`${USERS}?username=`)) {
        return response({ status: 200, body: [{ id: "kc-real", email: "cambiado@example.com" }] });
      }
      if (method === "DELETE") return response({ status: 204 });
      throw new Error(`Ruta no mockeada: ${method} ${path}`);
    });
    return { fetchMock, calls };
  }

  it("no borra la cuenta de un usuario que cambió su correo en Keycloak: es suya por keycloakId", async () => {
    const { fetchMock, calls } = withUsernameOwner();
    vi.stubGlobal("fetch", fetchMock);
    const kc = await loadModule();

    const freed = await kc.freeKeycloakUsernameIfOrphan("ana.perez", async () => false, async (kcId) => kcId === "kc-real");

    expect(freed).toBe(false);
    expect(calls.some((call) => call.startsWith("DELETE"))).toBe(false);
  });

  it("sí libera el nombre de una cuenta que no es de nadie", async () => {
    const { fetchMock, calls } = withUsernameOwner();
    vi.stubGlobal("fetch", fetchMock);
    const kc = await loadModule();

    const freed = await kc.freeKeycloakUsernameIfOrphan("ana.perez", async () => false, async () => false);

    expect(freed).toBe(true);
    expect(calls).toContain(`DELETE ${USERS}/kc-real`);
  });
});

describe("getKeycloakUserGoogleLink", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    process.env.KEYCLOAK_ADMIN_BASE_URL = BASE;
    process.env.KEYCLOAK_ADMIN_REALM = "edutrack";
  });

  function federated(body: unknown, status = 200) {
    return vi.fn(async (input: string | URL) => {
      const path = String(input).replace(BASE, "");
      if (path === "/realms/master/protocol/openid-connect/token") return response({ status: 200, body: { access_token: "t" } });
      if (path === `${USERS}/kc-1/federated-identity`) return response({ status, body });
      throw new Error(`Ruta no mockeada: ${path}`);
    });
  }

  it("dice con qué cuenta de Google entra", async () => {
    vi.stubGlobal("fetch", federated([{ identityProvider: "google", userId: "g-1", userName: "ana@gmail.com" }]));
    const kc = await loadModule();

    await expect(kc.getKeycloakUserGoogleLink("kc-1")).resolves.toEqual({ linked: true, account: "ana@gmail.com" });
  });

  it("sin Google vinculado", async () => {
    vi.stubGlobal("fetch", federated([]));
    const kc = await loadModule();

    await expect(kc.getKeycloakUserGoogleLink("kc-1")).resolves.toEqual({ linked: false, account: null });
  });

  it("falla si Keycloak responde con error", async () => {
    vi.stubGlobal("fetch", federated({}, 500));
    const kc = await loadModule();

    await expect(kc.getKeycloakUserGoogleLink("kc-1")).rejects.toThrow(/federated identity error 500/);
  });
});
