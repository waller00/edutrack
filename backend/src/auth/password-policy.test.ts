import { describe, expect, it } from "vitest";
import { isStrongPassword, strongPasswordSchema } from "./password-policy.js";

describe("password-policy", () => {
  it("acepta mayúscula, minúscula y dígito con longitud >= 8", () => {
    expect(isStrongPassword("Abcd1234")).toBe(true);
    expect(isStrongPassword("Xy1aaaaa")).toBe(true);
  });

  it("rechaza sin mayúscula, sin minúscula o sin dígito", () => {
    expect(isStrongPassword("abcd1234")).toBe(false);
    expect(isStrongPassword("ABCD1234")).toBe(false);
    expect(isStrongPassword("AbcdEfgh")).toBe(false);
    expect(isStrongPassword("Short1")).toBe(false);
  });

  it("strongPasswordSchema falla con mensaje unificado", () => {
    const r = strongPasswordSchema.safeParse("alllower1");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toContain("mayúscula");
  });

  it("rechaza contraseñas de más de 64 caracteres", () => {
    const tooLong = `Aa1${"x".repeat(62)}`;
    expect(isStrongPassword(tooLong)).toBe(false);
    const r = strongPasswordSchema.safeParse(tooLong);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toContain("64");
  });
});
