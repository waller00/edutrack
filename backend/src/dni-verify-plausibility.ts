function normalizeSurnameToken(s: string): string {
  return s
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

/**
 * Compara un token de apellido ingresado con uno extraído del OCR.
 * Rechaza iniciales o prefijos cortos ("P", "Pei") frente al apellido completo del DNI.
 */
export function surnameTokensMatchForVerification(providedToken: string, extractedToken: string): boolean {
  const p = normalizeSurnameToken(providedToken);
  const e = normalizeSurnameToken(extractedToken);
  if (!p || !e) return false;
  if (p === e) return true;

  // Prefijo/sufijo casi completo: como mucho 1 carácter de diferencia en longitud (ej. PEIRA vs PEIRAN)
  if (e.startsWith(p) && p.length >= e.length - 1) return true;
  if (p.startsWith(e) && e.length >= p.length - 1) return true;

  // Errores típicos de OCR / tipeo en apellidos de cierta longitud
  if (p.length >= 5 && e.length >= 5 && levenshtein(p, e) <= 2) return true;

  return false;
}

/** Nombre/apellido aceptable cuando el OCR no extrajo texto (evita strings vacíos o basura). */
export function isPlausiblePersonNamePart(value: string): boolean {
  const t = value.trim();
  if (t.length < 2 || t.length > 80) return false;
  if (!/[a-zA-ZáéíóúÁÉÍÓÚñÑ]/.test(t)) return false;
  return true;
}

/**
 * Fecha de nacimiento plausible si el usuario declara el dato pero el OCR no lo leyó.
 * (Bloquea fechas futuras, años absurdos, edad mínima y máxima.)
 */
export function evaluateBirthdatePlausibilityForOcrBypass(birthdate: string): {
  ok: boolean;
  failMessage: string;
} {
  const d = new Date(birthdate);
  if (Number.isNaN(d.getTime())) return { ok: false, failMessage: "✗ Fecha de nacimiento inválida" };

  const today = new Date();
  if (d > today) return { ok: false, failMessage: "✗ La fecha de nacimiento no puede ser futura" };

  const y = d.getFullYear();
  if (y < 1920 || y > today.getFullYear()) {
    return { ok: false, failMessage: "✗ Año de nacimiento fuera de rango razonable" };
  }

  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age -= 1;

  if (age < 5) return { ok: false, failMessage: "✗ La edad mínima permitida es 5 años" };
  if (age > 110) return { ok: false, failMessage: "✗ Verificá la fecha de nacimiento (edad fuera de rango)" };

  return { ok: true, failMessage: "" };
}
