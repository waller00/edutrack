import { prisma } from '../src/prisma.js'
import { ensureBuiltinOrgRoles } from '../src/org-role-seed.js'

async function main() {
  await ensureBuiltinOrgRoles()
  console.log('[seed-org-roles] Roles builtin OK (ADMIN, STAFF, TEACHER).')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
