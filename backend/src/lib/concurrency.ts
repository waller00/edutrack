/**
 * Pool de concurrencia acotado.
 *
 * Nace del puente de notas: al sincronizar contra un servicio externo (Moodle) una planilla de
 * decenas de alumnos, ni serializar (lento) ni disparar todo junto (satura el WS) sirven. Este
 * helper mantiene N tareas en vuelo y **preserva el orden** del array de entrada en la salida,
 * así el resultado sigue siendo correlacionable con el ítem que lo produjo.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  };
  // `items.length || 1` evita `Promise.all([])` con un array vacío de workers.
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, worker));
  return results;
}
