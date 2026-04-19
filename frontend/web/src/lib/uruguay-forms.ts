/** Formato y validación CI / teléfono UY (register, onboarding, etc.) */

/** 8 dígitos nacionales de celular UY (equivalente a prefijo 09 sin el 0 inicial duplicado). */
const UY_MOBILE_NATIONAL_RE = /^9\d{7}$/

export function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

export function formatUruguayanCI(input: string) {
  const digits = onlyDigits(input).slice(0, 8);
  if (digits.length <= 1) return digits;
  if (digits.length <= 4) return `${digits[0]}.${digits.slice(1)}`;
  if (digits.length <= 7) return `${digits[0]}.${digits.slice(1, 4)}.${digits.slice(4)}`;
  return `${digits[0]}.${digits.slice(1, 4)}.${digits.slice(4, 7)}-${digits.slice(7)}`;
}

function computeCICheckDigit(base7: string) {
  const weights = [2, 9, 8, 7, 6, 3, 4];
  const padded = base7.padStart(7, "0");
  const sum = padded
    .split("")
    .map((d, i) => parseInt(d, 10) * weights[i])
    .reduce((a, b) => a + b, 0);
  return (10 - (sum % 10)) % 10;
}

export function isValidUruguayanCI(input: string) {
  const digits = onlyDigits(input);
  if (digits.length < 7 || digits.length > 8) return false;
  const base = digits.slice(0, -1);
  const check = parseInt(digits.slice(-1), 10);
  return computeCICheckDigit(base) === check;
}

export function normalizeLocalPhoneUY(local: string) {
  const digits = onlyDigits(local);
  if (!digits) return "";
  return digits.startsWith("0") ? digits.slice(1) : digits;
}

/** Convierte +5989XXXXXXX guardado en BD al valor del input local (09XXXXXXXX). */
export function formatLocalMobileInputFromE164(phone: string | null | undefined): string {
  if (!phone?.trim()) return "";
  const d = onlyDigits(phone);
  const rest = d.startsWith("598") ? d.slice(3) : d;
  const core = rest.startsWith("0") ? rest.slice(1) : rest;
  if (UY_MOBILE_NATIONAL_RE.test(core)) return `0${core}`;
  return "";
}

export function isValidLocalPhoneUY(local: string) {
  const d = onlyDigits(local);
  if (!d.startsWith("09") || d.length !== 9) return false;
  const n = normalizeLocalPhoneUY(local);
  if (!UY_MOBILE_NATIONAL_RE.test(n)) return false;
  if (isValidUruguayanCI(n)) return false;
  return true;
}
