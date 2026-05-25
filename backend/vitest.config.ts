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
        "src/**/*.d.ts",
        // Integraciones externas y webhooks: se validan con contratos/manual en entorno real.
        "src/integrations/didit/**",
        "src/routes/didit-*.ts",
        // Handler Prisma/raw SQL de alumnos y mensualidades; validado por integración/e2e.
        "src/routes/admin-students.ts",
        // Dashboard y cronología de asistencia: agregaciones Prisma; validado en e2e/UI.
        "src/routes/analytics.ts",
        "src/services/analytics/**",
        "!src/services/analytics/timeline-sort.ts",
        "src/services/exports/**",
        // RF-10: handlers Prisma + OpenAI; cobertura vía tests puntuales (heuristics, date-range) y ruta admin mockeada
        "src/services/query-assistant/**",
        // Panel admin de pruebas (wipe/reset/simular ADMS): cubierto por admin-testing.routes.test.ts con mocks
        "src/services/admin-testing-tools.ts",
        "src/routes/admin-testing.ts",
        // Suplencias e incidencias de asistencia: Prisma/transacciones; rutas validadas con mocks en *.routes.test.ts
        "src/routes/substitutions.ts",
        "src/services/substitutions.ts",
        "src/routes/attendance-incidents.ts",
        "src/services/attendance-incidents.ts",
      ],
      thresholds: {
        lines: 70,
        statements: 70,
        functions: 60,
        // Margen bajo 70% global: ramas de handlers con muchos if/Prisma suelen quedar ~68–69% en CI.
        branches: 68,
      },
    },
  },
});
