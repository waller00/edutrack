/**
 * Borra datos anteriores y recarga seed principal.
 * En producción usa dist/prisma/seed-clean.js; en desarrollo usa tsx.
 */
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const distSeed = join(root, 'dist', 'prisma', 'seed-clean.js')
const tsSeed = join(root, 'prisma', 'seed-clean.ts')

function finish(result) {
  process.exit(typeof result.status === 'number' ? result.status : 1)
}

if (existsSync(distSeed)) {
  finish(spawnSync('node', [distSeed], { cwd: root, stdio: 'inherit', env: process.env }))
} else if (existsSync(tsSeed)) {
  finish(spawnSync(cmd, ['tsx', 'prisma/seed-clean.ts'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  }))
} else {
  console.error('[seed:clean] No se encontró dist/prisma/seed-clean.js ni prisma/seed-clean.ts.')
  process.exit(1)
}
