/**
 * Seed principal EduTrack (catálogo académico DGES + bootstrap admin).
 *
 *   npx tsx prisma/seed.ts
 *   npm run seed
 */
import 'dotenv/config'
import { prisma } from '../src/db/prisma.js'
import { seedAcademicCatalog } from './seed-academic-catalog.js'
import { runBootstrap } from './seed-bootstrap.js'
import { seedTeachers } from './seed-teachers.js'

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL no está definida')

  console.log('[seed] Bootstrap (roles, permisos, admin)…')
  await runBootstrap()

  console.log('[seed] Catálogo académico DGES…')
  await seedAcademicCatalog()

  console.log('[seed] Docentes (usuarios TEACHER + perfil)…')
  await seedTeachers()

  console.log('')
  console.log('✅ Seed completado.')
  console.log('   Admin: admin / admin123 (o CLEAN_ADMIN_* en env)')
  console.log('   Docentes: *@liceo.test / docente123')
  console.log('   Ciclo activo: 2026 — oferta: 7·8·9 EBI, 1 EMS, 3 EMS (2 EMS en catálogo, no ofertado)')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
