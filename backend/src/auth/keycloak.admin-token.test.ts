import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Un solo token de admin para todas las consultas. Mi perfil pide contraseña, Google y 2FA a la vez:
 * con un login de admin por consulta, la protección contra fuerza bruta de `master` rechazaba todos
 * menos uno (`user_temporarily_disabled`) y la tarjeta decía que no se pudo consultar.
 */

const BASE = "http://keycloak:8080";
const TOKEN_PATH = "/realms/master/protocol/openid-connect/token";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function keycloak(tokenResponses: Array<() => Response>) {
  let tokenIndex = 0;
  const fetchMock = vi.fn(async (input: string | URL) => {
    const path = String(input).replace(BASE, "");
    if (path === TOKEN_PATH) {
      const next = tokenResponses[Math.min(tokenIndex++, tokenResponses.length - 1)];
      return next();
    }
    if (path.endsWith("/federated-identity")) return json(200, []);
    throw new Error(`Ruta no mockeada: ${path}`);
  });
  const tokenCalls = () => fetchMock.mock.calls.filter(([input]) => String(input).endsWith(TOKEN_PATH)).length;
  return { fetchMock, tokenCalls };
}

async function loadModule() {
  vi.resetModules();
  return import("./keycloak");
}

const okToken = (token = "t1", expiresIn = 60) => () => json(200, { access_token: token, expires_in: expiresIn });

describe("token de admin de Keycloak", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    process.env.KEYCLOAK_ADMIN_BASE_URL = BASE;
    process.env.KEYCLOAK_ADMIN_REALM = "edutrack";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("las consultas simultáneas comparten un solo login", async () => {
    const { fetchMock, tokenCalls } = keycloak([okToken()]);
    vi.stubGlobal("fetch", fetchMock);
    const kc = await loadModule();

    await Promise.all([kc.getKeycloakUserGoogleLink("a"), kc.getKeycloakUserGoogleLink("b"), kc.getKeycloakUserGoogleLink("c")]);

    expect(tokenCalls()).toBe(1);
  });

  it("reutiliza el token hasta poco antes de vencer y después pide otro", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { fetchMock, tokenCalls } = keycloak([okToken("t1"), okToken("t2")]);
    vi.stubGlobal("fetch", fetchMock);
    const kc = await loadModule();

    await kc.getKeycloakUserGoogleLink("a");
    vi.advanceTimersByTime(40_000);
    await kc.getKeycloakUserGoogleLink("a");
    expect(tokenCalls()).toBe(1);

    vi.advanceTimersByTime(10_000);
    await kc.getKeycloakUserGoogleLink("a");
    expect(tokenCalls()).toBe(2);
  });

  it("sin vencimiento en la respuesta no guarda el token", async () => {
    const { fetchMock, tokenCalls } = keycloak([() => json(200, { access_token: "t1" })]);
    vi.stubGlobal("fetch", fetchMock);
    const kc = await loadModule();

    await kc.getKeycloakUserGoogleLink("a");
    await kc.getKeycloakUserGoogleLink("a");

    expect(tokenCalls()).toBe(2);
  });

  it("si el login falla, la próxima consulta lo reintenta", async () => {
    const { fetchMock, tokenCalls } = keycloak([() => json(401, {}), okToken()]);
    vi.stubGlobal("fetch", fetchMock);
    const kc = await loadModule();

    await expect(kc.getKeycloakUserGoogleLink("a")).rejects.toThrow(/admin token error 401/);
    await expect(kc.getKeycloakUserGoogleLink("a")).resolves.toEqual({ linked: false, account: null });

    expect(tokenCalls()).toBe(2);
  });
});
