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
  const secondInitial = lastParts[1]?.charAt(0) || "";
  const base = `${first}.${firstLast}`.slice(0, 30).replace(/[.-]+$/g, "");

  const candidates = [base];
  if (secondInitial) candidates.push(fitUsername(base, `.${secondInitial}`));
  for (const candidate of candidates) {
    if (!(await isTaken(candidate))) return candidate;
  }

  const numberedBase = secondInitial ? fitUsername(base, `.${secondInitial}`) : base;
  for (let i = 1; i <= 9999; i += 1) {
    const candidate = fitUsername(numberedBase, String(i));
    if (!(await isTaken(candidate))) return candidate;
  }
  return fitUsername(base, `.${crypto.randomBytes(2).toString("hex")}`);
}
