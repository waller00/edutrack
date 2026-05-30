/**
 * Usuarios docentes (TEACHER) + TeacherProfile. Idempotente.
 *
 *   npx tsx prisma/seed-teachers.ts
 */
import 'dotenv/config'
import { prisma } from '../src/db/prisma.js'
import { ensureBuiltinOrgRoles } from '../src/identity/org-role-seed.js'
import {
  TEACHER_INITIAL_PASSWORD,
  TEACHERS_LICEO,
  teacherDisplayName,
} from './data/teachers-liceo.js'

function buildValidCi(baseNumber: number) {
  const base7 = String(Math.abs(baseNumber) % 9_999_999).padStart(7, '0')
  const weights = [2, 9, 8, 7, 6, 3, 4]
  const sum = base7.split('').reduce((acc, digit, index) => acc + Number(digit) * weights[index], 0)
  const checkDigit = (10 - (sum % 10)) % 10
  return `${base7}${checkDigit}`
}

export async function seedTeachers() {
  await ensureBuiltinOrgRoles()
  const teacherRole = await prisma.orgRole.findUnique({ where: { code: 'TEACHER' } })
  if (!teacherRole) throw new Error('Falta OrgRole TEACHER')

  const now = new Date()
  let created = 0
  let updated = 0

  for (let i = 0; i < TEACHERS_LICEO.length; i++) {
    const t = TEACHERS_LICEO[i]
    const displayName = teacherDisplayName(t)
    const existing = await prisma.user.findFirst({
      where: { OR: [{ username: t.username }, { email: t.email }] },
      select: { id: true, username: true, teacherProfile: { select: { id: true } } },
    })

    const userData = {
      email: t.email,
      username: t.username,
      firstName: t.firstName,
      lastName: t.lastName,
      name: displayName,
      roleId: teacherRole.id,
      emailVerifiedAt: now,
      isApproved: true,
      approvedAt: now,
      isActive: true,
      failedLoginAttempts: 0,
      lockUntil: null,
      nationalId: buildValidCi(2_000_000 + i),
      phone: `+59899${String(100000 + i).slice(-6)}`,
    }

    let userId: string
    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: userData,
      })
      userId = existing.id
      updated += 1
    } else {
      const user = await prisma.user.create({ data: userData })
      userId = user.id
      created += 1
    }

    await prisma.teacherProfile.upsert({
      where: { userId },
      create: {
        userId,
        displayName,
        isActive: true,
        notes: 'Carga inicial dataset liceo',
      },
      update: {
        displayName,
        isActive: true,
      },
    })
  }

  console.log(
    `[seed:teachers] ${TEACHERS_LICEO.length} docentes — creados: ${created}, actualizados: ${updated}. Clave: ${TEACHER_INITIAL_PASSWORD}`,
  )
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL no está definida')
  await seedTeachers()
}

const isDirectRun = (process.argv[1] ?? '').includes('seed-teachers')
if (isDirectRun) {
  main()
    .catch((e) => {
      console.error(e)
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
