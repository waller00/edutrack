/**
 * Borra datos anteriores y recarga seed principal. Docker/local: delega en seed-clean.ts.
 */
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx'

if (!existsSync(join(root, 'src', 'db', 'prisma.js')) && !existsSync(join(root, 'src', 'db', 'prisma.ts'))) {
  console.error('[seed:clean] No se encontró el proyecto backend.')
  process.exit(1)
}

const r = spawnSync(cmd, ['tsx', 'prisma/seed-clean.ts'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: process.env,
})
process.exit(r.status ?? 1)
