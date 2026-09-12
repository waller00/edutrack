import { vi } from "vitest";

/** Evita que tests importen server.ts abran el puerto ADMS 8081 en el runner. */
process.env.ZKTECO_ICLOCK_PORT = "0";

/**
 * Silenciamos console.error y console.warn durante los tests.
 * Esto evita que los errores "esperados" (como fallos de SMTP o DB simulados)
 * ensucien el stderr y hagan fallar el pipeline de GitHub Actions.
 */
vi.spyOn(console, 'error').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
/**
 * Devuelve el reloj real al terminar cada archivo.
 *
 * `vitest.config.ts` corre con `singleFork` y `fileParallelism: false`, o sea **todos los archivos
 * en un mismo proceso y en fila**. Un `vi.setSystemTime()` sin restaurar no se queda en su archivo:
 * se lo come el siguiente. Pasó de verdad — los tests de asistencia de personal empezaron a fallar
 * al cambiar el orden, porque heredaban una fecha fijada por los de la libreta y sus "eventos
 * vencidos" dejaban de estar vencidos.
 */
afterAll(() => {
  vi.useRealTimers();
});
