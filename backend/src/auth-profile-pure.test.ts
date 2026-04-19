import { describe, it, expect } from "vitest";
import {
  normalizePhoneUY,
  buildProfileName,
  parseBirthdateInput,
  validateRoleUpdate,
  validatePhoneUpdate,
  validateBirthdateUpdate,
  validateNationalIdDocumentExpiresAtUpdate,
  mapProfileUpdateError,
} from "./auth-profile-pure.js";

describe("auth-profile-pure", () => {
  it("normalizePhoneUY 09xxxxxxxx → +598", () => {
    expect(normalizePhoneUY("099123456")).toBe("+59899123456");
  });

  it("normalizePhoneUY inválido → undefined", () => {
    expect(normalizePhoneUY("12")).toBeUndefined();
    expect(normalizePhoneUY(undefined)).toBeUndefined();
  });

  it("normalizePhoneUY recorta prefijo 598 y cero local", () => {
    expect(normalizePhoneUY("598099123456")).toBe("+59899123456");
  });

  it("normalizePhoneUY rechaza dígitos que son cédula válida", () => {
    expect(normalizePhoneUY("41234563")).toBeUndefined();
    expect(normalizePhoneUY("59841234563")).toBeUndefined();
  });

  it("normalizePhoneUY rechaza línea fija (debe ser celular 9…)", () => {
    expect(normalizePhoneUY("021234567")).toBeUndefined();
    expect(normalizePhoneUY("+59821234567")).toBeUndefined();
  });

  it("buildProfileName", () => {
    expect(buildProfileName("Ana", "García")).toBe("Ana García");
    expect(buildProfileName(undefined, undefined)).toBe("");
  });

  it("parseBirthdateInput formato DD/MM/YYYY", () => {
    const d = parseBirthdateInput("15/03/1990");
    expect(d.getFullYear()).toBe(1990);
    expect(d.getMonth()).toBe(2);
  });

  it("parseBirthdateInput acepta ISO", () => {
    expect(parseBirthdateInput("2000-05-20T00:00:00.000Z")).toBeInstanceOf(Date);
  });

  it("validateRoleUpdate no admin no puede ADMIN", () => {
    expect(() => validateRoleUpdate("ADMIN", false, { isApproved: false })).toThrow("FORBIDDEN");
  });

  it("validateRoleUpdate aprobado no admin no cambia rol", () => {
    expect(() => validateRoleUpdate("STAFF", false, { isApproved: true })).toThrow("FORBIDDEN");
  });

  it("validateRoleUpdate admin ok", () => {
    expect(validateRoleUpdate("TEACHER", true, { isApproved: true })).toBe("TEACHER");
  });

  it("validateRoleUpdate undefined no cambia", () => {
    expect(validateRoleUpdate(undefined, false, null)).toBeUndefined();
  });

  it("validatePhoneUpdate", () => {
    expect(validatePhoneUpdate(undefined)).toBeUndefined();
    expect(() => validatePhoneUpdate("xx")).toThrow("INVALID_PHONE");
  });

  it("validateBirthdateUpdate futuro falla", () => {
    const far = new Date();
    far.setFullYear(far.getFullYear() + 2);
    expect(() => validateBirthdateUpdate(far.toISOString())).toThrow("INVALID_BIRTHDATE");
  });

  it("validateBirthdateUpdate válida devuelve Date", () => {
    expect(validateBirthdateUpdate("15/03/1990")).toBeInstanceOf(Date);
  });

  it("validateNationalIdDocumentExpiresAtUpdate vacío → undefined", () => {
    expect(validateNationalIdDocumentExpiresAtUpdate(undefined)).toBeUndefined();
    expect(validateNationalIdDocumentExpiresAtUpdate("")).toBeUndefined();
  });

  it("validateNationalIdDocumentExpiresAtUpdate acepta futuro", () => {
    const d = validateNationalIdDocumentExpiresAtUpdate("2035-06-10");
    expect(d).toBeInstanceOf(Date);
  });

  it("validateNationalIdDocumentExpiresAtUpdate año fuera de rango falla", () => {
    expect(() => validateNationalIdDocumentExpiresAtUpdate("2140-01-01")).toThrow(
      "INVALID_NATIONAL_ID_DOCUMENT_EXPIRES_AT",
    );
  });

  it("mapProfileUpdateError todas las ramas", () => {
    const res = () => ({
      status: (n: number) => ({
        json: (b: any) => ({ code: n, b }),
      }),
    });
    expect(mapProfileUpdateError(new Error("USERNAME_CONFLICT"), res() as any).code).toBe(409);
    expect(mapProfileUpdateError(new Error("CI_CONFLICT"), res() as any).code).toBe(409);
    expect(mapProfileUpdateError(new Error("INVALID_CI"), res() as any).code).toBe(400);
    expect(mapProfileUpdateError(new Error("INVALID_PHONE"), res() as any).code).toBe(400);
    expect(mapProfileUpdateError(new Error("INVALID_BIRTHDATE"), res() as any).code).toBe(400);
    expect(mapProfileUpdateError(new Error("INVALID_NATIONAL_ID_DOCUMENT_EXPIRES_AT"), res() as any).code).toBe(400);
    expect(mapProfileUpdateError(new Error("FORBIDDEN"), res() as any).code).toBe(403);
    expect(() => mapProfileUpdateError(new Error("OTHER"), res() as any)).toThrow("OTHER");
  });
});
