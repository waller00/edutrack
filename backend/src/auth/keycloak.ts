import * as oidc from "openid-client";

/**
 * Integracion con Keycloak para el patron BFF.
 *
 * - `getOidcConfig()`: descubre la configuracion OIDC del realm (cacheada).
 * - helpers para construir URLs de login/logout e intercambiar codigos.
 * - Admin API para provisionar usuarios (registro de la app).
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

/** Alias del proveedor de Google en el realm. */
export const GOOGLE_IDP_ALIAS = "google";

/**
 * Acciones que la app le pide a Keycloak. `idp_link:google` vincula Google a la cuenta con la que
 * se está ingresando (Keycloak 26.3+, `IdpLinkAction`): sirve aunque el Gmail no sea el correo de EduTrack.
 */
export type KeycloakRequiredAction =
  | "UPDATE_PASSWORD"
  | "CONFIGURE_TOTP"
  | "CONFIGURE_RECOVERY_AUTHN_CODES"
  | `idp_link:${typeof GOOGLE_IDP_ALIAS}`;

export type LoginUrlOptions = {
  identityProvider?: string;
  requiredAction?: KeycloakRequiredAction;
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

/** `code` de `KeycloakEmailInUseError`: las rutas lo comparan por código, como `KEYCLOAK_USERNAME_TAKEN`. */
export const KEYCLOAK_EMAIL_IN_USE = "KEYCLOAK_EMAIL_IN_USE";

/**
 * El correo ya es de una cuenta de acceso de un usuario de EduTrack: el alta no puede tomarla.
 */
export class KeycloakEmailInUseError extends Error {
  readonly code = KEYCLOAK_EMAIL_IN_USE;

  constructor() {
    super("KEYCLOAK_EMAIL_IN_USE");
    this.name = "KeycloakEmailInUseError";
  }
}

export type CreateKeycloakUserOptions = {
  /**
   * ¿Esa cuenta de Keycloak es de un usuario de EduTrack? Lo provee el caller (este módulo no
   * depende de Prisma). Sin él, una cuenta existente con el mismo correo siempre se rechaza.
   */
  isAppAccount?: (kcId: string) => Promise<boolean>;
};

function usernameTakenError(): Error {
  // 409 sin coincidencia por email = el username (u otro dato único) lo tiene OTRA cuenta.
  // Error tipado para que el caller responda "nombre de usuario en uso" en vez de un 502 genérico.
  const takenError = new Error("KEYCLOAK_USERNAME_TAKEN") as Error & { code?: string };
  takenError.code = "KEYCLOAK_USERNAME_TAKEN";
  return takenError;
}

function postKeycloakUser(token: string, input: CreateKeycloakUserInput): Promise<Response> {
  return kcFetch(`${adminBaseUrl()}/admin/realms/${adminRealm()}/users`, {
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
}

async function deleteKeycloakUserById(token: string, kcUserId: string): Promise<void> {
  const res = await kcFetch(`${adminBaseUrl()}/admin/realms/${adminRealm()}/users/${encodeURIComponent(kcUserId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Keycloak delete user error ${res.status}`);
  }
}

/**
 * Crea un usuario en el realm y le asigna el rol. Devuelve el id de Keycloak.
 * Usado por el registro de la app (la cuenta queda pendiente de aprobación) y el alta de administración.
 *
 * **Nunca toma una cuenta que ya existe.** Antes, ante el mismo correo, reutilizaba esa cuenta y le
 * ponía la contraseña de quien se registraba: con el correo de otro (por ejemplo, el que alguien
 * cambió en su consola de cuenta) eso era quedarse con su cuenta, porque el login vincula por `sub`.
 * Ahora, si la cuenta es de un usuario de EduTrack, el alta se rechaza (`KeycloakEmailInUseError`);
 * si quedó huérfana (un alta con Google abandonada, un usuario borrado), se borra y se crea limpia.
 */
export async function createKeycloakUser(
  input: CreateKeycloakUserInput,
  options: CreateKeycloakUserOptions = {},
): Promise<string> {
  const token = await getAdminToken();
  let createRes = await postKeycloakUser(token, input);

  if (createRes.status === 409) {
    const existingKcId = await findKeycloakUserIdByEmail(token, input.email);
    if (!existingKcId) throw usernameTakenError();
    if (!options.isAppAccount || (await options.isAppAccount(existingKcId))) {
      throw new KeycloakEmailInUseError();
    }
    await deleteKeycloakUserById(token, existingKcId);
    console.warn("[keycloak] cuenta huérfana con el mismo correo reemplazada por el alta", { kcId: existingKcId });
    createRes = await postKeycloakUser(token, input);
    // Ya no queda nadie con ese correo: otro 409 es el username.
    if (createRes.status === 409) throw usernameTakenError();
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
    // `status` distingue la contraseña rechazada por la política del realm (400) de una caída.
    const error = new Error(`Keycloak reset password error ${res.status}: ${detail}`) as Error & { status?: number };
    error.status = res.status;
    throw error;
  }
}

/**
 * Primera contraseña de una cuenta que entra sólo con Google. El "Cambiar contraseña" de Keycloak
 * pide la actual, que esa cuenta no tiene. Quien llama verifica que no tenga ninguna.
 */
export async function setInitialKeycloakPassword(kcUserId: string, password: string): Promise<void> {
  const token = await getAdminToken();
  await setKeycloakUserPassword(token, kcUserId, password);
}

/**
 * Cierra las sesiones de Keycloak del usuario. Tras un alta con Google la sesión del proveedor
 * quedaba abierta, y el siguiente login entraba sin preguntar a una cuenta que todavía no puede usar.
 */
export async function logoutKeycloakUserSessions(kcUserId: string): Promise<void> {
  const token = await getAdminToken();
  const res = await kcFetch(`${adminBaseUrl()}/admin/realms/${adminRealm()}/users/${encodeURIComponent(kcUserId)}/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Keycloak logout user error ${res.status}: ${detail}`);
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

  const putUser = (rep: Record<string, unknown>) =>
    kcFetch(`${base}/admin/realms/${realm}/users/${encodeURIComponent(input.kcId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(rep),
    });

  let updateRes = await putUser(next);
  let detail = updateRes.ok ? "" : await updateRes.text().catch(() => "");
  // Con "Edit username" apagado en el realm, Keycloak rechaza el PUT entero si cambia el username
  // (y con él, email y nombre). Se reintenta conservando el username que ya tiene la cuenta: el
  // login vincula por `keycloakId` y Moodle por email, así que no tiene por qué coincidir con el de la app.
  if (!updateRes.ok && next.username !== current.username && isReadOnlyUsernameError(updateRes.status, detail)) {
    console.warn("[keycloak] username de sólo lectura en el realm: se conserva el de Keycloak", { kcId: input.kcId });
    updateRes = await putUser({ ...next, username: current.username });
    detail = updateRes.ok ? "" : await updateRes.text().catch(() => "");
  }
  if (!updateRes.ok) {
    throw new Error(`Keycloak update user error ${updateRes.status}: ${detail}`);
  }
}

function isReadOnlyUsernameError(status: number, detail: string): boolean {
  if (status !== 400) return false;
  try {
    const body = JSON.parse(detail) as { field?: string; errorMessage?: string };
    return body.field === "username" && body.errorMessage === "error-user-attribute-read-only";
  } catch {
    return false;
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

/**
 * Id de Keycloak de cada email, con un solo token de administración. Los emails sin cuenta no
 * aparecen en el mapa. Lo usa el relleno de `User.keycloakId` al arrancar.
 */
export async function findKeycloakUserIdsByEmail(emails: readonly string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (emails.length === 0) return found;
  const token = await getAdminToken();
  for (const email of emails) {
    const kcId = await findKeycloakUserIdByEmail(token, email);
    if (kcId) found.set(email, kcId);
  }
  return found;
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
 * `hasAppUser(email)` e `isAppAccount(kcId)` los provee el caller (consultan la BD de la app; así
 * este módulo no depende de Prisma). El correo solo no alcanza: quien lo cambió en su consola de
 * cuenta sigue siendo dueño de esa cuenta por su `keycloakId`.
 * Devuelve true si borró un huérfano. Best-effort: ante un error de Keycloak no bloquea el alta.
 */
export async function freeKeycloakUsernameIfOrphan(
  username: string,
  hasAppUser: (email: string) => Promise<boolean>,
  isAppAccount?: (kcId: string) => Promise<boolean>,
): Promise<boolean> {
  if (!username) return false;
  try {
    const token = await getAdminToken();
    const kc = await findKeycloakUserByUsername(token, username);
    if (!kc) return false;
    // Linkeado a un usuario real de la app → no se toca.
    if (kc.email && (await hasAppUser(kc.email))) return false;
    if (isAppAccount && (await isAppAccount(kc.id))) return false;
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

function normalizeOtpCode(code: string): string {
  return code.replace(/[\s-]/g, "");
}

// ---------------------------------------------------------------------------
// Verificación de códigos TOTP vía direct grant
// ---------------------------------------------------------------------------
//
// La Admin API de Keycloak nunca devuelve el `secretData` de las credenciales
// (lo vacía por seguridad), así que el backend no puede recalcular el código
// TOTP por su cuenta. La validación se delega en el propio Keycloak: un flujo
// de direct grant que solo exige usuario + OTP (sin contraseña), enlazado a un
// cliente confidencial dedicado cuyo secreto vive solo en Keycloak y se lee
// por Admin API. Si el endpoint de token emite un token, el código es válido
// (el token se descarta). Flujo y cliente se aprovisionan de forma idempotente.

const OTP_VERIFY_FLOW_ALIAS = "edutrack-direct-grant-otp";
const OTP_VERIFY_CLIENT_ID = "edutrack-otp-check";

type KeycloakFlowSummary = { id?: string; alias?: string };
type KeycloakExecutionSummary = { id?: string; requirement?: string };
type KeycloakClientSummary = {
  id?: string;
  clientId?: string;
  authenticationFlowBindingOverrides?: Record<string, string>;
};

async function ensureOtpVerifyFlow(token: string): Promise<string> {
  const base = adminBaseUrl();
  const realm = adminRealm();
  const authHeaders = { Authorization: `Bearer ${token}` };

  const listFlows = async (): Promise<KeycloakFlowSummary[]> => {
    const res = await kcFetch(`${base}/admin/realms/${realm}/authentication/flows`, { headers: authHeaders });
    if (!res.ok) throw new Error(`Keycloak flows error ${res.status}`);
    return (await res.json()) as KeycloakFlowSummary[];
  };

  const existing = (await listFlows()).find((flow) => flow.alias === OTP_VERIFY_FLOW_ALIAS);
  if (existing?.id) return existing.id;

  const createRes = await kcFetch(`${base}/admin/realms/${realm}/authentication/flows`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      alias: OTP_VERIFY_FLOW_ALIAS,
      description: "Valida usuario + código TOTP sin contraseña (verificación de 2FA del BFF).",
      providerId: "basic-flow",
      topLevel: true,
      builtIn: false,
    }),
  });
  // 409: otro proceso lo creó en paralelo; seguimos y reutilizamos.
  if (!createRes.ok && createRes.status !== 409) {
    throw new Error(`Keycloak create flow error ${createRes.status}`);
  }

  const flowPath = `${base}/admin/realms/${realm}/authentication/flows/${encodeURIComponent(OTP_VERIFY_FLOW_ALIAS)}`;
  for (const provider of ["direct-grant-validate-username", "direct-grant-validate-otp"]) {
    const res = await kcFetch(`${flowPath}/executions/execution`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ provider }),
    });
    if (!res.ok && res.status !== 409) {
      throw new Error(`Keycloak add execution ${provider} error ${res.status}`);
    }
  }

  const execRes = await kcFetch(`${flowPath}/executions`, { headers: authHeaders });
  if (!execRes.ok) throw new Error(`Keycloak executions error ${execRes.status}`);
  const executions = (await execRes.json()) as KeycloakExecutionSummary[];
  for (const execution of executions) {
    if (execution.requirement === "REQUIRED") continue;
    const res = await kcFetch(`${flowPath}/executions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ ...execution, requirement: "REQUIRED" }),
    });
    if (!res.ok) throw new Error(`Keycloak update execution error ${res.status}`);
  }

  const created = (await listFlows()).find((flow) => flow.alias === OTP_VERIFY_FLOW_ALIAS);
  if (!created?.id) throw new Error("Keycloak no devolvió el flujo de verificación de OTP recién creado.");
  return created.id;
}

async function ensureOtpVerifyClient(token: string, flowId: string): Promise<string> {
  const base = adminBaseUrl();
  const realm = adminRealm();
  const authHeaders = { Authorization: `Bearer ${token}` };

  const findClient = async (): Promise<KeycloakClientSummary | undefined> => {
    const res = await kcFetch(
      `${base}/admin/realms/${realm}/clients?clientId=${encodeURIComponent(OTP_VERIFY_CLIENT_ID)}`,
      { headers: authHeaders },
    );
    if (!res.ok) throw new Error(`Keycloak clients error ${res.status}`);
    const clients = (await res.json()) as KeycloakClientSummary[];
    return clients.find((client) => client.clientId === OTP_VERIFY_CLIENT_ID);
  };

  const existing = await findClient();
  if (existing?.id) {
    if (existing.authenticationFlowBindingOverrides?.direct_grant !== flowId) {
      const res = await kcFetch(`${base}/admin/realms/${realm}/clients/${existing.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          authenticationFlowBindingOverrides: {
            ...existing.authenticationFlowBindingOverrides,
            direct_grant: flowId,
          },
        }),
      });
      if (!res.ok) throw new Error(`Keycloak update client error ${res.status}`);
    }
    return existing.id;
  }

  const createRes = await kcFetch(`${base}/admin/realms/${realm}/clients`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      clientId: OTP_VERIFY_CLIENT_ID,
      name: "EduTrack verificación 2FA",
      description: "Cliente interno del BFF para validar códigos TOTP. No usar para login.",
      protocol: "openid-connect",
      enabled: true,
      publicClient: false,
      standardFlowEnabled: false,
      implicitFlowEnabled: false,
      directAccessGrantsEnabled: true,
      serviceAccountsEnabled: false,
      fullScopeAllowed: false,
      authenticationFlowBindingOverrides: { direct_grant: flowId },
      attributes: { "access.token.lifespan": "60" },
    }),
  });
  if (!createRes.ok && createRes.status !== 409) {
    throw new Error(`Keycloak create client error ${createRes.status}`);
  }

  const created = await findClient();
  if (!created?.id) throw new Error("Keycloak no devolvió el cliente de verificación de OTP recién creado.");
  return created.id;
}

async function getOtpVerifyClientSecret(token: string, clientUuid: string): Promise<string> {
  const base = adminBaseUrl();
  const realm = adminRealm();
  const res = await kcFetch(`${base}/admin/realms/${realm}/clients/${clientUuid}/client-secret`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Keycloak client secret error ${res.status}`);
  const json = (await res.json()) as { value?: string };
  if (!json.value) throw new Error("Keycloak no devolvió el secreto del cliente de verificación de OTP.");
  return json.value;
}

let otpVerifySetupPromise: Promise<{ clientSecret: string }> | null = null;

function ensureOtpVerifySetup(): Promise<{ clientSecret: string }> {
  if (!otpVerifySetupPromise) {
    otpVerifySetupPromise = (async () => {
      const token = await getAdminToken();
      const flowId = await ensureOtpVerifyFlow(token);
      const clientUuid = await ensureOtpVerifyClient(token, flowId);
      const clientSecret = await getOtpVerifyClientSecret(token, clientUuid);
      return { clientSecret };
    })().catch((error) => {
      otpVerifySetupPromise = null;
      throw error;
    });
  }
  return otpVerifySetupPromise;
}

async function requestOtpVerifyToken(input: { clientSecret: string; username: string; code: string }): Promise<Response> {
  const body = new URLSearchParams({
    grant_type: "password",
    client_id: OTP_VERIFY_CLIENT_ID,
    client_secret: input.clientSecret,
    username: input.username,
    totp: input.code,
  });
  return kcFetch(`${adminBaseUrl()}/realms/${adminRealm()}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
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

/** Si la cuenta tiene contraseña en Keycloak. Quien se registró con Google no tiene. */
/**
 * ¿La cuenta tiene Google vinculado? `account` es el usuario de Google (su correo), para que la
 * persona sepa con qué cuenta entra.
 */
export async function getKeycloakUserGoogleLink(kcUserId: string): Promise<{ linked: boolean; account: string | null }> {
  const token = await getAdminToken();
  const res = await kcFetch(
    `${adminBaseUrl()}/admin/realms/${adminRealm()}/users/${encodeURIComponent(kcUserId)}/federated-identity`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Keycloak federated identity error ${res.status}: ${detail}`);
  }
  const links = (await res.json()) as { identityProvider?: string; userName?: string }[];
  const google = links.find((link) => link.identityProvider === GOOGLE_IDP_ALIAS);
  return { linked: Boolean(google), account: google?.userName ?? null };
}

export async function keycloakUserHasPassword(kcUserId: string): Promise<boolean> {
  const token = await getAdminToken();
  const res = await kcFetch(`${adminBaseUrl()}/admin/realms/${adminRealm()}/users/${encodeURIComponent(kcUserId)}/credentials`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Keycloak credentials error ${res.status}: ${detail}`);
  }
  const credentials = (await res.json()) as KeycloakCredential[];
  return credentials.some((credential) => credential.type === "password");
}

export async function verifyKeycloakUserOtpCode(kcUserId: string, code: string): Promise<boolean> {
  const normalizedCode = normalizeOtpCode(code);
  if (!kcUserId || !/^\d{6,8}$/.test(normalizedCode)) return false;
  const username = await getKeycloakUserLoginName(kcUserId);
  if (!username) return false;

  let setup = await ensureOtpVerifySetup();
  let res = await requestOtpVerifyToken({ clientSecret: setup.clientSecret, username, code: normalizedCode });
  if (res.ok) return true;

  let detail = await res.text().catch(() => "");
  // Secreto/cliente cacheado obsoleto (p. ej. secreto rotado a mano): se
  // reprovisiona una única vez y se reintenta.
  if (detail.includes("invalid_client") || detail.includes("unauthorized_client")) {
    otpVerifySetupPromise = null;
    setup = await ensureOtpVerifySetup();
    res = await requestOtpVerifyToken({ clientSecret: setup.clientSecret, username, code: normalizedCode });
    if (res.ok) return true;
    detail = await res.text().catch(() => "");
  }

  // invalid_grant = credenciales del usuario incorrectas (código TOTP inválido).
  if (detail.includes("invalid_grant")) return false;
  throw new Error(`Keycloak OTP verify error ${res.status}: ${detail}`);
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

/**
 * Fija la contraseña elegida con el enlace de "Olvidé mi contraseña". El correo lo manda EduTrack
 * (`auth/password-reset.ts`): el de Keycloak (`execute-actions-email`) necesita un SMTP que el
 * droplet no tiene.
 */
export async function resetKeycloakPassword(kcUserId: string, password: string): Promise<void> {
  const token = await getAdminToken();
  // El reset solo debe cambiar la contraseña; nunca encadenar la config de 2FA.
  await clearPendingTotpRequiredAction(token, kcUserId);
  await setKeycloakUserPassword(token, kcUserId, password);
}
