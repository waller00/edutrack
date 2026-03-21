import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
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
      // dni-processor: ~2.3k líneas OCR/sharp/tesseract; excluido de métrica
      exclude: [
        "src/**/*.test.ts", 
        "src/routes/dni-processor.ts",
        "src/services/analytics/**", // Excluimos esto
        "src/services/exports/**"    // Y esto también
      ],
      thresholds: {
        lines: 70,
        statements: 70,
        functions: 60,
        branches: 75,
      },
    },
  },
});