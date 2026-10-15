import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";

/**
 * Memoria que dura un pedido HTTP.
 *
 * Un mismo pedido preguntaba varias veces lo mismo a la base: `requirePermission` más los
 * alcances que calcula cada ruta (la libreta pide read, grade y plan) eran una consulta cada uno.
 * Con esto se resuelven una vez. Fuera de un pedido (tareas programadas, tests con mini-apps) no
 * hay memoria y cada llamada consulta, como siempre.
 */
const storage = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

export function requestCacheMiddleware(_req: Request, _res: Response, next: NextFunction) {
  storage.run(new Map(), next);
}

export function memoizeInRequest<T>(key: string, load: () => Promise<T>): Promise<T> {
  const store = storage.getStore();
  if (!store) return load();
  const cached = store.get(key) as Promise<T> | undefined;
  if (cached) return cached;
  const pending = load().catch((error) => {
    // Un fallo no queda guardado: el próximo intento del mismo pedido vuelve a consultar.
    store.delete(key);
    throw error;
  });
  store.set(key, pending);
  return pending;
}
