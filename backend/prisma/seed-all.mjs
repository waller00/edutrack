/**
 * Entrada `npx prisma db seed` — catálogo DGES + bootstrap (sin datasets viejos).
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const distSeed = join(root, 'dist', 'prisma', 'seed.js')

function runTsxSeed() {
  const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const r = spawnSync(cmd, ['tsx', 'prisma/seed.ts'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  })
  if (r.status !== 0 && r.status != null) process.exit(r.status)
}

function runDistSeed() {
  const r = spawnSync('node', [distSeed], { cwd: root, stdio: 'inherit', env: process.env })
  if (r.status !== 0 && r.status != null) process.exit(r.status)
}

if (existsSync(distSeed)) {
  runDistSeed()
} else {
  runTsxSeed()
}
