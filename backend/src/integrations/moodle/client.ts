import http from "node:http";
import https from "node:https";

/**
 * Cliente REST de bajo nivel para los servicios web de Moodle.
 *
 * Sólo conoce HTTP + el protocolo REST de Moodle; no sabe nada del dominio de EduTrack.
 * Las capas `users`/`courses`/`enrolments`/`reconcile` construyen sobre esto.
 */

export function moodleBaseUrl(): string | null {
  const raw = process.env.MOODLE_BASE_URL?.trim();
  if (!raw) return null;
  let end = raw.length;
  while (end > 0 && raw[end - 1] === "/") end -= 1;
  return raw.slice(0, end);
}

export function moodleToken(): string | null {
  const t = process.env.MOODLE_WS_TOKEN?.trim();
  return t || null;
}

/** Fuerza la cabecera Host cuando el wwwroot de Moodle difiere de la URL de conexión (Docker). */
export function moodleCanonicalHostHeader(): string | null {
  const h = process.env.MOODLE_CANONICAL_HOST?.trim();
  return h || null;
}

export function isMoodleIntegrationEnabled(): boolean {
  return Boolean(moodleBaseUrl() && moodleToken());
}

/** Id de rol de Moodle para profesor con edición (default estándar: editingteacher = 3). */
export function moodleTeacherRoleId(): number {
  return Number(process.env.MOODLE_ROLE_TEACHER_ID || 3) || 3;
}

/** Id de rol de Moodle para estudiante (default estándar: student = 5). */
export function moodleStudentRoleId(): number {
  return Number(process.env.MOODLE_ROLE_STUDENT_ID || 5) || 5;
}

/**
 * Id de rol con el que se inscribe a un docente suplente. Si no se configura
 * `MOODLE_ROLE_SUBSTITUTE_TEACHER_ID`, se reutiliza el rol docente titular.
 */
export function moodleSubstituteTeacherRoleId(): number {
  const raw = process.env.MOODLE_ROLE_SUBSTITUTE_TEACHER_ID?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : moodleTeacherRoleId();
}

/** Id de categoría raíz donde se crean las categorías de EduTrack (0 = nivel superior). */
export function moodleRootCategoryId(): number {
  return Number(process.env.MOODLE_ROOT_CATEGORY_ID || 0) || 0;
}

/** Método de autenticación con el que se crean los usuarios espejo (manual | oauth2 | nologin). */
export function moodleUserAuthMethod(): string {
  return process.env.MOODLE_USER_AUTH?.trim() || "manual";
}

/**
 * URL pública de Moodle para links en emails al alumno (`MOODLE_PUBLIC_URL`).
 *
 * NO cae en `MOODLE_BASE_URL`: en Docker esa es la URL interna (`http://moodle:8080`), que
 * produciría links inservibles en el correo. Si no está configurada devolvemos `null` para que
 * el envío falle de forma visible (tarea FAILED con error claro) en vez de mandar links rotos.
 * En local hay que setear `MOODLE_PUBLIC_URL=http://localhost:8080`; en prod la URL pública HTTPS.
 */
export function moodlePublicUrl(): string | null {
  const raw = process.env.MOODLE_PUBLIC_URL?.trim();
  return raw ? raw.replace(/\/+$/, "") : null;
}

/** POST application/x-www-form-urlencoded; opcionalmente fuerza Host. */
function httpPostFormUrlEncoded(
  requestBase: string,
  pathname: string,
  body: string,
  hostHeader: string | null,
): Promise<{ status: number; text: string }> {
  const base = new URL(requestBase.includes("://") ? requestBase : `http://${requestBase}`);
  const isHttps = base.protocol === "https:";
  const lib = isHttps ? https : http;
  const defaultPort = isHttps ? 443 : 80;
  const port = base.port ? Number(base.port) : defaultPort;
  const pathWithSearch = pathname.startsWith("/") ? pathname : `/${pathname}`;

  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "Content-Length": String(Buffer.byteLength(body, "utf8")),
    };
    if (hostHeader) headers.Host = hostHeader;

    const req = lib.request(
      {
        hostname: base.hostname,
        port,
        path: pathWithSearch,
        method: "POST",
        headers,
        timeout: 20_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("MOODLE_TIMEOUT"));
    });
    req.write(body);
    req.end();
  });
}

export type MoodleRestJson = Record<string, unknown> | unknown[];

/**
 * Invoca una función de servicio web de Moodle (formato REST/JSON).
 * Lanza `Error` con prefijo `MOODLE_*` en fallos de transporte, HTTP o excepción de Moodle,
 * para que la capa de outbox decida reintentar.
 */
export async function moodleRest(
  wsfunction: string,
  params: Record<string, string>,
): Promise<MoodleRestJson> {
  const base = moodleBaseUrl();
  const token = moodleToken();
  if (!base || !token) throw new Error("MOODLE_NOT_CONFIGURED");

  const body = new URLSearchParams({
    wstoken: token,
    wsfunction,
    moodlewsrestformat: "json",
    ...params,
  }).toString();

  const path = "/webservice/rest/server.php";
  const hostHeader = moodleCanonicalHostHeader();
  const { status, text } = await httpPostFormUrlEncoded(base, path, body, hostHeader);

  if (status < 200 || status >= 300) {
    throw new Error(`MOODLE_HTTP_${status} [${wsfunction}]: ${text.slice(0, 500)}`);
  }

  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      `MOODLE_BAD_RESPONSE [${wsfunction}]: HTTP ${status}, len=${text.length}, body=${text.slice(0, 200)}`,
    );
  }
  if (data && typeof data === "object" && !Array.isArray(data) && "exception" in data) {
    const o = data as Record<string, unknown>;
    // Incluir la wsfunction y el debuginfo (si Moodle lo manda) para ubicar el parámetro inválido.
    const detail = o.debuginfo ? ` debuginfo=${String(o.debuginfo)}` : "";
    throw new Error(
      `MOODLE_EXCEPTION [${wsfunction}]: ${String(o.errorcode ?? o.message ?? o.exception)}${detail} ${JSON.stringify(data)}`,
    );
  }
  return data as MoodleRestJson;
}
