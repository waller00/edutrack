import { z } from "zod";

/** Misma regla que `frontend/web/src/lib/password-strength.ts` (mantener alineadas). */
const STRONG_PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
export const PASSWORD_MAX_LENGTH = 64;

export const STRONG_PASSWORD_MESSAGE =
  "La contraseña debe tener al menos 8 caracteres, una mayúscula, una minúscula y un número";
export const PASSWORD_TOO_LONG_MESSAGE = "La contraseña no puede superar los 64 caracteres";

export function isStrongPassword(pw: string): boolean {
  return pw.length <= PASSWORD_MAX_LENGTH && STRONG_PASSWORD_RE.test(pw);
}

/** Contraseña nueva: registro, reset, establecer/cambiar contraseña. No usar en login. */
export const strongPasswordSchema = z
  .string()
  .min(8, STRONG_PASSWORD_MESSAGE)
  .max(PASSWORD_MAX_LENGTH, PASSWORD_TOO_LONG_MESSAGE)
  .refine(isStrongPassword, { message: STRONG_PASSWORD_MESSAGE });

export function firstZodIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Datos inválidos";
}
