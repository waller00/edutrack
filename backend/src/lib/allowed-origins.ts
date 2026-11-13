/**
 * Orígenes del front que pueden hablarle a la API con la cookie de sesión. Los usan CORS (qué
 * respuestas puede leer el navegador) y el chequeo de Origin (qué escrituras se aceptan): tienen
 * que ser la misma lista, por eso viven acá.
 */

export function normalizeOrigin(url: string): string {
  return url
    .trim()
    .replace(/\r/g, "")
    .replace(/\/$/, "");
}

function addOrigin(set: Set<string>, value: string | undefined) {
  const origin = normalizeOrigin(value || "");
  if (origin) set.add(origin);
}

function addWwwVariant(set: Set<string>, origin: string) {
  try {
    const url = new URL(origin);
    if (url.hostname.startsWith("www.")) {
      url.hostname = url.hostname.replace(/^www\./, "");
      addOrigin(set, url.origin);
    } else {
      url.hostname = `www.${url.hostname}`;
      addOrigin(set, url.origin);
    }
  } catch {
    /* origen inválido: se ignora */
  }
}

function addApiSiblingFrontend(set: Set<string>, origin: string) {
  try {
    const url = new URL(origin);
    if (!url.hostname.startsWith("api.")) return;
    url.hostname = url.hostname.replace(/^api\./, "");
    addOrigin(set, url.origin);
    addWwwVariant(set, url.origin);
  } catch {
    /* origen inválido: se ignora */
  }
}

/** Orígenes permitidos: FRONTEND_URL + lista opcional CORS_ORIGINS (separados por coma), p. ej. https://edutrack-uy.com,https://www.edutrack-uy.com */
export function buildAllowedOrigins(): Set<string> {
  const set = new Set<string>();
  const primary = process.env.FRONTEND_URL || "http://localhost:3000";
  addOrigin(set, primary);
  addWwwVariant(set, primary);
  addApiSiblingFrontend(set, primary);
  if (process.env.NODE_ENV === "production") {
    addOrigin(set, "https://edutrack-uy.com");
    addOrigin(set, "https://www.edutrack-uy.com");
  }
  const extra = process.env.CORS_ORIGINS;
  if (extra) {
    for (const part of extra.split(",")) {
      addOrigin(set, part);
    }
  }
  return set;
}

export function isAllowedOrigin(origin: string): boolean {
  return buildAllowedOrigins().has(normalizeOrigin(origin));
}
