import { vi } from 'vitest';

/**
 * Silenciamos console.error y console.warn durante los tests.
 * Esto evita que los errores "esperados" (como fallos de SMTP o DB simulados)
 * ensucien el stderr y hagan fallar el pipeline de GitHub Actions.
 */
vi.spyOn(console, 'error').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});