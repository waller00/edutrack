/**
 * Ejecutado tras `prisma/seed.js` cuando usás `npm run seed`.
 * Idempotente: alinea tabla Permission + RolePermission con los defaults del código.
 */
import { PrismaClient } from '@prisma/client'
import { upsertCanonicalProfilePermissions } from '../src/profile-permissions-repository.js'

const prisma = new PrismaClient()

async function main() {
  await upsertCanonicalProfilePermissions(prisma)
  console.log('[seed-permissions] Matriz Permission / RolePermission actualizada.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
