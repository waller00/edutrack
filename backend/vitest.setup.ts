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