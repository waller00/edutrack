/**
 * Entrada única para `npx prisma db seed` compatible con imagen Docker (solo dist/) y desarrollo local.
 *
 * Docker: Dockerfile copia `dist/` y `prisma/`; no hay `tsx` ni `src/` en runtime.
 * Local sin build: ejecuta la cadena con `tsx` como antes.
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const distPrisma = join(root, 'dist', 'prisma.js')

async function seedFromDist() {
  const { prisma } = await import('../dist/prisma.js')
  const { ensureBuiltinOrgRoles } = await import('../dist/org-role-seed.js')
  await ensureBuiltinOrgRoles()
  console.log('[seed] OrgRole builtin OK.')

  const nodeSeed = spawnSync('node', [join(__dirname, 'seed.js')], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  })
  if (nodeSeed.status !== 0 && nodeSeed.status != null) {
    process.exit(nodeSeed.status)
  }

  const { upsertCanonicalProfilePermissions } = await import('../dist/profile-permissions-repository.js')
  await upsertCanonicalProfilePermissions(prisma)
  console.log('[seed] Permission / RolePermission matrix OK.')

  await prisma.$disconnect()
}

function seedWithTsx() {
  const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const shell = process.platform === 'win32'
  const full = spawnSync(cmd, ['tsx', 'prisma/seed-org-roles.ts'], { cwd: root, stdio: 'inherit', shell })
  if (full.status !== 0 && full.status != null) process.exit(full.status)

  const j = spawnSync('node', [join(__dirname, 'seed.js')], { cwd: root, stdio: 'inherit', env: process.env })
  if (j.status !== 0 && j.status != null) process.exit(j.status)

  const p = spawnSync(cmd, ['tsx', 'prisma/seed-permissions.ts'], { cwd: root, stdio: 'inherit', shell })
  if (p.status !== 0 && p.status != null) process.exit(p.status)
}

if (existsSync(distPrisma)) {
  seedFromDist().catch((e) => {
    console.error(e)
    process.exit(1)
  })
} else {
  seedWithTsx()
}
