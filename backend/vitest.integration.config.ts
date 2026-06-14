import { defineConfig } from "vitest/config";

/**
 * Suite de INTEGRACIÓN: corre contra un Postgres real (Testcontainers), no mocks.
 * Aislada de la suite unit (`vitest.config.ts`): archivos `*.itest.ts`, sin cobertura,
 * un solo fork que comparte la base levantada en `vitest.integration.global.ts`.
 *
 * Ejecutar con: `npm run test:integration` (requiere Docker).
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    pool: "forks",
    fileParallelism: false,
    poolOptions: { forks: { singleFork: true } },
    include: ["src/**/*.itest.ts"],
    globalSetup: ["./vitest.integration.global.ts"],
    hookTimeout: 180000,
    testTimeout: 60000,
    env: {
      JWT_SECRET: "vitest-jwt-secret-key-min-32-characters-x",
      NODE_ENV: "test",
    },
  },
});
