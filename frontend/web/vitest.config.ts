import { defineConfig } from 'vitest/config'
import path from 'node:path'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    testTimeout: 15_000,
    hookTimeout: 15_000,
    /** Menos flakes en CI cuando muchos tests comparten jsdom. */
    fileParallelism: false,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    exclude: ['e2e/**', 'playwright.config.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      // La cobertura unitaria mide la capa de LÓGICA pura (src/lib). La capa de UI
      // (app/, components/, contexts/) se valida con Playwright e2e y pruebas manuales;
      // mismo recorte declarado en sonar.coverage.exclusions.
      include: ['src/lib/**/*.ts'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/test/**',
        // Integración navegador / solo tipos (no unit-testeable).
        'src/lib/notifications/**',
        'src/lib/substitutions/**',
        'src/lib/attendance/incidents-types.ts',
      ],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 85,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
