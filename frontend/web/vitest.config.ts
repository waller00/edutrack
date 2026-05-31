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
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/test/**',
        // Páginas y paneles admin: UI densa; cubiertos por e2e y pruebas manuales.
        'src/app/admin/**',
        'src/components/admin/**',
        // Web push y tipos de suplencias: integración navegador / solo tipos.
        'src/lib/notifications/**',
        'src/lib/substitutions/**',
        'src/lib/medical-leaves/certificate-client.ts',
        // Marcación en vivo del día: depende de /events y /attendance en runtime.
        'src/components/personal/MyAttendanceMarkingPanel.tsx',
      ],
      thresholds: {
        lines: 45,
        statements: 45,
        functions: 40,
        branches: 35,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
