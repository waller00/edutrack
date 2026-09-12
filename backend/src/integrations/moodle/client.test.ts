import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isMoodleIntegrationEnabled,
  moodleBaseUrl,
  moodleCanonicalHostHeader,
  moodleRootCategoryId,
  moodleStudentRoleId,
  moodleSubstituteTeacherRoleId,
  moodleTeacherRoleId,
  moodlePublicUrl,
  moodleToken,
  moodleUserAuthMethod,
  moodleUserLang,
  moodleUserLangParam,
} from "./client.js";

const MOODLE_ENV_KEYS = [
  "MOODLE_BASE_URL",
  "MOODLE_WS_TOKEN",
  "MOODLE_CANONICAL_HOST",
  "MOODLE_ROLE_TEACHER_ID",
  "MOODLE_ROLE_STUDENT_ID",
  "MOODLE_ROLE_SUBSTITUTE_TEACHER_ID",
  "MOODLE_ROOT_CATEGORY_ID",
  "MOODLE_USER_AUTH",
  "MOODLE_PUBLIC_URL",
  "MOODLE_USER_LANG",
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of MOODLE_ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of MOODLE_ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("moodle client config", () => {
  it("moodleBaseUrl recorta las barras finales", () => {
    process.env.MOODLE_BASE_URL = "https://moodle.local/";
    expect(moodleBaseUrl()).toBe("https://moodle.local");
    process.env.MOODLE_BASE_URL = "https://moodle.local///";
    expect(moodleBaseUrl()).toBe("https://moodle.local");
  });

  it("moodleBaseUrl es null si no está configurado", () => {
    expect(moodleBaseUrl()).toBeNull();
  });

  it("moodleToken devuelve el token o null", () => {
    expect(moodleToken()).toBeNull();
    process.env.MOODLE_WS_TOKEN = "  tok123  ";
    expect(moodleToken()).toBe("tok123");
  });

  it("moodleCanonicalHostHeader devuelve el host o null", () => {
    expect(moodleCanonicalHostHeader()).toBeNull();
    process.env.MOODLE_CANONICAL_HOST = "moodle.internal";
    expect(moodleCanonicalHostHeader()).toBe("moodle.internal");
  });

  it("isMoodleIntegrationEnabled requiere URL y token", () => {
    expect(isMoodleIntegrationEnabled()).toBe(false);
    process.env.MOODLE_BASE_URL = "https://moodle.local";
    expect(isMoodleIntegrationEnabled()).toBe(false);
    process.env.MOODLE_WS_TOKEN = "tok";
    expect(isMoodleIntegrationEnabled()).toBe(true);
  });

  it("los ids de rol/categoría usan defaults estándar y aceptan override numérico", () => {
    expect(moodleTeacherRoleId()).toBe(3);
    expect(moodleStudentRoleId()).toBe(5);
    expect(moodleRootCategoryId()).toBe(0);

    process.env.MOODLE_ROLE_TEACHER_ID = "7";
    process.env.MOODLE_ROLE_STUDENT_ID = "9";
    process.env.MOODLE_ROOT_CATEGORY_ID = "11";
    expect(moodleTeacherRoleId()).toBe(7);
    expect(moodleStudentRoleId()).toBe(9);
    expect(moodleRootCategoryId()).toBe(11);
  });

  it("un override no numérico cae al default", () => {
    process.env.MOODLE_ROLE_TEACHER_ID = "abc";
    expect(moodleTeacherRoleId()).toBe(3);
  });

  it("moodlePublicUrl exige MOODLE_PUBLIC_URL y NO cae a la URL interna", () => {
    // Sin la variable explícita devuelve null aunque MOODLE_BASE_URL esté seteada
    // (evita mandar emails con links a la URL interna de Docker).
    process.env.MOODLE_BASE_URL = "http://moodle:8080";
    expect(moodlePublicUrl()).toBeNull();

    process.env.MOODLE_PUBLIC_URL = "https://moodle.edutrack-uy.com/";
    expect(moodlePublicUrl()).toBe("https://moodle.edutrack-uy.com");
  });

  it("el rol suplente reutiliza el rol titular si no se configura", () => {
    expect(moodleSubstituteTeacherRoleId()).toBe(3);
    process.env.MOODLE_ROLE_TEACHER_ID = "7";
    expect(moodleSubstituteTeacherRoleId()).toBe(7); // hereda el titular
    process.env.MOODLE_ROLE_SUBSTITUTE_TEACHER_ID = "12";
    expect(moodleSubstituteTeacherRoleId()).toBe(12); // override explícito
  });

  it("moodleUserAuthMethod por defecto es manual", () => {
    expect(moodleUserAuthMethod()).toBe("manual");
    process.env.MOODLE_USER_AUTH = "oauth2";
    expect(moodleUserAuthMethod()).toBe("oauth2");
  });

  it("moodleUserLang es null por defecto (no forzar lang; usa el default del sitio)", () => {
    // Clave del fix: sin MOODLE_USER_LANG NO se manda lang, así un pack no instalado
    // no rompe toda la creación de usuarios (invalidparameter).
    expect(moodleUserLang()).toBeNull();
    process.env.MOODLE_USER_LANG = "  es  ";
    expect(moodleUserLang()).toBe("es");
  });

  it("moodleUserLangParam omite la key salvo que MOODLE_USER_LANG esté seteado", () => {
    expect(moodleUserLangParam("users[0]")).toEqual({});
    process.env.MOODLE_USER_LANG = "es";
    expect(moodleUserLangParam("users[0]")).toEqual({ "users[0][lang]": "es" });
  });
});
