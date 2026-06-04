import { onlyDigits, isValidUruguayanCI } from "../identity/uruguay-ci.js";

/** Celular Uruguay: 8 dígitos nacionales tras +598, siempre 9… (marcación local 09…). */
const UY_MOBILE_NATIONAL_RE = /^9\d{7}$/;

export function normalizePhoneUY(input: string | undefined) {
  if (!input) return undefined;
  const d = onlyDigits(input);
  if (!d) return undefined;

  let core: string;
  if (d.startsWith("598")) {
    const rest = d.slice(3).replace(/^0/, "");
    if (rest.length < 8) return undefined;
    core = rest.slice(0, 8);
  } else {
    const noZero = d.startsWith("0") ? d.slice(1) : d;
    if (noZero.length < 8) return undefined;
    core = noZero.slice(0, 8);
  }

  if (core.length !== 8) return undefined;
  if (!UY_MOBILE_NATIONAL_RE.test(core)) return undefined;
  if (isValidUruguayanCI(core)) return undefined;
  return "+598" + core;
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

/** Fecha de vencimiento del documento (cédula); pasado o futuro permitido. */
export function validateNationalIdDocumentExpiresAtUpdate(input?: string) {
  if (!input || !String(input).trim()) return undefined;
  const parsed = parseBirthdateInput(String(input).trim());
  if (isNaN(parsed.getTime())) throw new Error("INVALID_NATIONAL_ID_DOCUMENT_EXPIRES_AT");
  const y = parsed.getFullYear();
  if (y < 1950 || y > 2100) throw new Error("INVALID_NATIONAL_ID_DOCUMENT_EXPIRES_AT");
  return parsed;
}

export function mapProfileUpdateError(error: Error, res: { status: (n: number) => { json: (b: any) => any } }) {
  if (error.message === "USERNAME_CONFLICT")
    return res.status(409).json({ message: "Usuario ya en uso" });
  if (error.message === "EMAIL_CONFLICT")
    return res.status(409).json({ message: "Correo ya registrado" });
  if (error.message === "CI_CONFLICT")
    return res.status(409).json({ message: "Cédula ya registrada" });
  if (error.message === "INVALID_EMAIL")
    return res.status(400).json({ message: "Correo inválido" });
  if (error.message === "INVALID_CI") return res.status(400).json({ message: "Cédula inválida" });
  if (error.message === "INVALID_PHONE")
    return res.status(400).json({ message: "Teléfono inválido" });
  if (error.message === "INVALID_BIRTHDATE")
    return res.status(400).json({ message: "Fecha inválida" });
  if (error.message === "INVALID_NATIONAL_ID_DOCUMENT_EXPIRES_AT")
    return res.status(400).json({ message: "Vencimiento de documento inválido" });
  if (error.message === "FORBIDDEN") return res.status(403).json({ message: "Prohibido" });
  if (error.message === "NOT_FOUND") return res.status(401).json({ message: "No autorizado" });
  throw error;
}
