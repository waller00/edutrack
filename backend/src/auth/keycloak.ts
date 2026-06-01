import * as oidc from "openid-client";

/**
 * Integracion con Keycloak para el patron BFF.
 *
 * - `getOidcConfig()`: descubre la configuracion OIDC del realm (cacheada).
 * - helpers para construir URLs de login/logout e intercambiar codigos.
 * - Admin API para provisionar usuarios (registro con Didit).
 *
 * Todo el modulo asume AUTH_MODE=keycloak; si Keycloak no responde, las rutas
 * que lo usan devolveran error controlado.
 */

function issuerUrl(): string {
  const url = process.env.KEYCLOAK_ISSUER_URL;
  if (!url) throw new Error("KEYCLOAK_ISSUER_URL no definido");
  return url.replace(/\/$/, "");
}

function clientId(): string {
  return process.env.KEYCLOAK_CLIENT_ID || "edutrack-web";
}

function clientSecret(): string {
  return process.env.KEYCLOAK_CLIENT_SECRET || "";
}

export function redirectUri(): string {
  return process.env.KEYCLOAK_REDIRECT_URI || "http://localhost:4000/auth/callback";
}

export function buildAccountConsoleUrl(path = ""): string {
  const accountUrl = new URL(`${issuerUrl()}/account/`);
  const cleanPath = path.replace(/^\/+/, "");
  if (cleanPath) {
    accountUrl.pathname = `${accountUrl.pathname.replace(/\/$/, "")}/${cleanPath}`;
  }
  return accountUrl.href;
}

/**
 * URL interna (red Docker) para las llamadas server-to-server a Keycloak
 * (discovery, token, jwks). El navegador y Google usan la URL pública del
 * issuer (p. ej. http://localhost:8089), que el contenedor no puede resolver;
 * por eso reescribimos esas llamadas hacia este origen interno.
 */
function internalBaseUrl(): string | null {
  const raw = process.env.KEYCLOAK_INTERNAL_URL;
  if (!raw) return null;
  return raw.replace(/\/$/, "");
}

/**
 * fetch que reescribe el origen público del issuer por el interno para las
 * peticiones backchannel. Mantiene el issuer lógico (público) intacto, de modo
 * que la validación de `iss` y las URLs de redirección al navegador siguen
 * apuntando a la URL pública.
 */
function buildCustomFetch(): typeof fetch | null {
  const internal = internalBaseUrl();
  if (!internal) return null;
  const publicOrigin = new URL(issuerUrl()).origin;
  const internalOrigin = new URL(internal).origin;
  if (publicOrigin === internalOrigin) return null;

  return ((input: any, init?: any) => {
    const original = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    let target = original;
    if (original.startsWith(publicOrigin)) {
      target = internalOrigin + original.slice(publicOrigin.length);
    }
    return fetch(target, init);
  }) as typeof fetch;
}

let configPromise: Promise<oidc.Configuration> | null = null;

/** HTTP sin TLS (testing nip.io, Docker local). openid-client lo bloquea salvo allowInsecureRequests. */
function oidcDiscoveryExecute(): Array<(config: oidc.Configuration) => void> {
  const flag = (process.env.KEYCLOAK_ALLOW_HTTP || "").toLowerCase();
  if (flag === "1" || flag === "true") return [oidc.allowInsecureRequests];
  if (issuerUrl().startsWith("http://") || (internalBaseUrl() || "").startsWith("http://")) {
    return [oidc.allowInsecureRequests];
  }
  return [];
}

export async function getOidcConfig(): Promise<oidc.Configuration> {
  if (!configPromise) {
    const execute = oidcDiscoveryExecute();
    const customFetch = buildCustomFetch();
    const options: Record<symbol, unknown> & { execute?: typeof execute } = {};
    if (execute.length) options.execute = execute;
    if (customFetch) options[oidc.customFetch] = customFetch;
    // No cacheamos la promesa rechazada: si la discovery falla (p. ej. Keycloak
    // todavia esta arrancando), dejamos configPromise en null para reintentar.
    configPromise = oidc
      .discovery(
        new URL(issuerUrl()),
        clientId(),
        clientSecret(),
        undefined,
        Object.keys(options).length || Object.getOwnPropertySymbols(options).length ? (options as any) : undefined,
      )
      .catch((error) => {
        configPromise = null;
        throw error;
      });
  }
  return configPromise;
}

export type AuthRequestState = {
  codeVerifier: string;
  state: string;
  authUrl: string;
};

export type LoginUrlOptions = {
  identityProvider?: string;
  requiredAction?: "UPDATE_PASSWORD" | "CONFIGURE_TOTP";
};

export async function buildLoginUrl(options: LoginUrlOptions = {}): Promise<AuthRequestState> {
  const config = await getOidcConfig();
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
  const state = oidc.randomState();

  const params: Record<string, string> = {
    redirect_uri: redirectUri(),
    scope: "openid email profile",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  };

  // El redirect_uri apunta al API; el tema de Keycloak necesita el origen del frontend.
  const frontendOrigin = process.env.FRONTEND_URL;
  if (frontendOrigin) {
    try {
      params.frontend_origin = new URL(frontendOrigin).origin;
    } catch {
      /* FRONTEND_URL invalido: el tema cae al heuristico */
    }
  }

  if (options.identityProvider) {
    params.kc_idp_hint = options.identityProvider;
  }
  if (options.requiredAction) {
    params.kc_action = options.requiredAction;
  }

  const authUrl = oidc.buildAuthorizationUrl(config, params).href;

  return { codeVerifier, state, authUrl };
}

export type ExchangedTokens = {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt: number;
  claims: Record<string, any>;
};

export async function exchangeCode(
  currentUrl: URL,
  codeVerifier: string,
  expectedState: string,
): Promise<ExchangedTokens> {
  const config = await getOidcConfig();
  const tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: codeVerifier,
    expectedState,
  });
  return toExchanged(tokens);
}

export async function refreshTokens(refreshToken: string): Promise<ExchangedTokens> {
  const config = await getOidcConfig();
  const tokens = await oidc.refreshTokenGrant(config, refreshToken);
  return toExchanged(tokens);
}

function toExchanged(tokens: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers): ExchangedTokens {
  const claims = (tokens.claims() as Record<string, any>) || {};
  const expiresInSec = typeof tokens.expires_in === "number" ? tokens.expires_in : 300;
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    idToken: tokens.id_token,
    expiresAt: Date.now() + expiresInSec * 1000,
    claims,
  };
}

export async function buildLogoutUrl(idToken?: string, postLogoutRedirectUri?: string): Promise<string | null> {
  const config = await getOidcConfig();
  try {
    const params: Record<string, string> = {};
    if (idToken) params.id_token_hint = idToken;
    else params.client_id = clientId();
    if (postLogoutRedirectUri) params.post_logout_redirect_uri = postLogoutRedirectUri;
    return oidc.buildEndSessionUrl(config, params).href;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Admin API (provisioning de usuarios)
// ---------------------------------------------------------------------------

function adminBaseUrl(): string {
  return (process.env.KEYCLOAK_ADMIN_BASE_URL || "http://keycloak:8080").replace(/\/$/, "");
}

function adminRealm(): string {
  return process.env.KEYCLOAK_ADMIN_REALM || "edutrack";
}

/**
 * fetch con timeout para la Admin API de Keycloak. Sin esto, si Keycloak no responde,
 * el request que lo llama (p. ej. /auth/register) queda colgado hasta el timeout del
 * proxy y devuelve un 502/504 sin cabeceras CORS. Mejor fallar rápido y controlado.
 */
function kcFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const timeoutMs = Number(process.env.KEYCLOAK_ADMIN_TIMEOUT_MS || 8000);
  return fetch(input, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) });
}

async function getAdminToken(): Promise<string> {
  const base = adminBaseUrl();
  const body = new URLSearchParams({
    grant_type: "password",
    client_id: "admin-cli",
    username: process.env.KEYCLOAK_ADMIN_USER || "admin",
    password: process.env.KEYCLOAK_ADMIN_PASSWORD || "",
  });
  const res = await kcFetch(`${base}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Keycloak admin token error ${res.status}`);
  }
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

export type CreateKeycloakUserInput = {
  email: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  password?: string;
  role: string;
  emailVerified?: boolean;
};

/**
 * Crea un usuario en el realm y le asigna el rol. Devuelve el id de Keycloak.
 * Usado por el registro de la app tras pasar la prueba de vida (Didit).
 */
export async function createKeycloakUser(input: CreateKeycloakUserInput): Promise<string> {
  const token = await getAdminToken();
  const base = adminBaseUrl();
  const realm = adminRealm();

  const createRes = await kcFetch(`${base}/admin/realms/${realm}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      email: input.email,
      username: input.username || input.email,
      firstName: input.firstName ?? undefined,
      lastName: input.lastName ?? undefined,
      enabled: true,
      emailVerified: input.emailVerified ?? false,
      credentials: input.password
        ? [{ type: "password", value: input.password, temporary: false }]
        : undefined,
    }),
  });

  if (createRes.status !== 201) {
    const detail = await createRes.text().catch(() => "");
    throw new Error(`Keycloak create user error ${createRes.status}: ${detail}`);
  }

  // El id viene en el header Location: .../users/{id}
  const location = createRes.headers.get("location") || "";
  const kcId = location.split("/").pop() || "";

  if (kcId && input.role) {
    await assignRealmRole(token, kcId, input.role).catch((e) => {
      console.error("[keycloak] assign role:", e);
    });
  }

  return kcId;
}

export type SyncKeycloakUserIdentityInput = {
  kcId: string;
  email?: string | null;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  emailVerified?: boolean;
};

export async function syncKeycloakUserIdentity(input: SyncKeycloakUserIdentityInput): Promise<void> {
  if (!input.kcId) return;
  const token = await getAdminToken();
  const base = adminBaseUrl();
  const realm = adminRealm();

  const currentRes = await kcFetch(`${base}/admin/realms/${realm}/users/${encodeURIComponent(input.kcId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!currentRes.ok) return;

  const current = (await currentRes.json()) as Record<string, unknown>;
  const next = {
    ...current,
    ...(input.email ? { email: input.email } : {}),
    ...(input.username ? { username: input.username } : {}),
    ...(input.firstName ? { firstName: input.firstName } : {}),
    ...(input.lastName ? { lastName: input.lastName } : {}),
    ...(input.emailVerified === true ? { emailVerified: true } : {}),
  };

  const updateRes = await kcFetch(`${base}/admin/realms/${realm}/users/${encodeURIComponent(input.kcId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(next),
  });
  if (!updateRes.ok) {
    const detail = await updateRes.text().catch(() => "");
    throw new Error(`Keycloak update user error ${updateRes.status}: ${detail}`);
  }
}

export async function syncKeycloakUserIdentityByEmail(
  email: string,
  input: Omit<SyncKeycloakUserIdentityInput, "kcId" | "email">,
): Promise<void> {
  const token = await getAdminToken();
  const kcId = await findKeycloakUserIdByEmail(token, email);
  if (!kcId) return;
  await syncKeycloakUserIdentity({ kcId, email, ...input });
}

export async function syncRegisteredSsoUser(input: SyncKeycloakUserIdentityInput & { role: string }): Promise<void> {
  if (!input.kcId) return;
  const token = await getAdminToken();
  await syncKeycloakUserIdentity(input);
  await assignRealmRole(token, input.kcId, input.role).catch((error) => {
    console.warn("[keycloak] assign SSO role skipped:", error);
  });
}

async function assignRealmRole(token: string, kcUserId: string, roleName: string): Promise<void> {
  const base = adminBaseUrl();
  const realm = adminRealm();
  const roleRes = await kcFetch(`${base}/admin/realms/${realm}/roles/${encodeURIComponent(roleName)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!roleRes.ok) return;
  const role = (await roleRes.json()) as { id: string; name: string };
  await kcFetch(`${base}/admin/realms/${realm}/users/${kcUserId}/role-mappings/realm`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify([{ id: role.id, name: role.name }]),
  });
}

async function findKeycloakUserIdByEmail(token: string, email: string): Promise<string | null> {
  const base = adminBaseUrl();
  const realm = adminRealm();
  const res = await kcFetch(
    `${base}/admin/realms/${realm}/users?email=${encodeURIComponent(email)}&exact=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) return null;
  const users = (await res.json()) as { id?: string }[];
  if (users.length > 1) {
    console.warn(`[keycloak] búsqueda por email devolvió ${users.length} usuarios para ${email}; se usa el primero`);
  }
  return users[0]?.id ?? null;
}

/** Envía el email de actualización de contraseña de Keycloak al usuario. */
export async function triggerKeycloakPasswordReset(email: string): Promise<void> {
  const token = await getAdminToken();
  const kcId = await findKeycloakUserIdByEmail(token, email);
  if (!kcId) throw new Error("Usuario no encontrado en Keycloak");
  const base = adminBaseUrl();
  const realm = adminRealm();
  const res = await kcFetch(`${base}/admin/realms/${realm}/users/${kcId}/execute-actions-email`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(["UPDATE_PASSWORD"]),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Keycloak password reset error ${res.status}: ${detail}`);
  }
}
