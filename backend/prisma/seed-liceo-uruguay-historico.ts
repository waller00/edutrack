/**
 * Seed histórico realista — liceo privado uruguayo (2019 → 2026-05-14).
 *
 * Limitación del esquema: `Attendance` y `MedicalLeave` referencian `User` (docentes/staff/admin),
 * no `Student`. Para alumnos se modelan trayectorias, cursos y cuotas; las asistencias/licencias
 * operativas se generan para docentes y staff, que son los actores soportados por el esquema actual.
 *
 * ADVERTENCIA: BORRA datos operativos (asistencias, licencias, eventos, estudiantes,
 * asignaturas, cursos, ciclos lectivos) y usuarios NO admin. Preserva un usuario admin
 * (username `admin` por defecto) y re-hashea contraseña si pedís.
 *
 *   cd backend
 *   npx tsx prisma/seed-liceo-uruguay-historico.ts
 *
 * Variables:
 *   SEED_LICEO_HISTORICO_CONFIRM=1     (obligatorio para ejecutar)
 *   ADMIN_USERNAME (default admin)
 *   LICEO_HISTORICO_RESET_ADMIN_PW=1  (re-hashea admin a LICEO_ADMIN_PASSWORD)
 *   LICEO_ADMIN_PASSWORD (default admin123)
 *   LICEO_STAFF_PASSWORD / LICEO_TEACHER_PASSWORD (default: LiceoSeed2026!)
 *
 * Si no hay usuario con ADMIN_USERNAME, se crea uno (contraseña LICEO_ADMIN_PASSWORD / admin123).
 */
import 'dotenv/config'
import { PrismaClient, type Prisma } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import argon2 from 'argon2'
import { ensureBuiltinOrgRoles } from '../src/org-role-seed.js'
import { upsertCanonicalProfilePermissions } from '../src/profile-permissions-repository.js'
import { reconcileAttendancesForMedicalLeave } from '../src/services/medicalLeaveReconciliation.js'

const prisma = new PrismaClient()

const EMAIL_DOMAIN = 'liceo-seed.uy'
const DATA_END_UTC = new Date(Date.UTC(2026, 4, 14, 23, 59, 59, 999)) // 14 may 2026 inclusive

const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || 'admin').toLowerCase()
const ADMIN_PW = process.env.LICEO_ADMIN_PASSWORD || 'admin123'
const STAFF_PW = process.env.LICEO_STAFF_PASSWORD || process.env.LICEO_TEACHER_PASSWORD || 'LiceoSeed2026!'
const TEACHER_PW = process.env.LICEO_TEACHER_PASSWORD || 'LiceoSeed2026!'

/** Días de semana Prisma: 0=Dom … 6=Sáb (igual que seed liceo 6m). */
const WEEKDAYS_LV = [1, 2, 3, 4, 5]

const SUBJECTS_EBI7 = [
  'Matemática',
  'Lengua Española',
  'Inglés',
  'Historia',
  'Geografía',
  'Ciencias del Ambiente',
  'Ciencias de la Computación',
  'Arte',
  'Educación Física',
  'Talleres / Espacio curricular',
]
const SUBJECTS_EBI8 = [
  'Matemática',
  'Lengua Española',
  'Inglés',
  'Historia',
  'Ciencias Físico-Químicas',
  'Ciencias del Ambiente',
  'Ciencias de la Computación',
  'Educación Ciudadana',
  'Arte',
  'Educación Física',
]
const SUBJECTS_EBI9 = [
  'Matemática',
  'Comunicación y Sociedad',
  'Inglés',
  'Historia',
  'Geografía',
  'Física',
  'Química',
  'Biología',
  'Ciencias de la Computación',
  'Literatura',
  'Educación Física',
  'Formación para la Ciudadanía',
]

const EMS1_COMMON = [
  'Literatura',
  'Inglés',
  'Filosofía',
  'Educación Física',
  'Metodología de la Investigación',
  'Ciencias de la Computación',
  'Matemática',
  'Historia',
]
const EMS1_CT = ['Matemática avanzada', 'Física', 'Química', 'Astronomía', 'Comunicación Visual']
const EMS1_VIDA = ['Biología', 'Química', 'Física', 'Matemática']
const EMS1_SH = ['Historia', 'Sociología', 'Derecho', 'Economía']
const EMS1_ARTE = ['Música', 'Teatro', 'Diseño', 'Comunicación visual']

const EMS2_CT = ['Matemática CT', 'Física', 'Química', 'Ciencias de la Computación', 'Filosofía']
const EMS2_VIDA = ['Biología', 'Química', 'Geografía', 'Física']
const EMS2_SH = ['Sociología', 'Derecho', 'Historia', 'Economía', 'Filosofía']
const EMS2_ARTE = ['Producción artística', 'Comunicación visual', 'Música', 'Teatro']

const EMS3_CT = [
  'Matemática CT 1',
  'Matemática CT 2',
  'Física',
  'Química',
  'Comunicación visual y diseño',
  'Ciencias de la Computación',
]
const EMS3_VIDA = ['Biología', 'Química', 'Física', 'Geografía']
const EMS3_SH = ['Derecho', 'Sociología', 'Historia', 'Economía', 'Filosofía']
const EMS3_ARTE = ['Artes visuales', 'Música', 'Expresión corporal', 'Teatro', 'Producción audiovisual']

const TEACHER_POOL: { firstName: string; lastName: string; track: 'MAT' | 'HUM' | 'CIE' | 'IDM' | 'ART' | 'EDF' }[] = [
  { firstName: 'María Elena', lastName: 'Acosta', track: 'MAT' },
  { firstName: 'Roberto', lastName: 'Benítez', track: 'MAT' },
  { firstName: 'Silvia', lastName: 'Cabrera', track: 'MAT' },
  { firstName: 'Daniel', lastName: 'Domínguez', track: 'MAT' },
  { firstName: 'Patricia', lastName: 'Etcheverry', track: 'HUM' },
  { firstName: 'Jorge', lastName: 'Fernández', track: 'HUM' },
  { firstName: 'Lucía', lastName: 'García', track: 'HUM' },
  { firstName: 'Mario', lastName: 'Hernández', track: 'HUM' },
  { firstName: 'Andrea', lastName: 'Iglesias', track: 'CIE' },
  { firstName: 'Felipe', lastName: 'Jorge', track: 'CIE' },
  { firstName: 'Carla', lastName: 'Kehoe', track: 'CIE' },
  { firstName: 'Gonzalo', lastName: 'Larrañaga', track: 'CIE' },
  { firstName: 'Natalia', lastName: 'Morales', track: 'IDM' },
  { firstName: 'Pablo', lastName: 'Nuñez', track: 'IDM' },
  { firstName: 'Rosa', lastName: 'Olivera', track: 'IDM' },
  { firstName: 'Sergio', lastName: 'Perdomo', track: 'ART' },
  { firstName: 'Valeria', lastName: 'Quintela', track: 'ART' },
  { firstName: 'Walter', lastName: 'Ramos', track: 'EDF' },
  { firstName: 'Ximena', lastName: 'Sánchez', track: 'EDF' },
  { firstName: 'Yamila', lastName: 'Torres', track: 'MAT' },
  { firstName: 'Zulema', lastName: 'Vázquez', track: 'HUM' },
  { firstName: 'Alejandro', lastName: 'Wolff', track: 'CIE' },
]

const STAFF_NAMES = [
  { firstName: 'Graciela', lastName: 'Méndez' },
  { firstName: 'Héctor', lastName: 'Riveiro' },
]

const STUDENT_FIRST = [
  'Agustín',
  'Bianca',
  'Camilo',
  'Delfina',
  'Esteban',
  'Fátima',
  'Gabriel',
  'Helena',
  'Ignacio',
  'Julieta',
  'Kevin',
  'Lourdes',
  'Mateo',
  'Noelia',
  'Octavio',
  'Paula',
  'Ramiro',
  'Sol',
  'Tomás',
  'Úrsula',
  'Violeta',
  'Williams',
  'Xenia',
  'Yago',
  'Zoe',
]
const STUDENT_LAST = [
  'Alonso',
  'Bentancur',
  'Costa',
  'Díaz',
  'Erlich',
  'Fagúndez',
  'González',
  'Herrera',
  'Ithuralde',
  'Juri',
  'Katz',
  'López',
  'Machado',
  'Núñez',
  'Olivera',
  'Pérez',
  'Quevedo',
  'Rossi',
  'Silva',
  'Techera',
  'Ulloa',
  'Varela',
  'Wainstein',
  'Ximénez',
  'Yanes',
]

function buildValidCi(baseNumber: number) {
  const base7 = String(Math.abs(baseNumber) % 9_999_999).padStart(7, '0')
  const weights = [2, 9, 8, 7, 6, 3, 4]
  const sum = base7.split('').reduce((acc, digit, i) => acc + Number(digit) * weights[i]!, 0)
  const checkDigit = (10 - (sum % 10)) % 10
  return `${base7}${checkDigit}`
}

function utcMidnight(y: number, m0: number, d: number) {
  return new Date(Date.UTC(y, m0, d, 0, 0, 0, 0))
}

function startOfUtcDay(d: Date) {
  return utcMidnight(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

function addUtcDays(d: Date, delta: number) {
  const o = new Date(d.getTime())
  o.setUTCDate(o.getUTCDate() + delta)
  return o
}

function utcYmd(d: Date) {
  return d.toISOString().slice(0, 10)
}

function utcWithTime(day: Date, h: number, m: number) {
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m, 0, 0))
}

function rngFactory(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

function enumerateOccurrenceDays(evStart: Date, recurrenceEnd: Date, daysOfWeek: number[]): Date[] {
  const out: Date[] = []
  let cursor = startOfUtcDay(evStart)
  const cap = startOfUtcDay(recurrenceEnd)
  while (cursor <= cap) {
    const dow = cursor.getUTCDay()
    if (!daysOfWeek.length) {
      if (utcYmd(cursor) === utcYmd(evStart)) out.push(new Date(cursor.getTime()))
    } else if (daysOfWeek.includes(dow)) {
      out.push(new Date(cursor.getTime()))
    }
    cursor = addUtcDays(cursor, 1)
  }
  return out
}

function pickAttendance(rng: () => number, justifiedByLeave: boolean) {
  if (justifiedByLeave) return { inS: 'ABSENT_JUSTIFIED' as const, outS: null as const, delayMin: 0 }
  const r = rng()
  if (r < 0.008) return { inS: 'ABSENT_NOT_JUSTIFIED' as const, outS: null, delayMin: 0 }
  if (r < 0.055) return { inS: 'LATE' as const, outS: 'EXIT' as const, delayMin: 6 + Math.floor(rng() * 11) }
  return { inS: 'PRESENT' as const, outS: rng() > 0.015 ? ('EXIT' as const) : ('EARLY_EXIT' as const), delayMin: -2 }
}

async function flushAttendances(rows: Prisma.AttendanceCreateManyInput[]) {
  const chunk = 400
  for (let i = 0; i < rows.length; i += chunk) {
    await prisma.attendance.createMany({ data: rows.slice(i, i + chunk) })
  }
}

async function flushAttendanceIncidents(rows: Prisma.AttendanceIncidentCreateManyInput[]) {
  const chunk = 400
  for (let i = 0; i < rows.length; i += chunk) {
    await prisma.attendanceIncident.createMany({ data: rows.slice(i, i + chunk) })
  }
}

type AdminRow = {
  id: string
  email: string
  username: string | null
  orgRole: { code: string }
}

async function findAdmin(): Promise<AdminRow | null> {
  return prisma.user.findFirst({
    where: { username: { equals: ADMIN_USERNAME, mode: 'insensitive' } },
    select: { id: true, email: true, username: true, orgRole: { select: { code: true } } },
  })
}

async function ensureAdminUser(): Promise<AdminRow> {
  const existing = await findAdmin()
  if (existing) return existing

  const adminRole = await prisma.orgRole.findFirst({ where: { code: 'ADMIN' } })
  if (!adminRole) throw new Error('No existe OrgRole ADMIN. Ejecutá ensureBuiltinOrgRoles (ya corre al inicio del seed).')

  const email = `${ADMIN_USERNAME.replace(/[^a-z0-9._-]/gi, 'x')}@${EMAIL_DOMAIN}`
  const now = new Date()
  const passwordHash = await argon2.hash(ADMIN_PW, { type: argon2.argon2id })
  const created = await prisma.user.create({
    data: {
      email,
      username: ADMIN_USERNAME,
      firstName: 'Admin',
      lastName: 'Sistema',
      name: 'Administrador',
      nationalId: buildValidCi(9_000_001),
      roleId: adminRole.id,
      passwordHash,
      emailVerifiedAt: now,
      isApproved: true,
      approvedAt: now,
      isActive: true,
    },
    select: { id: true, email: true, username: true, orgRole: { select: { code: true } } },
  })
  console.log(`[admin] creado usuario "${ADMIN_USERNAME}" (${created.email}) — contraseña: LICEO_ADMIN_PASSWORD o admin123`)
  return created
}

async function wipeExceptAdmin(adminId: string) {
  await prisma.attendanceIncident.deleteMany()
  await prisma.attendance.deleteMany()
  await prisma.medicalLeave.deleteMany()
  await prisma.event.updateMany({ data: { parentEventId: null } })
  await prisma.event.deleteMany()
  await prisma.$executeRaw`DELETE FROM "StudentTuitionMonth"`
  await prisma.studentTuitionYear.deleteMany()
  await prisma.student.deleteMany()
  await prisma.subject.deleteMany()
  await prisma.course.deleteMany()
  await prisma.schoolYear.deleteMany()
  await prisma.auditLog.deleteMany()
  await prisma.inAppNotification.deleteMany()
  await prisma.passwordReset.deleteMany()
  await prisma.emailVerification.deleteMany()
  await prisma.refreshToken.deleteMany()
  await prisma.webPushSubscription.deleteMany()
  await prisma.livenessSession.deleteMany()
  await prisma.biometricPunch.deleteMany()
  await prisma.biometricUserMapping.deleteMany()
  await prisma.user.deleteMany({ where: { id: { not: adminId } } })
}

function subjectsForCourseKind(kind: string): string[] {
  if (kind === 'EBI7') return SUBJECTS_EBI7
  if (kind === 'EBI8') return SUBJECTS_EBI8
  if (kind === 'EBI9') return SUBJECTS_EBI9
  if (kind === 'EMS1_CT') return [...EMS1_COMMON, ...EMS1_CT]
  if (kind === 'EMS1_SH') return [...EMS1_COMMON, ...EMS1_SH]
  if (kind === 'EMS1_VIDA') return [...EMS1_COMMON, ...EMS1_VIDA]
  if (kind === 'EMS1_ARTE') return [...EMS1_COMMON, ...EMS1_ARTE]
  if (kind === 'EMS2_CT') return EMS2_CT
  if (kind === 'EMS2_SH') return EMS2_SH
  if (kind === 'EMS2_VIDA') return EMS2_VIDA
  if (kind === 'EMS2_ARTE') return EMS2_ARTE
  if (kind === 'EMS3_CT') return EMS3_CT
  if (kind === 'EMS3_SH') return EMS3_SH
  if (kind === 'EMS3_VIDA') return EMS3_VIDA
  if (kind === 'EMS3_ARTE') return EMS3_ARTE
  return []
}

function yearOpenEms(year: number): { ct: boolean; sh: boolean; vida: boolean; arte: boolean } {
  if (year < 2021) return { ct: true, sh: true, vida: false, arte: false }
  if (year === 2021) return { ct: true, sh: true, vida: true, arte: false }
  if (year <= 2023) return { ct: true, sh: true, vida: false, arte: false }
  if (year === 2024) return { ct: true, sh: true, vida: false, arte: true }
  return { ct: true, sh: true, vida: false, arte: false }
}

function trackSubjects(track: string): Set<string> {
  const s = new Set<string>()
  const add = (arr: string[]) => arr.forEach((x) => s.add(x))
  if (track === 'MAT') {
    add(['Matemática', 'Matemática avanzada', 'Matemática CT', 'Matemática CT 1', 'Matemática CT 2', 'Metodología de la Investigación'])
  } else if (track === 'HUM') {
    add(['Historia', 'Geografía', 'Formación para la Ciudadanía', 'Educación Ciudadana', 'Comunicación y Sociedad', 'Literatura', 'Filosofía', 'Sociología', 'Derecho', 'Economía'])
  } else if (track === 'CIE') {
    add(['Física', 'Química', 'Biología', 'Ciencias Físico-Químicas', 'Ciencias del Ambiente', 'Astronomía', 'Geografía'])
  } else if (track === 'IDM') {
    add(['Inglés', 'Lengua Española', 'Literatura', 'Comunicación y Sociedad', 'Ciencias de la Computación', 'Comunicación Visual', 'Comunicación visual', 'Comunicación visual y diseño'])
  } else if (track === 'ART') {
    add(['Arte', 'Música', 'Teatro', 'Diseño', 'Comunicación visual', 'Producción artística', 'Artes visuales', 'Producción audiovisual', 'Expresión corporal'])
  } else {
    add(['Educación Física', 'Talleres / Espacio curricular'])
  }
  return s
}

async function main() {
  if (process.env.SEED_LICEO_HISTORICO_CONFIRM !== '1') {
    console.error('Definí SEED_LICEO_HISTORICO_CONFIRM=1 para ejecutar (borra datos operativos).')
    process.exit(1)
  }

  console.log('='.repeat(72))
  console.log(`Liceo privado UY · 2019 → ${utcYmd(DATA_END_UTC)}`)
  console.log('='.repeat(72))

  await ensureBuiltinOrgRoles()
  await upsertCanonicalProfilePermissions(prisma)

  const admin = await ensureAdminUser()

  console.log('[purge] Borrando datos operativos (excepto admin)...')
  await wipeExceptAdmin(admin.id)

  if (process.env.LICEO_HISTORICO_RESET_ADMIN_PW === '1') {
    await prisma.user.update({
      where: { id: admin.id },
      data: { passwordHash: await argon2.hash(ADMIN_PW, { type: argon2.argon2id }) },
    })
    console.log('[admin] password re-hasheada (LICEO_ADMIN_PASSWORD / default admin123)')
  }

  const teacherRole = await prisma.orgRole.findFirst({ where: { code: 'TEACHER' } })
  const staffRole = await prisma.orgRole.findFirst({ where: { code: 'STAFF' } })
  if (!teacherRole || !staffRole) throw new Error('Faltan roles TEACHER/STAFF')

  const now = new Date()
  const pwStaff = await argon2.hash(STAFF_PW, { type: argon2.argon2id })
  const pwTeacher = await argon2.hash(TEACHER_PW, { type: argon2.argon2id })

  const staffUsers = []
  for (let i = 0; i < STAFF_NAMES.length; i++) {
    const sn = STAFF_NAMES[i]!
    const slug = `${sn.firstName}.${sn.lastName}`
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[^a-z.]+/g, '')
    staffUsers.push(
      await prisma.user.create({
        data: {
          email: `staff.${i + 1}.${slug}@${EMAIL_DOMAIN}`,
          username: slug.slice(0, 120),
          firstName: sn.firstName,
          lastName: sn.lastName,
          name: `${sn.firstName} ${sn.lastName}`,
          nationalId: buildValidCi(5_100_000 + i * 901),
          phone: `+598992${String(30000 + i).slice(-5)}`,
          roleId: staffRole.id,
          passwordHash: pwStaff,
          emailVerifiedAt: now,
          isApproved: true,
          approvedAt: now,
          isActive: true,
        },
      }),
    )
  }

  const teachers = []
  for (let i = 0; i < TEACHER_POOL.length; i++) {
    const t = TEACHER_POOL[i]!
    const slug = `${t.firstName}.${t.lastName}`
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[^a-z.]+/g, '')
    teachers.push(
      await prisma.user.create({
        data: {
          email: `doc.${String(i + 1).padStart(2, '0')}.${slug}@${EMAIL_DOMAIN}`,
          username: slug.slice(0, 120),
          firstName: t.firstName,
          lastName: t.lastName,
          name: `${t.firstName} ${t.lastName}`,
          nationalId: buildValidCi(6_200_000 + i * 701),
          phone: `+598991${String(40000 + i).slice(-5)}`,
          roleId: teacherRole.id,
          passwordHash: pwTeacher,
          emailVerifiedAt: now,
          isApproved: true,
          approvedAt: now,
          isActive: true,
        },
      }),
    )
  }

  /** Años lectivos 2019..2026 (code = año calendario institucional). */
  const schoolYears: { id: string; code: number; starts: Date; ends: Date; status: 'PLANNED' | 'ACTIVE' | 'CLOSED' }[] =
    []
  for (let y = 2019; y <= 2026; y++) {
    const starts = utcMidnight(y, 2, 4) // ~ marzo
    const ends = y === 2026 ? utcMidnight(y, 11, 15) : utcMidnight(y, 11, 15)
    const row = await prisma.schoolYear.create({
      data: {
        code: y,
        label: `Ciclo ${y}`,
        startsOn: starts,
        endsOn: ends,
        status: y < 2026 ? 'CLOSED' : 'ACTIVE',
      },
    })
    schoolYears.push({
      id: row.id,
      code: y,
      starts: starts,
      ends: ends,
      status: row.status as 'PLANNED' | 'ACTIVE' | 'CLOSED',
    })
  }

  type CourseRow = { id: string; schoolYearId: string; code: string; name: string; kind: string; isActive: boolean }
  const allCourses: CourseRow[] = []
  const subjectsByCourseId = new Map<string, { id: string; name: string }[]>()

  for (const sy of schoolYears) {
    const y = sy.code
    const ems = yearOpenEms(y)
    const templates: { code: string; name: string; kind: string; active: boolean }[] = [
      { code: `EBI7-${y}`, name: '7.º EBI', kind: 'EBI7', active: true },
      { code: `EBI8-${y}`, name: '8.º EBI', kind: 'EBI8', active: true },
      { code: `EBI9-${y}`, name: '9.º EBI', kind: 'EBI9', active: true },
      { code: `EMS1-CT-${y}`, name: '1.º EMS - Ciencias y Tecnología', kind: 'EMS1_CT', active: ems.ct },
      { code: `EMS1-SH-${y}`, name: '1.º EMS - Sociales y Humanidades', kind: 'EMS1_SH', active: ems.sh },
      { code: `EMS1-VIDA-${y}`, name: '1.º EMS - Ciencias de la Vida', kind: 'EMS1_VIDA', active: ems.vida },
      { code: `EMS1-ARTE-${y}`, name: '1.º EMS - Arte y Expresión', kind: 'EMS1_ARTE', active: ems.arte },
      { code: `EMS2-CT-${y}`, name: '2.º EMS - Ciencias y Tecnología', kind: 'EMS2_CT', active: y >= 2020 && ems.ct },
      { code: `EMS2-SH-${y}`, name: '2.º EMS - Sociales y Humanidades', kind: 'EMS2_SH', active: y >= 2020 && ems.sh },
      { code: `EMS2-VIDA-${y}`, name: '2.º EMS - Ciencias de la Vida', kind: 'EMS2_VIDA', active: false },
      { code: `EMS2-ARTE-${y}`, name: '2.º EMS - Arte y Expresión', kind: 'EMS2_ARTE', active: false },
      { code: `EMS3-CT-${y}`, name: '3.º EMS - Ciencias y Tecnología', kind: 'EMS3_CT', active: y >= 2021 && ems.ct },
      { code: `EMS3-SH-${y}`, name: '3.º EMS - Sociales y Humanidades', kind: 'EMS3_SH', active: y >= 2021 && ems.sh },
      { code: `EMS3-VIDA-${y}`, name: '3.º EMS - Ciencias de la Vida', kind: 'EMS3_VIDA', active: false },
      { code: `EMS3-ARTE-${y}`, name: '3.º EMS - Arte y Expresión', kind: 'EMS3_ARTE', active: false },
    ]

    for (const tpl of templates) {
      const c = await prisma.course.create({
        data: {
          name: tpl.name.slice(0, 200),
          code: tpl.code,
          description: `Curso seed ${tpl.kind}`,
          isActive: tpl.active,
          schoolYearId: sy.id,
        },
      })
      allCourses.push({ id: c.id, schoolYearId: sy.id, code: tpl.code, name: c.name, kind: tpl.kind, isActive: tpl.active })

      const names = subjectsForCourseKind(tpl.kind)
      const subRows: { id: string; name: string }[] = []
      let order = 0
      for (const nm of names) {
        const s = await prisma.subject.create({
          data: {
            courseId: c.id,
            name: nm,
            code: nm.slice(0, 8).toUpperCase().replace(/\s+/g, '_'),
            sortOrder: order++,
            isActive: true,
          },
        })
        subRows.push({ id: s.id, name: s.name })
      }
      subjectsByCourseId.set(c.id, subRows)
    }
  }

  type Trajectory = {
    doc: string
    fn: string
    ln: string
    entryYear: number
    mode: 'EBI7' | 'EMS1CT'
    /** Dos años en 9.º EBI antes de pasar a EMS. */
    repeatEbi9?: boolean
    /** Último año en que figura matriculado (luego abandono). */
    lastYear?: number
  }

  const trajectories: Trajectory[] = []
  for (let i = 0; i < 18; i++) {
    trajectories.push({
      doc: buildValidCi(1_010_000 + i * 11_017),
      fn: STUDENT_FIRST[i % STUDENT_FIRST.length]!,
      ln: STUDENT_LAST[(i * 2) % STUDENT_LAST.length]!,
      entryYear: 2019,
      mode: 'EBI7',
      ...(i === 4 ? { repeatEbi9: true } : {}),
      ...(i === 7 ? { lastYear: 2022 } : {}),
    })
  }
  for (let j = 0; j < 8; j++) {
    trajectories.push({
      doc: buildValidCi(2_020_000 + j * 13_019),
      fn: STUDENT_FIRST[(j + 5) % STUDENT_FIRST.length]!,
      ln: STUDENT_LAST[(j + 3) % STUDENT_LAST.length]!,
      entryYear: 2022,
      mode: 'EMS1CT',
    })
  }
  for (let j = 0; j < 7; j++) {
    trajectories.push({
      doc: buildValidCi(2_230_000 + j * 17_021),
      fn: STUDENT_FIRST[(j + 11) % STUDENT_FIRST.length]!,
      ln: STUDENT_LAST[(j + 9) % STUDENT_LAST.length]!,
      entryYear: 2023,
      mode: 'EMS1CT',
      ...(j === 3 ? { lastYear: 2024 } : {}),
    })
  }
  for (let j = 0; j < 11; j++) {
    trajectories.push({
      doc: buildValidCi(3_019_000 + j * 19_031),
      fn: STUDENT_FIRST[(j + 14) % STUDENT_FIRST.length]!,
      ln: STUDENT_LAST[(j + 13) % STUDENT_LAST.length]!,
      entryYear: 2021 + (j % 4),
      mode: 'EBI7',
      ...(j === 5 ? { repeatEbi9: true } : {}),
      ...(j === 8 ? { lastYear: 2025 } : {}),
    })
  }
  for (let entry = 2020; entry <= 2026; entry++) {
    for (let j = 0; j < 6; j++) {
      trajectories.push({
        doc: buildValidCi(3_700_000 + (entry - 2020) * 70_000 + j * 23_017),
        fn: STUDENT_FIRST[(entry + j * 2) % STUDENT_FIRST.length]!,
        ln: STUDENT_LAST[(entry + j * 3) % STUDENT_LAST.length]!,
        entryYear: entry,
        mode: 'EBI7',
        ...(entry === 2021 && j === 2 ? { repeatEbi9: true } : {}),
        ...(entry === 2022 && j === 4 ? { lastYear: 2024 } : {}),
      })
    }
  }
  for (let entry = 2024; entry <= 2026; entry++) {
    for (let j = 0; j < 5; j++) {
      trajectories.push({
        doc: buildValidCi(4_500_000 + (entry - 2024) * 90_000 + j * 29_003),
        fn: STUDENT_FIRST[(entry + j + 7) % STUDENT_FIRST.length]!,
        ln: STUDENT_LAST[(entry + j * 4 + 5) % STUDENT_LAST.length]!,
        entryYear: entry,
        mode: 'EMS1CT',
        ...(entry === 2024 && j === 1 ? { lastYear: 2025 } : {}),
      })
    }
  }

  function courseCodeForTrajectory(y: number, t: Trajectory): string | null {
    if (t.lastYear && y > t.lastYear) return null
    if (y < t.entryYear) return null
    if (t.mode === 'EMS1CT') {
      const step = y - t.entryYear
      if (step === 0) return `EMS1-CT-${y}`
      if (step === 1) return `EMS2-CT-${y}`
      if (step === 2) return `EMS3-CT-${y}`
      return null
    }
    const rel = y - t.entryYear
    if (!t.repeatEbi9) {
      if (rel === 0) return `EBI7-${y}`
      if (rel === 1) return `EBI8-${y}`
      if (rel === 2) return `EBI9-${y}`
      if (rel === 3) return `EMS1-CT-${y}`
      if (rel === 4) return `EMS2-CT-${y}`
      if (rel === 5) return `EMS3-CT-${y}`
      return null
    }
    if (rel === 0) return `EBI7-${y}`
    if (rel === 1) return `EBI8-${y}`
    if (rel === 2 || rel === 3) return `EBI9-${y}`
    if (rel === 4) return `EMS1-CT-${y}`
    if (rel === 5) return `EMS2-CT-${y}`
    if (rel === 6) return `EMS3-CT-${y}`
    return null
  }

  for (const sy of schoolYears) {
    const y = sy.code
    for (const t of trajectories) {
      const code = courseCodeForTrajectory(y, t)
      if (!code) continue
      const c = allCourses.find((x) => x.code === code && x.schoolYearId === sy.id && x.isActive)
      if (!c) continue
      await prisma.student.create({
        data: {
          firstName: t.fn,
          lastName: t.ln,
          documentId: t.doc,
          schoolYearId: sy.id,
          courseId: c.id,
          enrollmentStatus: 'ACTIVE',
          contactPhone: `+5989${String(1_000_000 + (t.doc.charCodeAt(2) % 9_000_000)).padStart(7, '0')}`,
          internalNotes: `Trayectoria: ${t.mode}; ingreso ${t.entryYear}`,
        },
      })
    }

    const studs = await prisma.student.findMany({ where: { schoolYearId: sy.id }, select: { id: true } })
    for (const st of studs) {
      await prisma.studentTuitionYear.create({
        data: {
          studentId: st.id,
          year: y,
          paid: (st.id.charCodeAt(0) + y) % 5 !== 0,
          paidAt:
            (st.id.charCodeAt(0) + y) % 5 !== 0
              ? utcMidnight(y, 2, 8 + (st.id.charCodeAt(2) % 18))
              : null,
          amountCents: 18_000_00,
          notes: 'Cuota mensual',
        },
      })
      for (const month of Array.from({ length: 12 }, (_, i) => i + 1)) {
        const paid = month <= 5 ? (st.id.charCodeAt(month % st.id.length) + y + month) % 6 !== 0 : false
        await prisma.$executeRaw`
          INSERT INTO "StudentTuitionMonth" ("id", "studentId", year, month, paid, "paidAt", "amountCents", notes, "createdAt", "updatedAt")
          VALUES (
            ${randomUUID()},
            ${st.id},
            ${y},
            ${month},
            ${paid},
            ${paid ? utcMidnight(y, month, 8 + ((st.id.charCodeAt(1) + month) % 16)) : null},
            ${18_000_00},
            ${paid ? 'Mensualidad paga' : 'Mensualidad pendiente'},
            now(),
            now()
          )
        `
      }
    }
  }

  /** Eventos: jornada staff L-V en una sola recurrencia por persona; clases docentes recurrentes. */
  const firstSchoolYear = schoolYears[0]
  const lastSchoolYear = schoolYears[schoolYears.length - 1]
  if (firstSchoolYear) {
    const baseStart = startOfUtcDay(firstSchoolYear.starts)
    for (const st of staffUsers) {
      let probe = baseStart
      while (probe.getUTCDay() !== 1) probe = addUtcDays(probe, 1)
      const stTime = utcWithTime(probe, 11, 0) // 08:00 UY ≈ 11 UTC (seed demo UTC)
      const enTime = utcWithTime(probe, 19, 0) // ventana 8h
      await prisma.event.create({
        data: {
          title: `Jornada administrativa · ${st.firstName ?? ''}`,
          description: 'Turno fijo de lunes a viernes de 08:00 a 16:00.',
          type: 'JORNADA_LABORAL',
          status: 'SCHEDULED',
          startDate: stTime,
          endDate: stTime,
          startTime: stTime,
          endTime: enTime,
          userId: admin.id,
          assignedUserId: st.id,
          recurrenceType: 'WEEKLY',
          schoolYearId: lastSchoolYear?.id ?? null,
          recurrenceEnd: lastSchoolYear?.ends ?? DATA_END_UTC,
          isRecurring: true,
          daysOfWeek: WEEKDAYS_LV,
        },
      })
    }
  }

  for (const sy of schoolYears) {
    const y = sy.code
    const yearStart = sy.starts
    const yearEnd = sy.ends

    const emsOpen = yearOpenEms(y)
    const classCourseCodes = [
      `EBI7-${y}`,
      `EBI8-${y}`,
      `EBI9-${y}`,
      ...(emsOpen.ct ? [`EMS1-CT-${y}`] : []),
      ...(emsOpen.sh ? [`EMS1-SH-${y}`] : []),
      ...(emsOpen.vida ? [`EMS1-VIDA-${y}`] : []),
      ...(emsOpen.arte ? [`EMS1-ARTE-${y}`] : []),
      ...(y >= 2020 && emsOpen.ct ? [`EMS2-CT-${y}`] : []),
      ...(y >= 2020 && emsOpen.sh ? [`EMS2-SH-${y}`] : []),
      ...(y >= 2021 && emsOpen.ct ? [`EMS3-CT-${y}`] : []),
      ...(y >= 2021 && emsOpen.sh ? [`EMS3-SH-${y}`] : []),
    ]

    const slots = [
      { dow: 1, h: 12, m: 30, dur: 50 },
      { dow: 1, h: 14, m: 0, dur: 50 },
      { dow: 2, h: 13, m: 0, dur: 50 },
      { dow: 2, h: 15, m: 0, dur: 50 },
      { dow: 3, h: 12, m: 0, dur: 50 },
      { dow: 3, h: 14, m: 30, dur: 50 },
      { dow: 4, h: 13, m: 30, dur: 50 },
      { dow: 5, h: 12, m: 45, dur: 50 },
    ]

    for (let ti = 0; ti < teachers.length; ti++) {
      const teacher = teachers[ti]!
      const track = TEACHER_POOL[ti]!.track
      const pool = trackSubjects(track)
      const used = new Set<number>()
      let k = 0
      const targetWeeklyBlocks = 5 + (ti % 3 === 0 ? 1 : 0)
      while (used.size < targetWeeklyBlocks && k < 80) {
        k++
        const si = (ti + k * 3) % slots.length
        if (used.has(si)) continue
        used.add(si)
        const slot = slots[si]!
        const codeNeed = classCourseCodes[(ti + used.size * 2) % classCourseCodes.length]!
        const targetCourse = allCourses.find((c) => c.code === codeNeed && c.schoolYearId === sy.id && c.isActive)
        if (!targetCourse) continue
        const subs = subjectsByCourseId.get(targetCourse.id) ?? []
        const sub = subs.find((s) => pool.has(s.name))
        if (!sub) continue

        let probe = startOfUtcDay(yearStart)
        while (probe.getUTCDay() !== slot.dow) probe = addUtcDays(probe, 1)
        const stt = utcWithTime(probe, slot.h, slot.m)
        const ent = new Date(stt.getTime() + slot.dur * 60_000)
        await prisma.event.create({
          data: {
            title: `${sub.name} · ${teacher.firstName ?? ''}`,
            description: 'Clase recurrente semanal.',
            type: 'CLASE',
            status: y < 2026 ? 'EXPIRED' : 'SCHEDULED',
            startDate: stt,
            endDate: stt,
            startTime: stt,
            endTime: ent,
            userId: admin.id,
            assignedUserId: teacher.id,
            schoolYearId: sy.id,
            courseId: targetCourse.id,
            subjectId: sub.id,
            recurrenceType: 'WEEKLY',
            recurrenceEnd: yearEnd,
            isRecurring: true,
            daysOfWeek: [slot.dow],
          },
        })
      }
    }

    /** Reunión docente sábado aislada (1 por año). */
    const sat = addUtcDays(startOfUtcDay(yearStart), 5 + (y % 4) * 7)
    if (sat <= yearEnd) {
      const t0 = utcWithTime(sat, 14, 0)
      const t1 = new Date(t0.getTime() + 90 * 60_000)
      await prisma.event.create({
        data: {
          title: 'Reunión de área',
          description: 'Sábado excepcional.',
          type: 'REUNION',
          status: 'COMPLETED',
          startDate: t0,
          endDate: t0,
          startTime: t0,
          endTime: t1,
          userId: admin.id,
          assignedUserId: teachers[y % teachers.length]!.id,
          schoolYearId: sy.id,
          recurrenceType: 'NONE',
          isRecurring: false,
          daysOfWeek: [],
        },
      })
    }
  }

  const persisted = await prisma.event.findMany({
    where: {},
    select: {
      id: true,
      type: true,
      assignedUserId: true,
      isRecurring: true,
      recurrenceEnd: true,
      daysOfWeek: true,
      startDate: true,
      startTime: true,
      endTime: true,
    },
  })

  const historyStart = utcMidnight(2019, 2, 4)
  const attendBuffer: Prisma.AttendanceCreateManyInput[] = []

  const leaveIds: string[] = []
  for (let i = 0; i < 8; i++) {
    const u = [...staffUsers, ...teachers][i]
    if (!u) continue
    const a0 = addUtcDays(historyStart, 55 + i * 131)
    const a1 = addUtcDays(a0, 3 + (i % 4))
    const leave = await prisma.medicalLeave.create({
      data: {
        userId: u.id,
        type: i % 4 === 0 ? 'WORK_LEAVE' : 'MEDICAL_LEAVE',
        status: 'ACTIVE',
        startDate: startOfUtcDay(a0),
        endDate: new Date(Date.UTC(a1.getUTCFullYear(), a1.getUTCMonth(), a1.getUTCDate(), 23, 59, 59, 999)),
        reason: 'Licencia simulada',
        doctorName: i % 3 === 0 ? 'Dra. Seed' : null,
        approvedBy: admin.id,
        approvedAt: addUtcDays(a0, -1),
      },
    })
    leaveIds.push(leave.id)
  }

  const medWindows = await prisma.medicalLeave.findMany({
    where: { approvedAt: { not: null } },
    select: { userId: true, startDate: true, endDate: true },
  })
  const medByUser = new Map<string, { startDate: Date; endDate: Date }[]>()
  for (const m of medWindows) {
    const arr = medByUser.get(m.userId) ?? []
    arr.push({ startDate: m.startDate, endDate: m.endDate })
    medByUser.set(m.userId, arr)
  }

  for (const ev of persisted) {
    const uid = ev.assignedUserId
    if (!uid) continue
    const myLeaves = medByUser.get(uid) ?? []
    const rng = rngFactory(uid.charCodeAt(0) * 997 + ev.id.charCodeAt(2))

    const recEnd = ev.recurrenceEnd ? startOfUtcDay(ev.recurrenceEnd) : DATA_END_UTC
    const cap = recEnd < DATA_END_UTC ? recEnd : DATA_END_UTC
    const days = enumerateOccurrenceDays(
      ev.startDate,
      cap,
      ev.daysOfWeek.length ? ev.daysOfWeek : [startOfUtcDay(ev.startDate).getUTCDay()],
    )

    for (const day of days) {
      const dow = day.getUTCDay()
      if ((dow === 0 || dow === 6) && ev.type !== 'REUNION') continue
      if (day > DATA_END_UTC) break
      const ymd = utcYmd(day)
      const justified = myLeaves.some(
        (l) => ymd >= utcYmd(startOfUtcDay(l.startDate)) && ymd <= utcYmd(startOfUtcDay(l.endDate)),
      )
      const pick = pickAttendance(rng, justified)
      const baseIn = utcWithTime(day, ev.startTime?.getUTCHours() ?? 12, ev.startTime?.getUTCMinutes() ?? 0)
      const inTime = new Date(baseIn.getTime() + (pick.delayMin > 0 ? pick.delayMin * 60_000 : 0))
      attendBuffer.push({
        userId: uid,
        eventId: ev.id,
        type: 'CHECK_IN',
        status: pick.inS,
        date: startOfUtcDay(day),
        time: inTime,
        notes: null,
      })
      if (pick.outS) {
        const baseOut = utcWithTime(day, ev.endTime?.getUTCHours() ?? 14, ev.endTime?.getUTCMinutes() ?? 0)
        attendBuffer.push({
          userId: uid,
          eventId: ev.id,
          type: 'CHECK_OUT',
          status: pick.outS,
          date: startOfUtcDay(day),
          time: baseOut,
          notes: null,
        })
      }
    }
  }

  console.log(`[attendance] insertando ${attendBuffer.length} filas...`)
  await flushAttendances(attendBuffer)

  for (const id of leaveIds) {
    const r = await reconcileAttendancesForMedicalLeave(id)
    console.log(`[licencia] reconcile ${id}:`, r)
  }

  await prisma.medicalLeave.updateMany({
    where: { endDate: { lt: DATA_END_UTC } },
    data: { status: 'INACTIVE', deactivatedBy: admin.id, deactivatedAt: new Date() },
  })

  const incidentSource = await prisma.attendance.findMany({
    where: {
      OR: [
        { type: 'CHECK_IN', status: 'LATE' },
        { type: 'CHECK_IN', status: 'ABSENT_NOT_JUSTIFIED' },
        { type: 'CHECK_OUT', status: 'EARLY_EXIT' },
      ],
    },
    select: {
      id: true,
      userId: true,
      eventId: true,
      status: true,
      time: true,
      user: { select: { name: true, firstName: true, lastName: true } },
      event: { select: { title: true } },
    },
    orderBy: { time: 'asc' },
  })
  const incidentRows: Prisma.AttendanceIncidentCreateManyInput[] = incidentSource.map((a, idx) => {
    const person = a.user.name || `${a.user.firstName ?? ''} ${a.user.lastName ?? ''}`.trim() || 'persona'
    const titleBase = a.event?.title ? ` · ${a.event.title}` : ''
    const isOld = a.time < utcMidnight(2026, 0, 1)
    const resolved = isOld && idx % 4 !== 0
    if (a.status === 'LATE') {
      return {
        type: 'LATE_ARRIVAL',
        status: resolved ? 'RESOLVED' : idx % 3 === 0 ? 'ACKNOWLEDGED' : 'OPEN',
        title: `Llegada tarde de ${person}`,
        description: `Tardanza detectada${titleBase}.`,
        severity: 'MEDIUM',
        userId: a.userId,
        eventId: a.eventId,
        attendanceId: a.id,
        detectedAt: a.time,
        acknowledgedAt: resolved || idx % 3 === 0 ? addUtcDays(a.time, 1) : null,
        resolvedAt: resolved ? addUtcDays(a.time, 2) : null,
        resolvedBy: resolved ? admin.id : null,
      }
    }
    if (a.status === 'EARLY_EXIT') {
      return {
        type: 'EARLY_EXIT',
        status: resolved ? 'RESOLVED' : 'OPEN',
        title: `Salida anticipada de ${person}`,
        description: `Salida antes del horario previsto${titleBase}.`,
        severity: 'MEDIUM',
        userId: a.userId,
        eventId: a.eventId,
        attendanceId: a.id,
        detectedAt: a.time,
        acknowledgedAt: resolved ? addUtcDays(a.time, 1) : null,
        resolvedAt: resolved ? addUtcDays(a.time, 2) : null,
        resolvedBy: resolved ? admin.id : null,
      }
    }
    return {
      type: 'TEACHER_NO_SHOW',
      status: resolved ? 'RESOLVED' : idx % 2 === 0 ? 'ACKNOWLEDGED' : 'OPEN',
      title: `Ausencia no justificada de ${person}`,
      description: `Falta injustificada registrada${titleBase}.`,
      severity: 'HIGH',
      userId: a.userId,
      eventId: a.eventId,
      attendanceId: a.id,
      detectedAt: a.time,
      acknowledgedAt: resolved || idx % 2 === 0 ? addUtcDays(a.time, 1) : null,
      resolvedAt: resolved ? addUtcDays(a.time, 2) : null,
      resolvedBy: resolved ? admin.id : null,
    }
  })
  console.log(`[incidencias] insertando ${incidentRows.length} filas...`)
  await flushAttendanceIncidents(incidentRows)

  console.log('='.repeat(72))
  console.log('OK. Resumen:')
  console.log('- Ciclos:', schoolYears.length)
  console.log('- Cursos:', await prisma.course.count())
  console.log('- Asignaturas:', await prisma.subject.count())
  console.log('- Estudiantes:', await prisma.student.count())
  console.log('- Eventos:', await prisma.event.count())
  console.log('- Asistencias:', await prisma.attendance.count())
  console.log('- Licencias:', await prisma.medicalLeave.count())
  console.log(`Staff: ${STAFF_NAMES.length} · Docentes: ${TEACHER_POOL.length}`)
  console.log('='.repeat(72))
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
