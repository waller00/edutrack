import { onlyDigits } from "./uruguay-ci.js";

export function normalizePhoneUY(input: string | undefined) {
  if (!input) return undefined;
  const d = onlyDigits(input);
  if (!d) return undefined;
  if (d.startsWith("598")) {
    const rest = d.slice(3).replace(/^0/, "");
    return "+598" + rest;
  }
  const noZero = d.startsWith("0") ? d.slice(1) : d;
  if (noZero.length >= 8) return "+598" + noZero.slice(0, 8);
  return undefined;
}

export function buildProfileName(firstName?: string, lastName?: string) {
  return `${firstName ?? ""} ${lastName ?? ""}`.trim();
}

export function parseBirthdateInput(birthdate: string) {
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(birthdate)) {
    const [dd, mm, yyyy] = birthdate.split("/").map(Number);
    return new Date(yyyy, mm - 1, dd);
  }
  return new Date(birthdate);
}

export function validateRoleUpdate(
  role: "ADMIN" | "STAFF" | "TEACHER" | undefined,
  isAdmin: boolean,
  me: { isApproved?: boolean } | null
) {
  if (!role) return undefined;
  if (!isAdmin && me?.isApproved) throw new Error("FORBIDDEN");
  if (!isAdmin && role === "ADMIN") throw new Error("FORBIDDEN");
  return role;
}

export function validatePhoneUpdate(phone?: string) {
  if (!phone) return undefined;
  const normPhone = normalizePhoneUY(phone);
  if (!normPhone) throw new Error("INVALID_PHONE");
  return normPhone;
}

export function validateBirthdateUpdate(birthdate?: string) {
  if (!birthdate) return undefined;
  const parsedBirthdate = parseBirthdateInput(birthdate);
  if (isNaN(parsedBirthdate.getTime()) || parsedBirthdate > new Date())
    throw new Error("INVALID_BIRTHDATE");
  return parsedBirthdate;
}

export function mapProfileUpdateError(error: Error, res: { status: (n: number) => { json: (b: any) => any } }) {
  if (error.message === "USERNAME_CONFLICT")
    return res.status(409).json({ message: "Usuario ya en uso" });
  if (error.message === "CI_CONFLICT")
    return res.status(409).json({ message: "Cédula ya registrada" });
  if (error.message === "INVALID_CI") return res.status(400).json({ message: "Cédula inválida" });
  if (error.message === "INVALID_PHONE")
    return res.status(400).json({ message: "Teléfono inválido" });
  if (error.message === "INVALID_BIRTHDATE")
    return res.status(400).json({ message: "Fecha inválida" });
  if (error.message === "FORBIDDEN") return res.status(403).json({ message: "Prohibido" });
  throw error;
}
