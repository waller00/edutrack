import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    /** Evita workers que mueran a mitad del run en algunos entornos Windows/Node. */
    pool: "forks",
    fileParallelism: false,
    include: ["src/**/*.test.ts", "prisma/**/*.test.ts"],
    // --- LÍNEA AGREGADA PARA EL CI ---
    setupFiles: ["./vitest.setup.ts"],
    // ---------------------------------
    env: {
      JWT_SECRET: "vitest-jwt-secret-key-min-32-characters-x",
      NODE_ENV: "test",
    },
    poolOptions: {
      forks: { singleFork: true },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.itest.ts",
        "src/**/*.d.ts",
        // Arranque y cableado: no es lógica unit-testeable.
        "src/server.ts",
        "src/app.ts",
        "src/instrument.ts",
        // Clientes de base, Redis, Keycloak y Moodle (HTTP/IO), y helpers que sólo usa la suite.
        "src/db/**",
        "src/test-utils/**",
        "src/auth/keycloak.ts",
        "src/auth/session-store.ts",
        "src/auth/sso-registration.ts",
        "src/integrations/moodle/client.ts",
        "src/integrations/moodle/enrolment-map.ts",
        "src/integrations/moodle/object-map.ts",
        // Herramientas del entorno de pruebas.
        "src/services/admin-testing-tools.ts",
        "src/routes/admin-testing.ts",
        // DEUDA: módulos con tests insuficientes (menos de ~80% de líneas). Sacar de esta lista a
        // medida que se cubran; el resto del backend ya se mide entero (Moodle, analytics, licencias).
        "src/routes/admin-school-years.ts",
        "src/routes/courses.ts",
        "src/routes/admin-students.ts",
        "src/routes/analytics.ts",
        "src/routes/substitutions.ts",
        "src/services/substitutions.ts",
        "src/routes/attendance-incidents.ts",
        "src/services/attendance-incidents.ts",
        "src/services/analytics/exports/monthlySummaryPdf.ts",
        "src/services/biometric-ingest-core.ts",
        "src/services/biometric-link.ts",
        "src/routes/biometric-link.ts",
      ],
      thresholds: {
        // La cobertura mide la capa de dominio/lógica (la integración/IO se excluye arriba).
        // Umbrales con margen sobre el estado actual (~89% líneas) para evitar regresiones.
        lines: 85,
        statements: 85,
        functions: 85,
        branches: 70,
      },
    },
  },
});
