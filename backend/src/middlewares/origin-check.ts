import type { NextFunction, Request, Response } from "express";
import { isAllowedOrigin } from "../lib/allowed-origins.js";

/**
 * Defensa contra CSRF para la API con cookie de sesión.
 *
 * `SameSite=Lax` no alcanza: la cookie se comparte con los subdominios (`COOKIE_DOMAIN`), y para
 * el navegador `moodle.edutrack-uy.com` es "el mismo sitio", así que un formulario desde ahí
 * llevaría la sesión. Y un formulario simple (urlencoded) no dispara el preflight de CORS.
 *
 * Toda escritura que trae `Origin` tiene que venir del front (la misma lista que CORS). Los
 * navegadores siempre lo mandan en un POST/PUT/PATCH/DELETE de otro origen; si no viene, es un
 * cliente que no es un navegador (lectores biométricos, scripts, el SSR de Next) y no lleva la
 * cookie de nadie, así que pasa. `Origin: null` (iframes con sandbox, `file://`, redirecciones
 * cruzadas) se rechaza.
 */

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Lo que no pasa por acá:
 * - `/auth`: el login y el registro tienen su propio flujo (state OIDC, rate limit) y no se toca.
 * - `/iclock` y `/biometric/adms-ingest`: los lectores no son navegadores.
 * - `/security/csp-report`: los reportes de CSP los manda el navegador por su cuenta.
 */
const EXEMPT_PREFIXES = ["/auth", "/iclock", "/biometric/adms-ingest", "/security/csp-report"] as const;

function isExempt(path: string): boolean {
  return EXEMPT_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export const ORIGIN_NOT_ALLOWED = {
  message: "No se pudo completar la acción desde esta página. Abrí EduTrack desde su dirección habitual y probá de nuevo.",
  code: "ORIGIN_NOT_ALLOWED",
} as const;

export function originCheck() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!UNSAFE_METHODS.has(req.method)) return next();
    if (isExempt(req.path)) return next();

    const origin = req.headers.origin;
    if (origin === undefined) return next();
    if (origin !== "null" && isAllowedOrigin(origin)) return next();

    // Sin el path completo ni query: sólo lo necesario para investigar.
    console.warn(`[origin-check] escritura rechazada: ${req.method} ${req.path} origin=${String(origin).slice(0, 200)}`);
    return res.status(403).json(ORIGIN_NOT_ALLOWED);
  };
}
