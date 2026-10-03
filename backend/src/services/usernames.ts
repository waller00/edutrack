import crypto from "node:crypto";

/**
 * Generación de usernames con formato `nombre.apellido`, compartida entre las
 * cuentas de EduTrack (tabla User) y las cuentas Moodle de estudiantes (tabla
 * Student). La unicidad se delega en `isTaken` porque cada caller la verifica
 * contra su propia tabla.
 */

export function usernamePart(input: string) {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s.-]/g, "")
    .trim()
    .split(/[\s.-]+/)
    .filter(Boolean);
}

export function fitUsername(base: string, suffix = "") {
  const maxBase = Math.max(3, 30 - suffix.length);
  return `${base.slice(0, maxBase).replace(/[.-]+$/g, "")}${suffix}`;
}

export async function generateUniqueUsername(
  firstName: string,
  lastName: string,
  isTaken: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const first = usernamePart(firstName)[0] || "usuario";
  const lastParts = usernamePart(lastName);
  const firstLast = lastParts[0] || "sinapellido";
  const base = `${first}.${firstLast}`.slice(0, 30).replace(/[.-]+$/g, "");

  // Letras del/los apellido(s) restantes para desempatar de a poco:
  // joaquin.waller → joaquin.waller.p → joaquin.waller.pe → … (apellido "peña").
  const restLetters = lastParts.slice(1).join("");

  const candidates = [base];
  for (let i = 1; i <= restLetters.length; i += 1) {
    candidates.push(fitUsername(base, `.${restLetters.slice(0, i)}`));
  }
  for (const candidate of candidates) {
    if (!(await isTaken(candidate))) return candidate;
  }

  // Si hasta el apellido completo coincide, recién ahí se cae a números.
  for (let i = 2; i <= 9999; i += 1) {
    const candidate = fitUsername(base, String(i));
    if (!(await isTaken(candidate))) return candidate;
  }
  return fitUsername(base, `.${crypto.randomBytes(2).toString("hex")}`);
}
