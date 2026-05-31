import 'dotenv/config'
import { prisma } from '../src/db/prisma.js'
import { ensureBuiltinOrgRoles } from '../src/identity/org-role-seed.js'

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
