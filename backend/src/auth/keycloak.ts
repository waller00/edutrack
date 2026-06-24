import * as oidc from "openid-client";
import crypto from "node:crypto";

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
  requiredAction?: "UPDATE_PASSWORD" | "CONFIGURE_TOTP" | "CONFIGURE_RECOVERY_AUTHN_CODES";
  prompt?: "login";
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
  if (options.prompt) {
    params.prompt = options.prompt;
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

  if (createRes.status === 409) {
    const existingKcId = await findKeycloakUserIdByEmail(token, input.email);
    if (existingKcId) {
      // Mismo email: es la misma persona (re-registro / cuenta adoptada). La reutilizamos.
      await syncKeycloakUserIdentity({
        kcId: existingKcId,
        email: input.email,
        username: input.username,
        firstName: input.firstName,
        lastName: input.lastName,
        emailVerified: input.emailVerified,
      });
      if (input.password) {
        await setKeycloakUserPassword(token, existingKcId, input.password);
      }
      if (input.role) {
        await assignRealmRole(token, existingKcId, input.role).catch((e) => {
          console.error("[keycloak] assign existing user role:", e);
        });
      }
      return existingKcId;
    }
    // 409 sin coincidencia por email = el username (u otro dato único) lo tiene OTRA cuenta.
    // Error tipado para que el caller responda "nombre de usuario en uso" en vez de un 502 genérico.
    const takenError = new Error("KEYCLOAK_USERNAME_TAKEN") as Error & { code?: string };
    takenError.code = "KEYCLOAK_USERNAME_TAKEN";
    throw takenError;
  }

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

async function setKeycloakUserPassword(token: string, kcUserId: string, password: string): Promise<void> {
  const base = adminBaseUrl();
  const realm = adminRealm();
  const res = await kcFetch(`${base}/admin/realms/${realm}/users/${encodeURIComponent(kcUserId)}/reset-password`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type: "password", value: password, temporary: false }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Keycloak reset password error ${res.status}: ${detail}`);
  }
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
    ...(typeof input.emailVerified === "boolean" ? { emailVerified: input.emailVerified } : {}),
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

export async function getKeycloakUserIdByEmail(email: string): Promise<string | null> {
  if (!email) return null;
  const token = await getAdminToken();
  return findKeycloakUserIdByEmail(token, email);
}

async function findKeycloakUserByUsername(
  token: string,
  username: string,
): Promise<{ id: string; email: string | null } | null> {
  const base = adminBaseUrl();
  const realm = adminRealm();
  const res = await kcFetch(
    `${base}/admin/realms/${realm}/users?username=${encodeURIComponent(username)}&exact=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) return null;
  const users = (await res.json()) as { id?: string; email?: string }[];
  const u = users[0];
  return u?.id ? { id: u.id, email: u.email ?? null } : null;
}

/**
 * Si el username ya existe en Keycloak pero es una cuenta HUÉRFANA (sin usuario en la app),
 * la borra para liberar el nombre limpio. Si pertenece a un usuario real de la app, NO la toca.
 * `hasAppUser(email)` lo provee el caller (consulta la BD de la app; así este módulo no depende de Prisma).
 * Devuelve true si borró un huérfano. Best-effort: ante un error de Keycloak no bloquea el alta.
 */
export async function freeKeycloakUsernameIfOrphan(
  username: string,
  hasAppUser: (email: string) => Promise<boolean>,
): Promise<boolean> {
  if (!username) return false;
  try {
    const token = await getAdminToken();
    const kc = await findKeycloakUserByUsername(token, username);
    if (!kc) return false;
    // Linkeado a un usuario real de la app → no se toca.
    if (kc.email && (await hasAppUser(kc.email))) return false;
    const base = adminBaseUrl();
    const realm = adminRealm();
    const res = await kcFetch(`${base}/admin/realms/${realm}/users/${kc.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok && res.status !== 404) {
      console.warn(`[keycloak] no se pudo borrar huérfano ${username}: ${res.status}`);
      return false;
    }
    console.warn(`[keycloak] username huérfano liberado: ${username}`);
    return true;
  } catch (e) {
    console.warn("[keycloak] free orphan username skipped:", e);
    return false;
  }
}

/**
 * Borra la cuenta de Keycloak asociada a un email (si existe). Idempotente: si no hay
 * cuenta, no hace nada. Se usa al eliminar definitivamente un usuario para no dejar
 * cuentas huérfanas en el realm (que luego impiden re-registrar ese email).
 */
export async function deleteKeycloakUserByEmail(email: string): Promise<boolean> {
  if (!email) return false;
  const token = await getAdminToken();
  const kcUserId = await findKeycloakUserIdByEmail(token, email);
  if (!kcUserId) return false;
  const base = adminBaseUrl();
  const realm = adminRealm();
  const res = await kcFetch(`${base}/admin/realms/${realm}/users/${kcUserId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Keycloak delete user error ${res.status}`);
  }
  return true;
}

type KeycloakCredential = {
  id?: string;
  type?: string;
  userLabel?: string;
  createdDate?: number;
  credentialData?: string;
  secretData?: string;
};

const KEYCLOAK_SECOND_FACTOR_CREDENTIAL_TYPES = new Set(["otp", "recovery-authn-codes"]);

function isKeycloakSecondFactorCredential(credential: KeycloakCredential): boolean {
  return Boolean(credential.id && credential.type && KEYCLOAK_SECOND_FACTOR_CREDENTIAL_TYPES.has(credential.type));
}

function parseCredentialJson(value?: string): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function numberFromCredential(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeOtpCode(code: string): string {
  return code.replace(/[\s-]/g, "");
}

function stripTrailingEquals(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "=") end -= 1;
  return value.slice(0, end);
}

function base32Decode(value: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = stripTrailingEquals(value.toUpperCase().replace(/[\s-]/g, ""));
  const bytes: number[] = [];
  let bits = 0;
  let buffer = 0;
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error("Secreto OTP base32 inválido.");
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hmacDigestName(algorithm: unknown): "sha1" | "sha256" | "sha512" {
  const normalized = String(algorithm || "").toLowerCase();
  if (normalized.includes("sha512")) return "sha512";
  if (normalized.includes("sha256")) return "sha256";
  return "sha1";
}

function hotp(secret: Buffer, counter: number, digits: number, algorithm: "sha1" | "sha256" | "sha512"): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuffer.writeUInt32BE(counter >>> 0, 4);
  const digest = crypto.createHmac(algorithm, secret).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

function timingSafeCodeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function getOtpSecret(credential: KeycloakCredential): string | null {
  const secretData = parseCredentialJson(credential.secretData);
  const value = secretData.value ?? secretData.secret ?? secretData.otpSecret;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function verifyTotpCode(input: {
  secret: string;
  code: string;
  digits: number;
  period: number;
  algorithm: "sha1" | "sha256" | "sha512";
  now?: number;
}): boolean {
  const normalizedCode = normalizeOtpCode(input.code);
  if (!new RegExp(`^\\d{${input.digits}}$`).test(normalizedCode)) return false;
  const secret = base32Decode(input.secret);
  const currentCounter = Math.floor((input.now ?? Date.now()) / 1000 / input.period);
  for (let drift = -1; drift <= 1; drift += 1) {
    const expected = hotp(secret, currentCounter + drift, input.digits, input.algorithm);
    if (timingSafeCodeEqual(expected, normalizedCode)) return true;
  }
  return false;
}

type KeycloakUserProfile = {
  id?: string;
  username?: string;
  email?: string;
};

export async function getKeycloakUserLoginName(kcUserId: string): Promise<string | null> {
  if (!kcUserId) return null;
  const token = await getAdminToken();
  const base = adminBaseUrl();
  const realm = adminRealm();
  const res = await kcFetch(`${base}/admin/realms/${realm}/users/${encodeURIComponent(kcUserId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Keycloak user error ${res.status}: ${detail}`);
  }
  const user = (await res.json()) as KeycloakUserProfile;
  return user.username || user.email || null;
}

export async function getKeycloakUserOtpStatus(kcUserId: string): Promise<{ enabled: boolean; count: number }> {
  if (!kcUserId) return { enabled: false, count: 0 };
  const token = await getAdminToken();
  const base = adminBaseUrl();
  const realm = adminRealm();
  const res = await kcFetch(`${base}/admin/realms/${realm}/users/${encodeURIComponent(kcUserId)}/credentials`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Keycloak credentials error ${res.status}: ${detail}`);
  }
  const credentials = (await res.json()) as KeycloakCredential[];
  const secondFactorCredentials = credentials.filter((credential) => credential.type && KEYCLOAK_SECOND_FACTOR_CREDENTIAL_TYPES.has(credential.type));
  return { enabled: secondFactorCredentials.length > 0, count: secondFactorCredentials.length };
}

export async function verifyKeycloakUserOtpCode(kcUserId: string, code: string): Promise<boolean> {
  const normalizedCode = normalizeOtpCode(code);
  if (!kcUserId || !/^\d{6,8}$/.test(normalizedCode)) return false;
  const token = await getAdminToken();
  const base = adminBaseUrl();
  const realm = adminRealm();
  const res = await kcFetch(`${base}/admin/realms/${realm}/users/${encodeURIComponent(kcUserId)}/credentials`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Keycloak credentials error ${res.status}: ${detail}`);
  }
  const credentials = (await res.json()) as KeycloakCredential[];
  const otpCredentials = credentials.filter((credential) => credential.type === "otp");
  let couldValidate = false;
  for (const credential of otpCredentials) {
    const credentialData = parseCredentialJson(credential.credentialData);
    const subType = typeof credentialData.subType === "string" ? credentialData.subType.toLowerCase() : "totp";
    if (subType && subType !== "totp") continue;
    const secret = getOtpSecret(credential);
    if (!secret) continue;
    couldValidate = true;
    const digits = numberFromCredential(credentialData.digits, normalizedCode.length);
    const period = numberFromCredential(credentialData.period, 30);
    const algorithm = hmacDigestName(credentialData.algorithm);
    if (verifyTotpCode({ secret, code: normalizedCode, digits, period, algorithm })) return true;
  }
  if (otpCredentials.length > 0 && !couldValidate) {
    throw new Error("Keycloak no devolvió el secreto OTP necesario para validar el código.");
  }
  return false;
}

export async function deleteKeycloakUserOtpCredentials(kcUserId: string): Promise<number> {
  if (!kcUserId) return 0;
  const token = await getAdminToken();
  const base = adminBaseUrl();
  const realm = adminRealm();
  const credentialsRes = await kcFetch(`${base}/admin/realms/${realm}/users/${encodeURIComponent(kcUserId)}/credentials`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!credentialsRes.ok) {
    const detail = await credentialsRes.text().catch(() => "");
    throw new Error(`Keycloak credentials error ${credentialsRes.status}: ${detail}`);
  }
  const credentials = (await credentialsRes.json()) as KeycloakCredential[];
  const secondFactorCredentials = credentials.filter(isKeycloakSecondFactorCredential);
  for (const credential of secondFactorCredentials) {
    const res = await kcFetch(
      `${base}/admin/realms/${realm}/users/${encodeURIComponent(kcUserId)}/credentials/${encodeURIComponent(credential.id!)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Keycloak delete OTP error ${res.status}: ${detail}`);
    }
  }
  return secondFactorCredentials.length;
}

/**
 * Quita CONFIGURE_TOTP de las required actions persistidas del usuario.
 * El 2FA es opcional (se activa/desactiva desde el perfil): si quedó una acción
 * de configuración de 2FA pendiente, Keycloak la encadena al terminar cualquier
 * flujo (p. ej. el reset de contraseña), forzando el "Configurar 2FA" sin sentido.
 */
async function clearPendingTotpRequiredAction(token: string, kcUserId: string): Promise<void> {
  const base = adminBaseUrl();
  const realm = adminRealm();
  const userRes = await kcFetch(`${base}/admin/realms/${realm}/users/${encodeURIComponent(kcUserId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return;
  const user = (await userRes.json()) as { requiredActions?: string[] };
  const current = Array.isArray(user.requiredActions) ? user.requiredActions : [];
  if (!current.includes("CONFIGURE_TOTP")) return;
  const next = current.filter((action) => action !== "CONFIGURE_TOTP");
  await kcFetch(`${base}/admin/realms/${realm}/users/${encodeURIComponent(kcUserId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ requiredActions: next }),
  });
}

/** Envía el email de actualización de contraseña de Keycloak al usuario. */
export async function triggerKeycloakPasswordReset(email: string): Promise<void> {
  const token = await getAdminToken();
  const kcId = await findKeycloakUserIdByEmail(token, email);
  if (!kcId) throw new Error("Usuario no encontrado en Keycloak");
  const base = adminBaseUrl();
  const realm = adminRealm();
  // El reset solo debe cambiar la contraseña; nunca encadenar la config de 2FA.
  await clearPendingTotpRequiredAction(token, kcId);
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
