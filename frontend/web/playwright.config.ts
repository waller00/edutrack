import { defineConfig, devices } from '@playwright/test'

const frontendPort = 3000
const backendPort = 4000
const frontendUrl = `http://127.0.0.1:${frontendPort}`
const backendUrl = `http://127.0.0.1:${backendPort}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: frontendUrl,
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'npm run dev:ci',
      cwd: '../../backend',
      url: `${backendUrl}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        PORT: String(backendPort),
        FRONTEND_URL: frontendUrl,
      },
    },
    {
      command: `npm run dev -- --hostname 127.0.0.1 --port ${frontendPort}`,
      cwd: '.',
      url: frontendUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        NEXT_PUBLIC_API_URL: backendUrl,
      },
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
