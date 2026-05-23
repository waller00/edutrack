/** Validación cédula uruguaya — una sola implementación para auth, admin, etc. */

export function onlyDigits(v: string) {
  return v.replace(/\D/g, "");
}

export function computeCICheckDigit(base7: string) {
  const weights = [2, 9, 8, 7, 6, 3, 4];
  const padded = base7.padStart(7, "0");
  const sum = padded
    .split("")
    .map((d, i) => parseInt(d, 10) * weights[i])
    .reduce((a, b) => a + b, 0);
  return (10 - (sum % 10)) % 10;
}

export function isValidUruguayanCI(ci: string) {
  const digits = onlyDigits(ci);
  if (digits.length < 7 || digits.length > 8) return false;
  const base = digits.slice(0, -1);
  const check = parseInt(digits.slice(-1), 10);
  return computeCICheckDigit(base) === check;
}
