/** Formato y validación CI / teléfono UY (register, onboarding, etc.) */

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

export function isValidLocalPhoneUY(local: string) {
  return /^\d{8}$/.test(normalizeLocalPhoneUY(local));
}
