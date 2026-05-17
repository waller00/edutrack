import { randomBytes } from "crypto";
import http from "node:http";
import https from "node:https";
import { prisma } from "../db/prisma.js";

export type MoodleSyncUserInput = {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
};

function moodleBaseUrl(): string | null {
  const raw = process.env.MOODLE_BASE_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

function moodleToken(): string | null {
  const t = process.env.MOODLE_WS_TOKEN?.trim();
  return t || null;
}

function moodleCanonicalHostHeader(): string | null {
  const h = process.env.MOODLE_CANONICAL_HOST?.trim();
  return h || null;
}

/** POST application/x-www-form-urlencoded; opcionalmente fuerza Host (Moodle wwwroot vs URL de conexión en Docker). */
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

export function isMoodleIntegrationEnabled(): boolean {
  return Boolean(moodleBaseUrl() && moodleToken());
}

function moodleUsernameForEduTrackUser(userId: string): string {
  const hex = userId.replace(/-/g, "");
  const u = `et${hex}`;
  return u.length > 100 ? u.slice(0, 100) : u;
}

function deriveMoodleNames(user: MoodleSyncUserInput): { firstname: string; lastname: string } {
  const fn = user.firstName?.trim();
  const ln = user.lastName?.trim();
  if (fn && ln) return { firstname: fn.slice(0, 100), lastname: ln.slice(0, 100) };
  if (fn) return { firstname: fn.slice(0, 100), lastname: "-" };
  if (ln) return { firstname: "-", lastname: ln.slice(0, 100) };
  const n = user.name?.trim();
  if (n) {
    const parts = n.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return {
        firstname: parts[0]!.slice(0, 100),
        lastname: parts.slice(1).join(" ").slice(0, 100),
      };
    }
    return { firstname: n.slice(0, 100), lastname: "-" };
  }
  return { firstname: "Usuario", lastname: "EduTrack" };
}

function randomMoodlePassword(): string {
  const core = randomBytes(18).toString("base64url");
  return `Et${core}a1!`;
}

type MoodleRestJson = Record<string, unknown> | unknown[];

async function moodleRest(wsfunction: string, params: Record<string, string>): Promise<MoodleRestJson> {
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
    throw new Error(`MOODLE_HTTP_${status}: ${text.slice(0, 500)}`);
  }

  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      `MOODLE_BAD_RESPONSE: HTTP ${status}, len=${text.length}, body=${text.slice(0, 200)}`,
    );
  }
  if (data && typeof data === "object" && "exception" in data) {
    const o = data as Record<string, unknown>;
    throw new Error(
      `MOODLE_EXCEPTION: ${String(o.errorcode ?? o.message ?? o.exception)} ${JSON.stringify(data)}`,
    );
  }
  return data as MoodleRestJson;
}

async function getUsersByField(field: "idnumber" | "email", value: string): Promise<number[]> {
  const data = await moodleRest("core_user_get_users_by_field", {
    field,
    "values[0]": value,
  });
  if (!Array.isArray(data)) return [];
  const ids: number[] = [];
  for (const row of data) {
    if (row && typeof row === "object" && "id" in row) {
      const id = Number((row as { id: unknown }).id);
      if (Number.isFinite(id)) ids.push(id);
    }
  }
  return ids;
}

/**
 * Garantiza que exista un usuario en Moodle vinculado a EduTrack (`idnumber` = UUID).
 * No modifica EduTrack ni guarda el id de Moodle: la fuente de verdad sigue siendo la BD local.
 */
export async function ensureMoodleUser(user: MoodleSyncUserInput): Promise<void> {
  if (!isMoodleIntegrationEnabled()) return;

  const email = user.email?.trim().toLowerCase();
  if (!email) {
    console.warn("[moodle] ensureMoodleUser: sin email, se omite", user.id);
    return;
  }

  try {
    const byId = await getUsersByField("idnumber", user.id);
    if (byId.length > 0) return;

    const byEmail = await getUsersByField("email", email);
    if (byEmail.length > 0) {
      console.warn(
        "[moodle] Usuario Moodle existe por email pero sin idnumber EduTrack; no se duplica:",
        email,
      );
      return;
    }

    const { firstname, lastname } = deriveMoodleNames(user);
    const username = moodleUsernameForEduTrackUser(user.id);
    const password = randomMoodlePassword();

    const params: Record<string, string> = {
      "users[0][username]": username,
      "users[0][createpassword]": "0",
      "users[0][password]": password,
      "users[0][firstname]": firstname,
      "users[0][lastname]": lastname,
      "users[0][email]": email,
      "users[0][auth]": "manual",
      "users[0][idnumber]": user.id,
      "users[0][maildisplay]": "0",
    };

    const created = await moodleRest("core_user_create_users", params);
    if (!Array.isArray(created) || created.length === 0) {
      console.warn("[moodle] core_user_create_users respuesta inesperada:", created);
    }
  } catch (e) {
    console.error("[moodle] ensureMoodleUser falló:", user.id, e);
  }
}

export async function ensureMoodleUserById(userId: string): Promise<void> {
  if (!isMoodleIntegrationEnabled()) return;
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, firstName: true, lastName: true, name: true },
  });
  if (!u) return;
  await ensureMoodleUser(u);
}
