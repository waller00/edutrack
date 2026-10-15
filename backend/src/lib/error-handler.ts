import type { NextFunction, Request, Response } from "express";

/** Mensajes para los errores del cliente que llegan hasta acá (JSON mal formado, cuerpo enorme…). */
const CLIENT_ERROR_MESSAGES: Record<number, string> = {
  400: "Solicitud inválida",
  413: "La solicitud es demasiado grande",
  415: "Formato de solicitud no soportado",
};

function statusOf(err: unknown): number {
  const status = (err as { status?: unknown; statusCode?: unknown } | null)?.status ??
    (err as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === "number" && status >= 400 && status < 600 ? status : 500;
}

/**
 * Último manejador de errores de la API: responde JSON en vez de la página HTML de Express (que en
 * desarrollo incluye el stack). Un error del servidor nunca expone su mensaje interno.
 */
export function jsonErrorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  // Si la respuesta ya empezó a salir, sólo Express puede cortar la conexión.
  if (res.headersSent) return next(err);
  const status = statusOf(err);
  if (status >= 500) {
    console.error(`[api] ${req.method} ${req.originalUrl}:`, err);
    return res.status(status).json({ message: "Error interno del servidor" });
  }
  return res.status(status).json({ message: CLIENT_ERROR_MESSAGES[status] ?? "No se pudo procesar la solicitud" });
}
