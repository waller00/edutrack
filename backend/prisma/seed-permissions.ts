/**
 * Solo matriz de permisos (idempotente). El seed principal ya la incluye.
 */
import 'dotenv/config'
import { prisma } from '../src/db/prisma.js'
import { ensureBuiltinOrgRoles } from '../src/identity/org-role-seed.js'
import { upsertCanonicalProfilePermissions } from '../src/identity/profile-permissions-repository.js'

async function main() {
  await ensureBuiltinOrgRoles()
  await upsertCanonicalProfilePermissions(prisma)
  console.log('[seed-permissions] Matriz Permission / RolePermission actualizada.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
