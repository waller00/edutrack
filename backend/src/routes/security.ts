import express, { Router } from "express";
import { rateLimit } from "../middlewares/rate-limit.js";

/**
 * Reportes de violaciones de la Content-Security-Policy del front (nginx la manda primero en modo
 * Report-Only). Cada reporte queda como una línea en el log (Loki): de ahí sale qué haría falta
 * permitir antes de pasar la política a obligatoria, y después, si alguien inyecta un script.
 *
 * Es público (lo manda el navegador, sin sesión), así que: cuerpo chico, rate limit por IP, y del
 * reporte sólo se guarda directiva y URLs sin query (pueden traer tokens o datos de la pantalla).
 */
const r = Router();

const MAX_FIELD = 200;

const cspReportParser = express.json({
  type: ["application/csp-report", "application/reports+json", "application/json"],
  limit: "10kb",
});

/** URL sin query ni fragmento; los valores especiales ("inline", "eval", "data") quedan igual. */
export function sanitizeReportUri(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`.slice(0, MAX_FIELD);
  } catch {
    return raw.split(/[?#]/)[0].slice(0, MAX_FIELD);
  }
}

type CspViolation = {
  directive: string | null;
  blocked: string | null;
  document: string | null;
  disposition: string | null;
};

function field(source: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) if (source[key] !== undefined) return source[key];
  return undefined;
}

/** Acepta los dos formatos: `report-uri` (`{ "csp-report": {...} }`) y Reporting API (`[{ type, body }]`). */
export function parseCspReports(body: unknown): CspViolation[] {
  const raw: Record<string, unknown>[] = [];
  if (Array.isArray(body)) {
    for (const item of body.slice(0, 20)) {
      if (item && typeof item === "object" && (item as any).type === "csp-violation" && (item as any).body) {
        raw.push((item as any).body);
      }
    }
  } else if (body && typeof body === "object" && (body as any)["csp-report"]) {
    raw.push((body as any)["csp-report"]);
  }
  return raw.map((report) => {
    const directive = field(report, "effective-directive", "effectiveDirective", "violated-directive", "violatedDirective");
    const disposition = field(report, "disposition");
    return {
      directive: typeof directive === "string" ? directive.slice(0, MAX_FIELD) : null,
      blocked: sanitizeReportUri(field(report, "blocked-uri", "blockedURL")),
      document: sanitizeReportUri(field(report, "document-uri", "documentURL")),
      disposition: typeof disposition === "string" ? disposition.slice(0, 20) : null,
    };
  });
}

r.post(
  "/csp-report",
  rateLimit({ bucket: "csp-report", max: 60, windowSeconds: 60 }),
  cspReportParser,
  (req, res) => {
    for (const violation of parseCspReports(req.body)) {
      console.warn(JSON.stringify({ msg: "csp-violation", ...violation }));
    }
    res.status(204).end();
  },
);

export default r;
