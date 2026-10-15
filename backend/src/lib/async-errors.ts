import express from "express";
import type { NextFunction, Request, Response } from "express";

/**
 * Express 4 no espera las promesas de los handlers: si uno `async` rechaza fuera de un try/catch,
 * el error no llega a ningún manejador. Con Sentry activo el pedido queda colgado hasta el timeout
 * del proxy; sin Sentry, Node 20 baja el proceso entero. Había decenas de rutas así.
 *
 * Esto envuelve cada handler que se registra en una ruta (`r.get`, `app.post`, …) para que un
 * rechazo vaya a `next(err)`. Es lo que hace `express-async-errors`, sin la dependencia, y lo que
 * Express 5 hace solo. Tiene que instalarse antes de que se definan las rutas: por eso app.ts lo
 * importa primero.
 */

type Handler = (...args: any[]) => unknown;

const ROUTE_METHODS = ["all", "get", "post", "put", "patch", "delete", "options", "head"] as const;
const PATCHED = Symbol.for("edutrack.asyncErrorForwarding");

function forwardRejection<T>(result: T, next: NextFunction): T {
  if (result && typeof (result as { then?: unknown }).then === "function") {
    (result as unknown as Promise<unknown>).then(undefined, next);
  }
  return result;
}

/** Envuelve conservando la aridad: Express reconoce un manejador de errores por sus 4 parámetros. */
export function withAsyncErrors(handler: unknown): unknown {
  if (typeof handler !== "function") return handler;
  const fn = handler as Handler;
  if (fn.length === 4) {
    return function asyncErrorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
      return forwardRejection(fn(err, req, res, next), next);
    };
  }
  return function asyncHandler(req: Request, res: Response, next: NextFunction) {
    return forwardRejection(fn(req, res, next), next);
  };
}

export function installAsyncErrorForwarding(): void {
  const routeProto = (express as unknown as { Route: { prototype: Record<string | symbol, unknown> } }).Route
    .prototype;
  if (routeProto[PATCHED]) return;
  for (const method of ROUTE_METHODS) {
    const original = routeProto[method] as Handler;
    routeProto[method] = function (this: unknown, ...handlers: unknown[]) {
      return original.apply(this, handlers.flat(Infinity).map(withAsyncErrors));
    };
  }
  routeProto[PATCHED] = true;
}

installAsyncErrorForwarding();
