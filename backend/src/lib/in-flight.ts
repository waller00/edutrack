/**
 * Cálculos en curso compartidos entre pedidos.
 *
 * Asistencia del personal pide la tabla y el resumen a la vez, con los mismos filtros, y los dos
 * necesitan las mismas ausencias calculadas: el segundo pedido espera el cálculo que ya está en
 * curso en vez de repetirlo. No es un caché: la entrada se borra al terminar (bien o mal), así que
 * el próximo pedido siempre calcula de nuevo y nunca ve un resultado viejo.
 */
const inFlight = new Map<string, Promise<unknown>>();

export function shareInFlight<T>(key: string, load: () => Promise<T>): Promise<T> {
  const pending = inFlight.get(key) as Promise<T> | undefined;
  if (pending) return pending;
  const created = load().finally(() => inFlight.delete(key));
  inFlight.set(key, created);
  return created;
}
