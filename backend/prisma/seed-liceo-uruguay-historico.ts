import { spawnSync } from 'node:child_process'

const result = spawnSync('node', ['prisma/seed-liceo-6months.mjs'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: {
    ...process.env,
    LICEO_HISTORY_MONTHS: process.env.LICEO_HISTORY_MONTHS ?? '18',
  },
})

if (result.status !== 0 && result.status !== null) {
  process.exit(result.status)
}
