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
        // Bootstrap / wiring / observabilidad: no es lógica unit-testeable.
        "src/server.ts",
        "src/app.ts",
        "src/instrument.ts",
        // Integración Moodle (REST + outbox + reconciliación): validada en entorno real / e2e.
        "src/integrations/moodle/**",
        "src/services/moodle.ts",
        "src/routes/exports.ts",
        "src/middlewares/rate-limit.ts",
        // Catálogo académico (cursos/materias/orientaciones): Prisma CRUD + transacciones,
        // validado por courses-subjects.routes.test.ts e integración; mismo criterio que admin-students.
        "src/routes/courses.ts",
        // CRUD admin de ciclos lectivos: Prisma puro, mismo criterio que admin-students.
        "src/routes/admin-school-years.ts",
        // Token de registro SSO en Redis (BFF): integración, mismo criterio que session-store.
        "src/auth/sso-registration.ts",
        // Integraciones externas y webhooks: se validan con contratos/manual en entorno real.
        "src/integrations/didit/**",
        "src/routes/didit-*.ts",
        // Autenticación Keycloak/BFF (OIDC + Admin API + Redis): integración validada
        // end-to-end contra Keycloak/Redis reales, no por unit tests.
        "src/auth/keycloak.ts",
        "src/auth/keycloak-provisioning.ts",
        "src/auth/session-store.ts",
        "src/routes/auth-keycloak.ts",
        "src/db/redis.ts",
        // Helpers usados solo por la suite de tests.
        "src/test-utils/**",
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
        // Reconciliación automática de asistencias por licencia (Prisma cross-entity):
        // mismo criterio que attendance-incidents, validado por integración/e2e.
        "src/services/medicalLeaveReconciliation.ts",
        // Capa de integración de hardware biométrico (protocolo ZKTeco ADMS, ingesta de
        // huellas, vinculación de dispositivos): se valida con dispositivo real (e2e) y los
        // *.routes.test.ts; mismo criterio que integrations/zkteco.
        "src/services/biometric-ingest-core.ts",
        "src/services/biometric-link.ts",
        "src/routes/biometric-link.ts",
        "src/routes/biometric-adms.ts",
        "src/routes/zkteco-iclock.ts",
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
