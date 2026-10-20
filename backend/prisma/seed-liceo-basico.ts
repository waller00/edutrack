/**
 * Dataset "liceo de ciclo básico": borra los datos operativos y siembra un liceo realista con el
 * ciclo 2025 completo (cerrado, con APE y pase de año) y el 2026 hasta el momento en que corre.
 *
 *   npx tsx prisma/seed-liceo-basico.ts --dry-run          # muestra qué borraría, no toca nada
 *   SEED_CONFIRM=borrar-todo npx tsx prisma/seed-liceo-basico.ts
 *
 * Variables opcionales:
 *   SEED_NOW            instante de corte (ISO). Por defecto, ahora.
 *   SEED_PASSWORD       clave de las cuentas sembradas en Keycloak (default "Liceo2026").
 *   SEED_KEEP_EMAILS    emails extra a conservar, separados por coma.
 *   SEED_SKIP_KEYCLOAK  "1" para no tocar Keycloak (pruebas locales).
 *
 * Qué conserva: los usuarios ADMIN aprobados (y SEED_KEEP_EMAILS), roles y permisos, la configuración del
 * sistema, el catálogo académico (cursos, asignaturas, escalas, tipos de actividad) y las reglas de
 * alerta por defecto. Todo lo demás se borra: estudiantes, personal, horarios, asistencias, libretas.
 *
 * Sólo se ofertan los cursos de ciclo básico (7.º, 8.º y 9.º EBI). Es determinista: la misma fecha de
 * corte produce siempre los mismos datos.
 */
import 'dotenv/config'
import crypto from 'node:crypto'
import type { AttendanceStatus, Prisma, StudentAttendanceStatus } from '@prisma/client'
import { DateTime } from 'luxon'
import { prisma } from '../src/db/prisma.js'
import { getAppTimezone, uruguayWallToUtc, uruguayYmdEndOfDayToUtc, uruguayYmdOfInstant } from '../src/config/app-timezone.js'
import { ensureBuiltinOrgRoles } from '../src/identity/org-role-seed.js'
import { ensureDefaultProfilePermissionsIfNeeded } from '../src/identity/profile-permissions-repository.js'
import { provisionGradeBooks } from '../src/services/gradebook/provision.js'
import { collectAlertCandidates } from '../src/services/student-reports/alerts-scan.js'
import { generateUniqueUsername } from '../src/services/usernames.js'
import { seedAcademicCatalog } from './seed-academic-catalog.js'
import { seedAcademicConfig } from './seed-academic-config.js'
import { ensureBootstrapAdmin } from './seed-bootstrap.js'
import * as D from './data/liceo-basico.js'

type Year = 2025 | 2026
type CourseCode = D.CourseCode

const TZ = getAppTimezone()
const NOW = process.env.SEED_NOW ? new Date(process.env.SEED_NOW) : new Date()
const TODAY = uruguayYmdOfInstant(NOW)
const PASSWORD = process.env.SEED_PASSWORD || 'Liceo2026'
const SKIP_KEYCLOAK = process.env.SEED_SKIP_KEYCLOAK === '1'
const DRY_RUN = process.argv.includes('--dry-run')
const KEEP_EMAILS = new Set(
  ['ci.performance@edutrack.local', ...(process.env.SEED_KEEP_EMAILS ?? '').split(',')]
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
)
const COURSE_LABEL: Record<CourseCode, string> = { '7-EBI': '7.º', '8-EBI': '8.º', '9-EBI': '9.º' }

// ─── Azar con semilla ───────────────────────────────────────────────────────

function hashSeed(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

class Rng {
  private state: number
  constructor(seed: number | string) {
    this.state = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed)
  }
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }
  chance(p: number): boolean {
    return this.next() < p
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]!
  }
  normal(mean: number, sd: number): number {
    const u = Math.max(this.next(), 1e-9)
    const v = this.next()
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items]
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1))
      ;[out[i], out[j]] = [out[j]!, out[i]!]
    }
    return out
  }
}

const rngFor = (key: string) => new Rng(key)
const uuid = () => crypto.randomUUID()
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

// ─── Fechas ─────────────────────────────────────────────────────────────────

const dt = (ymd: string) => DateTime.fromISO(ymd, { zone: TZ })
const addDays = (ymd: string, n: number) => dt(ymd).plus({ days: n }).toFormat('yyyy-MM-dd')
const weekday = (ymd: string) => dt(ymd).weekday % 7
const wall = (ymd: string, h: number, m: number) => uruguayWallToUtc(ymd, h, m)
const dayStart = (ymd: string) => uruguayWallToUtc(ymd, 0, 0)
/** Día civil a mediodía UTC, como las fechas de libreta y catálogo. */
const noon = (ymd: string) => new Date(`${ymd}T12:00:00.000Z`)
const plusMinutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000)
const minDate = (a: Date, b: Date) => (a.getTime() <= b.getTime() ? a : b)
const hhmm = (d: Date) => DateTime.fromJSDate(d).setZone(TZ).toFormat('HH:mm')

function eachYmd(from: string, to: string): string[] {
  const out: string[] = []
  for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) out.push(cursor)
  return out
}

/** Un instante "de oficina" de ese día, sin pasar el corte. */
function officeTime(ymd: string, rng: Rng, fromHour = 8, toHour = 16): Date {
  return minDate(wall(ymd, rng.int(fromHour, toHour - 1), rng.int(0, 59)), NOW)
}

function buildValidCi(base7: number): string {
  const digits = String(base7 % 10_000_000).padStart(7, '0')
  const weights = [2, 9, 8, 7, 6, 3, 4]
  const sum = digits.split('').reduce((acc, d, i) => acc + Number(d) * weights[i]!, 0)
  return `${digits}${(10 - (sum % 10)) % 10}`
}

async function inChunks<T>(rows: T[], size: number, fn: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size))
}

function log(message: string) {
  console.log(`[liceo] ${message}`)
}

// ─── Borrado ────────────────────────────────────────────────────────────────

/** Tablas operativas. Se referencian sólo entre ellas, así que un TRUNCATE las vacía de una vez. */
const WIPE_TABLES = [
  'AuditLog', 'InAppNotification', 'AttendanceJustification', 'AttendanceIncident', 'BiometricPunch',
  'BiometricLinkRequest', 'BiometricUserMapping', 'BiometricDevice', 'Attendance', 'Substitution',
  'StudentAttendanceJustification', 'StudentAbsenceJustificationRange', 'StudentAttendanceEntry',
  'StudentAttendanceSession', 'StudentAlert', 'Endorsement', 'PeriodGradeRevision', 'PeriodGrade',
  'GradeBookPeriod', 'GradeRevision', 'AssessmentGrade', 'Assessment', 'GradeBookMessage',
  'GradeBookAccessLog', 'GradeBookPlanning', 'CourseDevelopmentEntry', 'GradeBook', 'TeacherMeetingRecord',
  'StudentConductRecord', 'StudentPendingSubject', 'StudentAccommodation', 'StudentPhoto',
  'StudentTuitionMonth', 'StudentTuitionYear', 'StudentEnrollment', 'Student', 'Event', 'MedicalLeave',
  'NonWorkingDay', 'MoodleSyncTask',
] as const

async function usersToDelete() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, username: true, name: true, isApproved: true, orgRole: { select: { code: true } } },
    orderBy: { email: 'asc' },
  })
  // Un ADMIN sin aprobar sólo pudo salir del registro público (cuando aceptaba ese rol): se borra.
  const keep = users.filter(
    (u) => (u.orgRole.code === 'ADMIN' && u.isApproved) || KEEP_EMAILS.has(u.email.toLowerCase()),
  )
  const drop = users.filter((u) => !keep.includes(u))
  return { keep, drop }
}

async function describeWipe() {
  const { keep, drop } = await usersToDelete()
  const counts = await Promise.all(
    WIPE_TABLES.map(async (table) => {
      const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT COUNT(*)::bigint AS n FROM "${table}"`)
      return [table, Number(rows[0]?.n ?? 0)] as const
    }),
  )
  log('Tablas que se vacían:')
  for (const [table, n] of counts) if (n > 0) console.log(`   ${table}: ${n}`)
  log(`Usuarios que se conservan (${keep.length}):`)
  for (const u of keep) console.log(`   ${u.orgRole.code.padEnd(10)} ${u.email}`)
  log(`Usuarios que se borran, también de Keycloak (${drop.length}):`)
  for (const u of drop) console.log(`   ${u.orgRole.code.padEnd(10)} ${u.email}`)
}

async function wipe() {
  log('Vaciando datos operativos…')
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${WIPE_TABLES.map((t) => `"${t}"`).join(', ')}`)
  // Estas tienen referencias desde tablas que se conservan (Subject, AcademicAlertRule): DELETE
  // respeta sus ON DELETE en lugar de exigir vaciarlas también.
  await prisma.academicPeriod.deleteMany()
  await prisma.subjectCourseAssignment.deleteMany()
  await prisma.courseOrientation.deleteMany()
  await prisma.courseOffering.deleteMany()
  await prisma.schoolYear.deleteMany()

  const { drop } = await usersToDelete()
  if (!SKIP_KEYCLOAK && drop.length > 0) {
    const { deleteKeycloakUserByEmail } = await import('../src/auth/keycloak.js')
    let removed = 0
    for (const user of drop) {
      try {
        if (await deleteKeycloakUserByEmail(user.email)) removed += 1
      } catch (error) {
        console.warn(`[liceo] No se pudo borrar de Keycloak ${user.email}:`, error)
      }
    }
    log(`Cuentas de Keycloak borradas: ${removed}`)
  }
  await prisma.user.deleteMany({ where: { id: { in: drop.map((u) => u.id) } } })
  log(`Usuarios borrados: ${drop.length}`)
}

// ─── Personas ───────────────────────────────────────────────────────────────

type Person = {
  key: string
  id: string
  spec: D.StaffSpec
  firstName: string
  lastName: string
  name: string
  username: string
  email: string
}

const people = new Map<string, Person>()
const person = (key: string): Person => {
  const p = people.get(key)
  if (!p) throw new Error(`[liceo] Persona desconocida: ${key}`)
  return p
}

const usedNationalIds = new Set<string>()
const usedUsernames = new Set<string>()

function uniqueCi(rng: Rng, min: number, max: number): string {
  for (;;) {
    const ci = buildValidCi(rng.int(min, max))
    if (!usedNationalIds.has(ci)) {
      usedNationalIds.add(ci)
      return ci
    }
  }
}

function surname(rng: Rng): string {
  return rng.chance(0.45) ? rng.pick(D.SURNAMES_COMMON) : rng.pick(D.SURNAMES_OTHER)
}

/** Apellido que encabeza: "De León" o "Da Silva" van segundos, si no el usuario sale "juan.de". */
function leadingSurname(rng: Rng): string {
  for (;;) {
    const s = surname(rng)
    if (!s.includes(' ')) return s
  }
}

function twoSurnames(rng: Rng): string {
  const first = leadingSurname(rng)
  let second = surname(rng)
  while (second === first) second = surname(rng)
  return `${first} ${second}`
}

const phone = (rng: Rng) => `+5989${rng.int(1, 9)}${String(rng.int(0, 999_999)).padStart(6, '0')}`

async function createStaff() {
  const roles = await prisma.orgRole.findMany({ select: { id: true, code: true } })
  const roleId = new Map(roles.map((r) => [r.code, r.id]))
  const existing = await prisma.user.findMany({ select: { username: true, nationalId: true } })
  for (const u of existing) {
    if (u.username) usedUsernames.add(u.username)
    if (u.nationalId) usedNationalIds.add(u.nationalId)
  }

  const rng = rngFor('staff-names')
  // En una sala de profesores de 28 personas no se repiten nombres ni apellidos.
  const usedFirst = new Set<string>()
  const usedLast = new Set<string>()
  const createKeycloak = SKIP_KEYCLOAK ? null : await import('../src/auth/keycloak.js')
  const linkAccount = SKIP_KEYCLOAK ? null : (await import('../src/auth/keycloak-provisioning.js')).linkKeycloakAccount
  let kcCreated = 0

  for (const spec of D.STAFF) {
    let firstName = ''
    let lastName = ''
    do {
      firstName = rng.pick(spec.gender === 'F' ? D.ADULT_NAMES_F : D.ADULT_NAMES_M)
    } while (usedFirst.has(firstName))
    do {
      lastName = rng.chance(0.3) ? twoSurnames(rng) : leadingSurname(rng)
    } while (lastName.split(' ').some((part) => usedLast.has(part)))
    usedFirst.add(firstName)
    for (const part of lastName.split(' ')) usedLast.add(part)
    const username = await generateUniqueUsername(firstName, lastName, async (c) => usedUsernames.has(c))
    usedUsernames.add(username)
    const email = `${username}@liceo.test`
    const created = spec.joined2026 ? '2026-02-16' : '2025-02-17'
    const user = await prisma.user.create({
      data: {
        email,
        username,
        firstName,
        lastName,
        name: `${firstName} ${lastName}`,
        phone: phone(rng),
        nationalId: uniqueCi(rng, 1_600_000, 4_900_000),
        birthdate: noon(`${rng.int(1966, 1994)}-${String(rng.int(1, 12)).padStart(2, '0')}-${String(rng.int(1, 28)).padStart(2, '0')}`),
        roleId: roleId.get(spec.role)!,
        emailVerifiedAt: wall(created, 10, 0),
        isApproved: true,
        approvedAt: wall(created, 10, 0),
        isActive: !spec.leftAfter2025,
        createdAt: wall(created, 9, rng.int(0, 59)),
        ...(spec.role === 'TEACHER'
          ? {
              teacherProfile: {
                create: {
                  displayName: `${firstName} ${lastName}`,
                  isActive: !spec.leftAfter2025,
                  notes: spec.leftAfter2025 ? `${spec.title}. Se trasladó a otro centro al terminar 2025.` : spec.title,
                },
              },
            }
          : {}),
      },
    })
    people.set(spec.key, { key: spec.key, id: user.id, spec, firstName, lastName, name: `${firstName} ${lastName}`, username, email })

    if (createKeycloak && linkAccount) {
      try {
        const kcId = await createKeycloak.createKeycloakUser({
          email,
          username,
          firstName,
          lastName,
          password: PASSWORD,
          role: spec.role,
          emailVerified: true,
        })
        await linkAccount(user.id, kcId)
        kcCreated += 1
      } catch (error) {
        console.warn(`[liceo] Keycloak ${username}:`, error)
      }
    }
  }
  log(`Personal creado: ${people.size} (cuentas de Keycloak: ${SKIP_KEYCLOAK ? 'omitidas' : kcCreated})`)
}

// ─── Estudiantes ────────────────────────────────────────────────────────────

type StudentRec = {
  id: string
  firstName: string
  lastName: string
  documentId: string
  ability: number
  conduct: number
  absenceRate: number
  lateRate: number
  affinity: Map<string, number>
  /** Familia: los hermanos comparten apellidos, teléfono del tutor y domicilio. */
  family: { lastName: string; tutorPhone: string; address: string } | null
}

type EnrollmentRec = {
  id: string
  student: StudentRec
  year: Year
  course: CourseCode
  status: 'ACTIVE' | 'WITHDRAWN' | 'TRANSFERRED'
  /** Último día que asistió, si se fue durante el año. */
  untilYmd: string | null
  notes: string
  createdAt: Date
  academicResult?: 'PROMOTED' | 'PROMOTED_WITH_PENDING' | 'REPEATED' | null
  apeReferred?: boolean
}

const students: StudentRec[] = []
const studentRows: Prisma.StudentCreateManyInput[] = []

function makeStudent(cohort: string, index: number, birthYear: number, admittedFrom: string, createdYmd: string, family?: StudentRec['family']): StudentRec {
  const rng = rngFor(`student-${cohort}-${index}`)
  const female = rng.chance(0.5)
  let firstName = rng.pick(female ? D.STUDENT_NAMES_F : D.STUDENT_NAMES_M)
  let lastName = family?.lastName ?? twoSurnames(rng)
  while (students.some((s) => s.firstName === firstName && s.lastName === lastName)) {
    if (family) firstName = rng.pick(female ? D.STUDENT_NAMES_F : D.STUDENT_NAMES_M)
    else lastName = twoSurnames(rng)
  }

  const atRisk = rng.chance(0.07)
  const ability = atRisk ? clamp(rng.normal(4.2, 0.5), 3, 5.2) : clamp(rng.normal(7.1, 1.25), 4.6, 9.8)
  const conduct = rng.chance(0.09) ? clamp(rng.normal(5.8, 0.7), 4, 7) : clamp(rng.normal(8.6, 0.9), 6.5, 10)
  const absenceTier = rng.next()
  const absenceRate = absenceTier < 0.7 ? 0.008 + rng.next() * 0.02 : absenceTier < 0.92 ? 0.035 + rng.next() * 0.03 : 0.08 + rng.next() * 0.05
  const lateTier = rng.next()
  const lateRate = lateTier < 0.6 ? 0.005 + rng.next() * 0.015 : lateTier < 0.9 ? 0.02 + rng.next() * 0.03 : 0.07 + rng.next() * 0.05
  const affinity = new Map<string, number>()
  for (const course of D.COURSE_CODES) for (const [subject] of D.WEEKLY_HOURS[course]) affinity.set(subject, rng.normal(0, 0.65))

  const id = uuid()
  const documentId = uniqueCi(rng, 5_350_000, 6_450_000)
  const address = family?.address ?? `${rng.pick(D.STREETS)} ${rng.int(1000, 4899)}${rng.chance(0.4) ? ` ap. ${rng.int(1, 9)}0${rng.int(1, 4)}` : ''}`
  const tutorPhone = family?.tutorPhone ?? phone(rng)
  const rec: StudentRec = { id, firstName, lastName, documentId, ability, conduct, absenceRate, lateRate, affinity, family: { lastName, tutorPhone, address } }
  students.push(rec)

  const notesRng = rngFor(`student-notes-${id}`)
  const accessNote = notesRng.chance(0.1)
    ? notesRng.pick([
        'Lo retira su madre; también está autorizada la abuela.',
        'Tiene autorización firmada para retirarse solo al terminar la jornada.',
        'Usa lentes: conviene ubicarlo en las primeras filas.',
        'Padres separados: los avisos van a los dos teléfonos.',
        'Concurre a fonoaudióloga los jueves; puede retirarse a las 12:20.',
      ])
    : null
  studentRows.push({
    id,
    firstName,
    lastName,
    documentId,
    contactPhone: rng.chance(0.72) ? phone(rng) : null,
    tutorPhone,
    email: null,
    address,
    birthDate: noon(`${birthYear}-${String(rng.int(1, 12)).padStart(2, '0')}-${String(rng.int(1, 28)).padStart(2, '0')}`),
    admittedFrom,
    healthCardExpiresAt: noon(`${rng.pick([2025, 2026, 2026, 2027])}-${String(rng.int(1, 12)).padStart(2, '0')}-15`),
    liceoAccessNotes: accessNote,
    createdAt: wall(createdYmd, rng.int(9, 15), rng.int(0, 59)),
  })
  return rec
}

async function createStudentsAndUsernames() {
  const taken = new Set<string>()
  for (const row of studentRows) {
    const username = await generateUniqueUsername(row.firstName, row.lastName, async (c) => taken.has(c))
    taken.add(username)
    row.username = username
    row.email = `${username}@alumnos.liceo.test`
  }
  await inChunks(studentRows, 500, (chunk) => prisma.student.createMany({ data: chunk }))
}

// ─── Ciclos, oferta y calendario ────────────────────────────────────────────

type YearCtx = {
  year: Year
  schoolYearId: string
  cal: D.YearCalendar
  nonWorking: Set<string>
  classDays: string[]
  offeringByCourse: Map<CourseCode, string>
  subjectIdByName: Map<string, string>
}

async function setupYears(): Promise<Map<Year, YearCtx>> {
  await seedAcademicCatalog({ years: [2025, 2026] })
  await prisma.schoolYear.deleteMany({ where: { code: { notIn: [2025, 2026] } } })

  const subjects = await prisma.subject.findMany({ select: { id: true, name: true } })
  const subjectIdByName = new Map(subjects.map((s) => [s.name, s.id]))
  const courses = await prisma.course.findMany({ select: { id: true, code: true, level: true } })
  const out = new Map<Year, YearCtx>()

  for (const year of [2025, 2026] as const) {
    const cal = D.YEAR_CALENDARS[year]
    const sy = await prisma.schoolYear.update({
      where: { code: year },
      data: { label: `Ciclo lectivo ${year}`, status: cal.status, startsOn: noon(cal.start), endsOn: noon(cal.end) },
    })
    // Sólo ciclo básico: los cursos de bachillerato quedan en el catálogo, sin ofertarse.
    for (const course of courses) {
      const offered = course.level === 'EBI'
      await prisma.courseOffering.updateMany({
        where: { schoolYearId: sy.id, courseId: course.id },
        data: {
          isOffered: offered,
          isActive: offered,
          visibleInFilters: offered,
          notes: offered ? `Ofertado en ${year}` : 'En catálogo; el liceo sólo dicta ciclo básico',
        },
      })
    }
    await prisma.courseOrientation.updateMany({
      where: { schoolYearId: sy.id },
      data: { isOffered: false, isActive: false, visibleInFilters: false },
    })
    await prisma.subjectCourseAssignment.updateMany({
      where: { schoolYearId: sy.id, OR: [{ level: 'EMS' }, { course: { level: 'EMS' } }, { orientationId: { not: null } }] },
      data: { isOffered: false, visibleInFilters: false },
    })

    const offerings = await prisma.courseOffering.findMany({
      where: { schoolYearId: sy.id, course: { level: 'EBI' } },
      select: { id: true, course: { select: { code: true } } },
    })
    const offeringByCourse = new Map(offerings.map((o) => [o.course.code as CourseCode, o.id]))

    const nonWorking = new Set<string>()
    const nwdRows: Prisma.NonWorkingDayCreateManyInput[] = []
    for (const seed of D.NON_WORKING[year]) {
      for (const ymd of eachYmd(seed.from, seed.to ?? seed.from)) {
        if (weekday(ymd) === 0 || weekday(ymd) === 6) continue
        nonWorking.add(ymd)
        nwdRows.push({ date: dayStart(ymd), type: seed.type, reason: seed.reason, notes: seed.notes ?? null, schoolYearId: sy.id })
      }
    }
    await prisma.nonWorkingDay.createMany({ data: nwdRows })
    const classDays = eachYmd(cal.start, cal.end).filter((ymd) => weekday(ymd) >= 1 && weekday(ymd) <= 5 && !nonWorking.has(ymd))
    out.set(year, { year, schoolYearId: sy.id, cal, nonWorking, classDays, offeringByCourse, subjectIdByName })
  }

  // Períodos, escalas y tipos de actividad de los dos ciclos.
  await seedAcademicConfig(prisma)
  log('Ciclos 2025 (cerrado) y 2026 (activo) con oferta de ciclo básico')
  return out
}

// ─── Horario ────────────────────────────────────────────────────────────────

type Block = { course: CourseCode; subject: string; teacher: string; len: 1 | 2; afternoon: boolean }

type EventRec = {
  id: string
  year: Year
  course: CourseCode
  subject: string
  subjectId: string
  offeringId: string
  teacherKey: string
  afternoon: boolean
  slot: number
  len: number
  days: number[]
  start: readonly [number, number]
  end: readonly [number, number]
}

function blocksFor(year: Year): Block[] {
  const blocks: Block[] = []
  for (const course of D.COURSE_CODES) {
    for (const [subject, hours] of D.WEEKLY_HOURS[course]) {
      const teacher = D.titularFor(year, course, subject)
      const afternoon = D.AFTERNOON_SUBJECTS.has(subject)
      let lens: Array<1 | 2>
      if (afternoon) lens = hours >= 3 ? [2, 1] : [2]
      else if (D.DOUBLE_BLOCK_SUBJECTS.has(subject)) lens = hours === 1 ? [1] : [2]
      else if (hours === 4) lens = [2, 1, 1]
      else if (hours === 3) lens = subject === 'Inglés' ? [1, 1, 1] : [2, 1]
      else lens = Array.from({ length: hours }, () => 1 as const)
      for (const len of lens) blocks.push({ course, subject, teacher, len, afternoon })
    }
  }
  return blocks
}

/**
 * Arma el horario semanal de los tres grupos sin choques de docente ni horas puente: cada día de
 * cada grupo se llena desde la primera hora, y un módulo doble nunca cruza el recreo.
 */
function buildTimetable(year: Year) {
  const blocks = blocksFor(year)
  for (let attempt = 0; attempt < 5000; attempt += 1) {
    const rng = rngFor(`timetable-${year}-${attempt}`)
    const nextFree = new Map<string, number>()
    const teacherBusy = new Set<string>()
    const subjectDay = new Set<string>()
    const placed: Array<Block & { day: number; slot: number }> = []
    const ordered = rng.shuffle(blocks).sort((a, b) => b.len - a.len)
    let ok = true
    for (const block of ordered) {
      const part = block.afternoon ? 'PM' : 'AM'
      const maxSlots = block.afternoon ? D.AFTERNOON_SLOTS.length : D.MORNING_SLOTS.length
      const options: Array<{ day: number; slot: number; score: number }> = []
      for (let day = 1; day <= 5; day += 1) {
        if (subjectDay.has(`${block.course}:${block.subject}:${day}`)) continue
        const slot = nextFree.get(`${block.course}:${part}:${day}`) ?? 0
        if (slot + block.len > maxSlots) continue
        if (block.len === 2 && slot % 2 === 1 && !block.afternoon) continue
        let free = true
        for (let s = slot; s < slot + block.len; s += 1) if (teacherBusy.has(`${block.teacher}:${part}:${day}:${s}`)) free = false
        if (!free) continue
        options.push({ day, slot, score: slot + rng.next() * 2.5 })
      }
      if (options.length === 0) {
        ok = false
        break
      }
      options.sort((a, b) => a.score - b.score)
      const choice = options[0]!
      nextFree.set(`${block.course}:${part}:${choice.day}`, choice.slot + block.len)
      for (let s = choice.slot; s < choice.slot + block.len; s += 1) teacherBusy.add(`${block.teacher}:${part}:${choice.day}:${s}`)
      subjectDay.add(`${block.course}:${block.subject}:${choice.day}`)
      placed.push({ ...block, day: choice.day, slot: choice.slot })
    }
    if (ok) return placed
  }
  throw new Error(`[liceo] No se pudo armar el horario de ${year}`)
}

async function createClassEvents(ctx: YearCtx): Promise<EventRec[]> {
  const placed = buildTimetable(ctx.year)
  const merged = new Map<string, EventRec>()
  for (const block of placed) {
    const key = `${block.course}|${block.subject}|${block.afternoon ? 'PM' : 'AM'}|${block.slot}|${block.len}`
    const slots = block.afternoon ? D.AFTERNOON_SLOTS : D.MORNING_SLOTS
    const first = slots[block.slot]!
    const last = slots[block.slot + block.len - 1]!
    const existing = merged.get(key)
    if (existing) {
      existing.days.push(block.day)
      continue
    }
    const subjectId = ctx.subjectIdByName.get(block.subject)
    if (!subjectId) throw new Error(`[liceo] Falta la asignatura ${block.subject} en el catálogo`)
    merged.set(key, {
      id: uuid(),
      year: ctx.year,
      course: block.course,
      subject: block.subject,
      subjectId,
      offeringId: ctx.offeringByCourse.get(block.course)!,
      teacherKey: block.teacher,
      afternoon: block.afternoon,
      slot: block.slot,
      len: block.len,
      days: [block.day],
      start: [first[0], first[1]],
      end: [last[2], last[3]],
    })
  }
  const events = [...merged.values()]
  for (const e of events) e.days.sort((a, b) => a - b)

  const director = person('DIR')
  await prisma.event.createMany({
    data: events.map((e) => ({
      id: e.id,
      title: `${e.subject} - ${COURSE_LABEL[e.course]} EBI`,
      description: `Clase de ${e.subject} de ${COURSE_LABEL[e.course]} año (ciclo básico).`,
      type: 'CLASE' as const,
      status: ctx.year === 2025 ? ('COMPLETED' as const) : ('SCHEDULED' as const),
      startDate: dayStart(ctx.cal.start),
      endDate: dayStart(ctx.cal.end),
      startTime: wall(ctx.cal.start, e.start[0], e.start[1]),
      endTime: wall(ctx.cal.start, e.end[0], e.end[1]),
      location: D.ROOM_BY_SUBJECT[e.subject] ?? D.HOME_ROOM[e.course],
      userId: director.id,
      assignedUserId: person(e.teacherKey).id,
      schoolYearId: ctx.schoolYearId,
      courseOfferingId: e.offeringId,
      subjectId: e.subjectId,
      recurrenceType: 'WEEKLY' as const,
      recurrenceEnd: uruguayYmdEndOfDayToUtc(ctx.cal.end),
      isRecurring: true,
      daysOfWeek: e.days,
      createdAt: wall(`${ctx.year}-02-24`, 10, 0),
    })),
  })
  return events
}

/** Jornada laboral del personal no docente y algunas actividades institucionales sueltas. */
async function createInstitutionalEvents(ctx: YearCtx) {
  const director = person('DIR')
  const shifts = D.STAFF.filter((s) => s.shift)
  await prisma.event.createMany({
    data: shifts.map((spec) => {
      const [h1, m1, h2, m2] = spec.shift!
      return {
        id: shiftEventId(ctx.year, spec.key),
        title: `Jornada laboral - ${person(spec.key).name}`,
        description: `${spec.title}: lunes a viernes.`,
        type: 'JORNADA_LABORAL' as const,
        status: ctx.year === 2025 ? ('COMPLETED' as const) : ('SCHEDULED' as const),
        startDate: dayStart(ctx.cal.start),
        endDate: dayStart(ctx.cal.end),
        startTime: wall(ctx.cal.start, h1, m1),
        endTime: wall(ctx.cal.start, h2, m2),
        location: spec.role === 'DIRECCION' ? 'Dirección' : spec.role === 'ADSCRIPTO' ? 'Adscripción' : 'Secretaría',
        userId: director.id,
        assignedUserId: person(spec.key).id,
        schoolYearId: ctx.schoolYearId,
        recurrenceType: 'DAILY' as const,
        recurrenceEnd: uruguayYmdEndOfDayToUtc(ctx.cal.end),
        isRecurring: true,
        daysOfWeek: [1, 2, 3, 4, 5],
        createdAt: wall(`${ctx.year}-02-24`, 10, 30),
      }
    }),
  })

  const y = ctx.year
  const oneOffs: Array<[string, string, 'REUNION' | 'EVENTO' | 'CAPACITACION', number, number, number, number, string]> = [
    [`${y}-03-${y === 2025 ? '14' : '13'}`, 'Reunión de padres de 7.º', 'REUNION', 18, 0, 19, 30, 'Salón de actos'],
    [`${y}-04-${y === 2025 ? '08' : '09'}`, 'Reunión de profesores: diagnóstico (trayectorias)', 'REUNION', 14, 0, 17, 0, 'Sala de profesores'],
    [`${y}-05-${y === 2025 ? '16' : '15'}`, 'Acto: Batalla de Las Piedras', 'EVENTO', 10, 50, 11, 35, 'Patio central'],
    [`${y}-05-${y === 2025 ? '21' : '20'}`, 'Reunión de profesores: 1.ª entrega', 'REUNION', 14, 0, 17, 30, 'Sala de profesores'],
    [`${y}-06-${y === 2025 ? '18' : '17'}`, 'Acto: Natalicio de Artigas', 'EVENTO', 10, 50, 11, 35, 'Patio central'],
    [`${y}-08-${y === 2025 ? '20' : '19'}`, 'Reunión de profesores: 2.ª entrega', 'REUNION', 14, 0, 17, 30, 'Sala de profesores'],
    [`${y}-08-${y === 2025 ? '22' : '24'}`, 'Acto: Declaratoria de la Independencia', 'EVENTO', 10, 50, 11, 35, 'Patio central'],
    [`${y}-09-${y === 2025 ? '12' : '11'}`, 'Taller de convivencia digital (Plan Ceibal)', 'CAPACITACION', 9, 10, 10, 40, 'Sala de Informática'],
    [`${y}-10-${y === 2025 ? '21' : '21'}`, 'Reunión de profesores: 3.ª entrega', 'REUNION', 14, 0, 17, 30, 'Sala de profesores'],
    [`${y}-11-${y === 2025 ? '14' : '13'}`, 'Muestra anual de Comunicación Visual y Música', 'EVENTO', 18, 0, 20, 0, 'Salón de actos'],
    [`${y}-12-${y === 2025 ? '10' : '09'}`, 'Reunión de profesores: 4.ª entrega y fallos', 'REUNION', 14, 0, 18, 0, 'Sala de profesores'],
  ]
  await prisma.event.createMany({
    data: oneOffs.map(([ymd, title, type, h1, m1, h2, m2, location]) => {
      const end = wall(ymd, h2, m2)
      return {
        title,
        type,
        status: end.getTime() <= NOW.getTime() ? ('COMPLETED' as const) : ('SCHEDULED' as const),
        startDate: dayStart(ymd),
        endDate: dayStart(ymd),
        startTime: wall(ymd, h1, m1),
        endTime: end,
        location,
        userId: director.id,
        schoolYearId: ctx.schoolYearId,
        createdAt: minDate(wall(addDays(ymd, -14), 11, 0), NOW),
      }
    }),
  })
}

const shiftEventId = (year: Year, key: string) => {
  const hex = crypto.createHash('sha256').update(`shift-${year}-${key}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

// ─── Ocurrencias, licencias y suplencias ────────────────────────────────────

type Occ = {
  event: EventRec
  ymd: string
  startAt: Date
  endAt: Date
  past: boolean
  /** Quién dio la clase: el titular, un suplente o nadie (la lista la pasa adscripción). */
  mode: 'TITULAR' | 'COVERED' | 'UNCOVERED'
  teacherId: string
  leave: LeaveRec | null
  sessionId: string | null
  takenAt: Date | null
  /** El titular faltó ese día sin licencia. */
  randomAbsence: boolean
  teacherLateMinutes: number
}

type LeaveRec = D.LeaveSeed & { id: string; userId: string; createdAt: Date }

function leaveOn(leaves: LeaveRec[], key: string, ymd: string) {
  return leaves.find((l) => l.staff === key && l.from <= ymd && ymd <= l.to) ?? null
}

async function createLeaves(ctx: YearCtx): Promise<LeaveRec[]> {
  const leaves: LeaveRec[] = D.LEAVES[ctx.year].map((seed) => {
    const rng = rngFor(`leave-${ctx.year}-${seed.staff}-${seed.from}`)
    return {
      ...seed,
      id: uuid(),
      userId: person(seed.staff).id,
      createdAt: officeTime(addDays(seed.from, -rng.int(0, 3)), rng, 8, 13),
    }
  })
  const visible = leaves.filter((l) => l.createdAt.getTime() <= NOW.getTime())
  const secretary = person('SEC')
  await prisma.medicalLeave.createMany({
    data: visible.map((l) => ({
      id: l.id,
      userId: l.userId,
      type: l.type,
      status: 'ACTIVE' as const,
      startDate: dayStart(l.from),
      endDate: dayStart(l.to),
      reason: l.reason,
      approvedBy: person('DIR').id,
      approvedAt: plusMinutes(l.createdAt, 90),
      notes: 'Constancia presentada en secretaría. No se archiva el certificado ni el diagnóstico.',
      createdAt: l.createdAt,
    })),
  })
  await prisma.auditLog.createMany({
    data: visible.map((l) => ({
      occurredAt: l.createdAt,
      action: 'MEDICAL_LEAVE_CREATED' as const,
      actorUserId: secretary.id,
      actorIp: '10.20.0.31',
      userAgent: USER_AGENT,
      entityType: 'MedicalLeave',
      entityId: l.id,
      metadata: { userId: l.userId, from: l.from, to: l.to, type: l.type },
    })),
  })
  return visible
}

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'

function expandOccurrences(ctx: YearCtx, events: EventRec[], leaves: LeaveRec[]): Occ[] {
  const occs: Occ[] = []
  for (const event of events) {
    for (const ymd of ctx.classDays) {
      if (!event.days.includes(weekday(ymd))) continue
      const startAt = wall(ymd, event.start[0], event.start[1])
      const endAt = wall(ymd, event.end[0], event.end[1])
      occs.push({
        event,
        ymd,
        startAt,
        endAt,
        past: endAt.getTime() <= NOW.getTime(),
        mode: 'TITULAR',
        teacherId: person(event.teacherKey).id,
        leave: leaveOn(leaves, event.teacherKey, ymd),
        sessionId: null,
        takenAt: null,
        randomAbsence: false,
        teacherLateMinutes: 0,
      })
    }
  }
  occs.sort((a, b) => a.startAt.getTime() - b.startAt.getTime())

  // Inasistencias sueltas del titular (día entero, sin licencia).
  const absentDays = new Set<string>()
  const teacherDays = new Set(occs.map((o) => `${o.event.teacherKey}|${o.ymd}`))
  for (const td of teacherDays) {
    const [key, ymd] = td.split('|') as [string, string]
    if (leaveOn(leaves, key, ymd)) continue
    if (rngFor(`absent-${ctx.year}-${td}`).chance(0.016)) absentDays.add(td)
  }

  // Ocupación de cada docente (sus propias clases) para elegir suplentes libres.
  const busy = new Map<string, Array<[number, number]>>()
  const markBusy = (key: string, ymd: string, o: Occ) => {
    const k = `${key}|${ymd}`
    const list = busy.get(k) ?? []
    list.push([o.startAt.getTime(), o.endAt.getTime()])
    busy.set(k, list)
  }
  for (const o of occs) markBusy(o.event.teacherKey, o.ymd, o)
  const isFree = (key: string, o: Occ) =>
    !absentDays.has(`${key}|${o.ymd}`) &&
    !leaveOn(leaves, key, o.ymd) &&
    !(busy.get(`${key}|${o.ymd}`) ?? []).some(([s, e]) => s < o.endAt.getTime() && o.startAt.getTime() < e)

  const pool = D.STAFF.filter((s) => s.role === 'TEACHER' && !(ctx.year === 2026 && s.leftAfter2025) && !(ctx.year === 2025 && s.joined2026))
  for (const o of occs) {
    const key = o.event.teacherKey
    if (o.leave) {
      const cover = o.leave.coveredBy
      if (cover && isFree(cover, o)) {
        o.mode = 'COVERED'
        o.teacherId = person(cover).id
        markBusy(cover, o.ymd, o)
      } else {
        o.mode = 'UNCOVERED'
      }
      continue
    }
    if (!absentDays.has(`${key}|${o.ymd}`)) {
      const rng = rngFor(`late-${o.event.id}-${o.ymd}`)
      if (rng.chance(0.055)) o.teacherLateMinutes = rng.int(6, 18)
      continue
    }
    o.randomAbsence = true
    const rng = rngFor(`cover-${o.event.id}-${o.ymd}`)
    const candidates = pool
      .filter((s) => s.key !== key && (s.canCover ?? []).includes(o.event.subject))
      .sort((a, b) => Number(b.key.startsWith('SUP_')) - Number(a.key.startsWith('SUP_')))
    const substitute = rng.chance(0.5) ? candidates.find((s) => isFree(s.key, o)) : undefined
    if (substitute) {
      o.mode = 'COVERED'
      o.teacherId = person(substitute.key).id
      markBusy(substitute.key, o.ymd, o)
    } else {
      o.mode = 'UNCOVERED'
    }
  }
  return occs
}

async function createSubstitutions(ctx: YearCtx, occs: Occ[]) {
  const rows: Prisma.SubstitutionCreateManyInput[] = []
  const audit: Prisma.AuditLogCreateManyInput[] = []
  for (const o of occs) {
    if (o.mode !== 'COVERED') continue
    const rng = rngFor(`sub-${o.event.id}-${o.ymd}`)
    const creator = person(o.event.course === '9-EBI' ? 'ADS2' : 'ADS1')
    const createdAt = o.leave ? plusMinutes(o.leave.createdAt, rng.int(60, 300)) : wall(o.ymd, 6, 50 + rng.int(0, 9))
    if (createdAt.getTime() > NOW.getTime()) continue
    const id = uuid()
    rows.push({
      id,
      eventId: o.event.id,
      originalTeacherUserId: person(o.event.teacherKey).id,
      substituteUserId: o.teacherId,
      date: dayStart(o.ymd),
      startTime: o.startAt,
      endTime: o.endAt,
      reason: o.leave ? o.leave.reason : 'Inasistencia del titular',
      notes: o.leave ? 'Cobertura de toda la licencia.' : 'Suplencia del día, coordinada por adscripción.',
      createdByUserId: creator.id,
      createdAt,
    })
    audit.push({
      occurredAt: createdAt,
      action: 'SUBSTITUTION_CREATED',
      actorUserId: creator.id,
      actorIp: '10.20.0.42',
      userAgent: USER_AGENT,
      entityType: 'Substitution',
      entityId: id,
      metadata: { eventId: o.event.id, date: o.ymd },
    })
  }
  await inChunks(rows, 1000, (chunk) => prisma.substitution.createMany({ data: chunk }))
  await inChunks(audit, 1000, (chunk) => prisma.auditLog.createMany({ data: chunk }))
  return rows.length
}

// ─── Asistencia del personal y reloj biométrico ─────────────────────────────

type Biometric = { deviceId: string; deviceUserIdByUser: Map<string, string>; mappingIdByUser: Map<string, string> }

async function createBiometricDevice(): Promise<Biometric> {
  const device = await prisma.biometricDevice.create({
    data: {
      code: 'ZK-PORTERIA',
      admsSerial: 'CKUP221960118',
      name: 'Reloj biométrico de portería (ZKTeco F22)',
      secretHash: crypto.createHash('sha256').update(crypto.randomBytes(24)).digest('hex'),
      timezone: TZ,
      isActive: true,
      allowedIps: ['192.168.10.20'],
      lastSeenAt: NOW,
      createdAt: wall('2025-02-20', 11, 0),
    },
  })
  const deviceUserIdByUser = new Map<string, string>()
  const mappingIdByUser = new Map<string, string>()
  let n = 101
  const rows: Prisma.BiometricUserMappingCreateManyInput[] = []
  for (const p of people.values()) {
    if (p.spec.role === 'INSPECCION') continue
    const id = uuid()
    const deviceUserId = String(n++)
    rows.push({ id, deviceId: device.id, userId: p.id, deviceUserId, isActive: !p.spec.leftAfter2025, createdAt: wall(p.spec.joined2026 ? '2026-02-23' : '2025-02-24', 9, 0) })
    deviceUserIdByUser.set(p.id, deviceUserId)
    mappingIdByUser.set(p.id, id)
  }
  await prisma.biometricUserMapping.createMany({ data: rows })
  return { deviceId: device.id, deviceUserIdByUser, mappingIdByUser }
}

class AttendanceWriter {
  attendance: Prisma.AttendanceCreateManyInput[] = []
  punches: Prisma.BiometricPunchCreateManyInput[] = []
  justifications: Prisma.AttendanceJustificationCreateManyInput[] = []
  incidents: Prisma.AttendanceIncidentCreateManyInput[] = []
  private punchKeys = new Set<string>()
  constructor(private bio: Biometric, private schoolYearId: string) {}

  pair(userId: string, eventId: string, ymd: string, inAt: Date, outAt: Date, inStatus: AttendanceStatus, outStatus: AttendanceStatus, inNote: string, outNote: string) {
    for (const [type, at, status, note] of [
      ['CHECK_IN', inAt, inStatus, inNote],
      ['CHECK_OUT', outAt, outStatus, outNote],
    ] as const) {
      // Turno en curso al momento del corte: hay entrada, la salida todavía no.
      if (at.getTime() > NOW.getTime()) continue
      const id = uuid()
      this.attendance.push({ id, userId, eventId, type, status, date: dayStart(ymd), time: at, schoolYearId: this.schoolYearId, notes: note, createdAt: at })
      this.punch(userId, id, type, at)
    }
  }

  absence(userId: string, eventId: string, ymd: string, at: Date, status: AttendanceStatus, note: string) {
    const id = uuid()
    this.attendance.push({ id, userId, eventId, type: 'CHECK_IN', status, date: dayStart(ymd), time: at, schoolYearId: this.schoolYearId, notes: note, createdAt: at })
    return id
  }

  private punch(userId: string, attendanceId: string, type: 'CHECK_IN' | 'CHECK_OUT', at: Date) {
    const deviceUserId = this.bio.deviceUserIdByUser.get(userId)
    if (!deviceUserId) return
    const key = `${deviceUserId}|${at.getTime()}`
    if (this.punchKeys.has(key)) return
    this.punchKeys.add(key)
    this.punches.push({
      deviceId: this.bio.deviceId,
      mappingId: this.bio.mappingIdByUser.get(userId) ?? null,
      userId,
      attendanceId,
      externalId: `${deviceUserId}-${at.getTime()}`,
      deviceUserId,
      occurredAt: at,
      receivedAt: new Date(at.getTime() + 20_000),
      punchType: type,
      processStatus: 'PROCESSED',
      payload: { source: 'iclock', verify: 'fingerprint', deviceUserId },
      createdAt: at,
    })
  }

  async flush() {
    await inChunks(this.attendance, 2000, (chunk) => prisma.attendance.createMany({ data: chunk }))
    await inChunks(this.punches, 2000, (chunk) => prisma.biometricPunch.createMany({ data: chunk }))
    await inChunks(this.justifications, 2000, (chunk) => prisma.attendanceJustification.createMany({ data: chunk }))
    await inChunks(this.incidents, 2000, (chunk) => prisma.attendanceIncident.createMany({ data: chunk }))
  }
}

const LATE_NOTES = ['Demora en el ómnibus', 'Avisó por WhatsApp a adscripción', 'Venía de otro liceo', 'Tránsito en la rambla'] as const

function teacherAttendance(ctx: YearCtx, occs: Occ[], writer: AttendanceWriter) {
  const secretary = person('SEC')
  for (const o of occs) {
    if (o.startAt.getTime() > NOW.getTime()) continue
    const titularId = person(o.event.teacherKey).id
    const rng = rngFor(`tatt-${o.event.id}-${o.ymd}`)
    if (o.leave) {
      writer.absence(titularId, o.event.id, o.ymd, o.startAt, 'ABSENT_JUSTIFIED', `Licencia: ${o.leave.reason}.`)
    } else if (o.randomAbsence) {
      if (o.mode === 'COVERED') {
        writer.absence(titularId, o.event.id, o.ymd, o.startAt, 'SUBSTITUTED', 'Inasistencia cubierta por suplente.')
      } else {
        const justified = rng.chance(0.45)
        const id = writer.absence(titularId, o.event.id, o.ymd, o.startAt, justified ? 'ABSENT_JUSTIFIED' : 'ABSENT_NOT_JUSTIFIED', 'Sin marca de entrada.')
        if (justified) {
          writer.justifications.push({
            attendanceId: id,
            type: 'ABSENCE',
            reason: rng.pick(['Certificado médico presentado', 'Trámite personal con aviso previo', 'Enfermedad de familiar a cargo']),
            previousStatus: 'ABSENT_NOT_JUSTIFIED',
            newStatus: 'ABSENT_JUSTIFIED',
            createdByUserId: secretary.id,
            createdAt: minDate(officeTime(addDays(o.ymd, rng.int(1, 3)), rng, 8, 13), NOW),
          })
        }
        if (ctx.year === 2026) {
          const recent = NOW.getTime() - o.startAt.getTime() < 3 * 86_400_000
          writer.incidents.push({
            type: 'TEACHER_NO_SHOW',
            status: recent ? 'OPEN' : 'RESOLVED',
            title: 'Docente sin marca de entrada',
            description: `${person(o.event.teacherKey).name} no registró entrada a ${o.event.subject} (${COURSE_LABEL[o.event.course]}).`,
            severity: 'HIGH',
            userId: titularId,
            eventId: o.event.id,
            detectedAt: plusMinutes(o.startAt, 15),
            resolvedAt: recent ? null : plusMinutes(o.startAt, 60 * 24),
            resolvedBy: recent ? null : person('SUBDIR').id,
            createdAt: plusMinutes(o.startAt, 15),
          })
        }
      }
    }
    if (o.mode === 'UNCOVERED') continue
    const late = o.teacherLateMinutes
    const inAt = plusMinutes(o.startAt, late > 0 ? late : -rng.int(2, 12))
    const earlyExit = rng.chance(0.02)
    const outAt = plusMinutes(o.endAt, earlyExit ? -rng.int(8, 15) : rng.int(0, 6))
    writer.pair(
      o.teacherId,
      o.event.id,
      o.ymd,
      inAt,
      outAt,
      late > 5 ? 'LATE' : 'PRESENT',
      earlyExit ? 'EARLY_EXIT' : 'EXIT',
      late > 5 ? rng.pick(LATE_NOTES) : o.mode === 'COVERED' ? 'Entrada docente suplente.' : 'Entrada.',
      earlyExit ? 'Retiro autorizado por dirección.' : 'Salida.',
    )
  }
}

function staffAttendance(ctx: YearCtx, leaves: LeaveRec[], writer: AttendanceWriter) {
  for (const spec of D.STAFF) {
    if (!spec.shift) continue
    const p = person(spec.key)
    const eventId = shiftEventId(ctx.year, spec.key)
    const [h1, m1, h2, m2] = spec.shift
    for (const ymd of ctx.classDays) {
      const start = wall(ymd, h1, m1)
      const end = wall(ymd, h2, m2)
      if (start.getTime() > NOW.getTime()) continue
      const leave = leaveOn(leaves, spec.key, ymd)
      if (leave) {
        writer.absence(p.id, eventId, ymd, start, 'ABSENT_JUSTIFIED', `Licencia: ${leave.reason}.`)
        continue
      }
      const rng = rngFor(`satt-${spec.key}-${ymd}`)
      if (rng.chance(0.012)) {
        writer.absence(p.id, eventId, ymd, start, 'ABSENT_NOT_JUSTIFIED', 'Sin marca de entrada.')
        continue
      }
      const late = rng.chance(0.05) ? rng.int(6, 20) : -rng.int(0, 12)
      writer.pair(p.id, eventId, ymd, plusMinutes(start, late), plusMinutes(end, rng.int(0, 15)), late > 5 ? 'LATE' : 'PRESENT', 'EXIT', late > 5 ? rng.pick(LATE_NOTES) : 'Entrada.', 'Salida.')
    }
  }
}

// ─── Pase de lista ──────────────────────────────────────────────────────────

type DayState = { kind: 'P' | 'A' | 'L' | 'E'; leaveAt?: Date; lateAt?: Date }

type RangeRec = {
  id: string
  student: StudentRec
  fromYmd: string
  toYmd: string
  reason: string
  notes: string | null
  createdById: string
  createdAt: Date
  revokedAt: Date | null
  revokedById: string | null
}

type IndividualJustification = { reason: string; createdById: string; createdAt: Date }

type RollCallCtx = {
  dayStates: Map<string, DayState>
  ranges: RangeRec[]
  individual: Map<string, IndividualJustification>
}

const stateKey = (studentId: string, ymd: string) => `${studentId}|${ymd}`

function adscriptoFor(course: CourseCode, ymd: string, leaves: LeaveRec[]): Person {
  const own = course === '9-EBI' ? 'ADS2' : 'ADS1'
  const other = own === 'ADS1' ? 'ADS2' : 'ADS1'
  return person(leaveOn(leaves, own, ymd) ? other : own)
}

/** Días de cada estudiante: presente, ausente, tarde o retirado antes, más sus justificativos. */
function simulateStudentDays(ctx: YearCtx, yearEnrollments: EnrollmentRec[], occs: Occ[], leaves: LeaveRec[]): RollCallCtx {
  const dayStates = new Map<string, DayState>()
  const ranges: RangeRec[] = []
  const individual = new Map<string, IndividualJustification>()
  const morningFirst = new Map<string, Occ>()
  const morningLast = new Map<string, Occ>()
  for (const o of occs) {
    if (o.event.afternoon) continue
    const k = `${o.event.course}|${o.ymd}`
    if (!morningFirst.has(k) || morningFirst.get(k)!.startAt > o.startAt) morningFirst.set(k, o)
    if (!morningLast.has(k) || morningLast.get(k)!.startAt < o.startAt) morningLast.set(k, o)
  }

  for (const enr of yearEnrollments) {
    const s = enr.student
    const rng = rngFor(`days-${ctx.year}-${s.id}`)
    const days = ctx.classDays.filter((d) => d <= TODAY && (!enr.untilYmd || d <= enr.untilYmd))
    const creatorFor = (ymd: string) => adscriptoFor(enr.course, ymd, leaves)

    // Viaje o competencia avisado de antemano: justificativo previo.
    const trips: Array<[string, string]> = []
    if (rng.chance(0.12) && days.length > 30) {
      const fromIdx = rng.int(10, days.length - 8)
      const len = rng.int(2, 5)
      const from = days[fromIdx]!
      const to = days[Math.min(days.length - 1, fromIdx + len - 1)]!
      trips.push([from, to])
      const created = officeTime(addDays(from, -rng.int(3, 9)), rng, 8, 13)
      const reason = rng.pick(D.JUSTIFICATION_REASONS_PLANNED)
      ranges.push({ id: uuid(), student: s, fromYmd: from, toYmd: to, reason, notes: 'Aviso de la familia por nota.', createdById: creatorFor(from).id, createdAt: created, revokedAt: null, revokedById: null })
    }
    // Un aviso que después se canceló: el justificativo queda revocado y el alumno vino.
    if (rng.chance(0.03) && days.length > 40) {
      const from = days[rng.int(10, days.length - 10)]!
      const to = addDays(from, 1)
      const created = officeTime(addDays(from, -5), rng, 8, 12)
      const revoked = officeTime(addDays(from, -2), rng, 8, 12)
      if (revoked.getTime() <= NOW.getTime()) {
        const by = creatorFor(from)
        ranges.push({ id: uuid(), student: s, fromYmd: from, toYmd: to, reason: 'Viaje familiar al interior', notes: 'La familia avisó que se suspendió el viaje.', createdById: by.id, createdAt: created, revokedAt: revoked, revokedById: by.id })
      }
    }

    // Enfermedad de varios días: casi siempre vuelve con certificado (justificativo posterior).
    const closeStreak = (from: string, to: string) => {
      const r = rngFor(`streak-${s.id}-${from}`)
      if (!r.chance(0.68)) return
      const createdAt = officeTime(addDays(to, r.int(1, 3)), r, 8, 13)
      if (createdAt.getTime() > NOW.getTime()) return
      ranges.push({
        id: uuid(),
        student: s,
        fromYmd: from,
        toYmd: to,
        reason: r.pick(D.JUSTIFICATION_REASONS_MEDICAL),
        notes: r.chance(0.3) ? 'Reposo indicado por el médico.' : null,
        createdById: creatorFor(from).id,
        createdAt,
        revokedAt: null,
        revokedById: null,
      })
    }

    let streakLeft = 0
    let streakStart = ''
    let lastStreakDay = ''
    for (const ymd of days) {
      const key = stateKey(s.id, ymd)
      if (trips.some(([a, b]) => a <= ymd && ymd <= b)) {
        dayStates.set(key, { kind: 'A' })
        continue
      }
      if (streakLeft > 0) {
        dayStates.set(key, { kind: 'A' })
        lastStreakDay = ymd
        streakLeft -= 1
        if (streakLeft === 0) closeStreak(streakStart, ymd)
        continue
      }
      if (rng.chance(0.003 + s.absenceRate * 0.05)) {
        streakStart = ymd
        lastStreakDay = ymd
        streakLeft = rng.int(2, 5) - 1
        dayStates.set(key, { kind: 'A' })
        continue
      }
      if (rng.chance(s.absenceRate)) {
        dayStates.set(key, { kind: 'A' })
        // Falta suelta: a veces la familia trae una constancia.
        if (rng.chance(0.22)) {
          const createdAt = officeTime(addDays(ymd, rng.int(1, 3)), rng, 8, 13)
          if (createdAt.getTime() <= NOW.getTime()) {
            const by = creatorFor(ymd)
            if (rng.chance(0.65)) {
              ranges.push({ id: uuid(), student: s, fromYmd: ymd, toYmd: ymd, reason: rng.pick(D.JUSTIFICATION_REASONS_MEDICAL), notes: null, createdById: by.id, createdAt, revokedAt: null, revokedById: null })
            } else {
              individual.set(key, { reason: rng.pick(['Constancia médica presentada', 'Nota de la familia', 'Trámite familiar con aviso']), createdById: by.id, createdAt })
            }
          }
        }
        continue
      }
      const first = morningFirst.get(`${enr.course}|${ymd}`)
      const last = morningLast.get(`${enr.course}|${ymd}`)
      if (first && rng.chance(s.lateRate)) {
        dayStates.set(key, { kind: 'L', lateAt: plusMinutes(first.startAt, rng.int(8, 30)) })
        continue
      }
      if (first && last && last !== first && rng.chance(0.006)) {
        const leaveAt = plusMinutes(last.startAt, -rng.int(5, 60))
        dayStates.set(key, { kind: 'E', leaveAt })
        continue
      }
      dayStates.set(key, { kind: 'P' })
    }
    if (streakLeft > 0) closeStreak(streakStart, lastStreakDay)
  }
  return { dayStates, ranges, individual }
}

function activeOn(enr: EnrollmentRec, ymd: string) {
  return !enr.untilYmd || ymd <= enr.untilYmd
}

const RETIRO = ['su madre', 'su padre', 'su abuela', 'un familiar autorizado'] as const

async function createRollCalls(ctx: YearCtx, yearEnrollments: EnrollmentRec[], occs: Occ[], leaves: LeaveRec[], rc: RollCallCtx) {
  const sessions: Prisma.StudentAttendanceSessionCreateManyInput[] = []
  const entries: Prisma.StudentAttendanceEntryCreateManyInput[] = []
  const justifications: Prisma.StudentAttendanceJustificationCreateManyInput[] = []
  const byCourse = new Map<CourseCode, EnrollmentRec[]>()
  for (const e of yearEnrollments) byCourse.set(e.course, [...(byCourse.get(e.course) ?? []), e])
  for (const list of byCourse.values()) list.sort((a, b) => a.student.lastName.localeCompare(b.student.lastName, 'es') || a.student.firstName.localeCompare(b.student.firstName, 'es'))

  const recentCut = addDays(TODAY, -8)
  const firstOfDay = new Set<string>()
  const lastSessionOfGroupDay = new Map<string, string>()
  const activeRanges = rc.ranges.filter((r) => !r.revokedAt)

  for (const o of occs) {
    if (!o.past) continue
    const rng = rngFor(`roll-${o.event.id}-${o.ymd}`)
    const pendingChance = ctx.year === 2026 ? (o.ymd >= recentCut ? 0.09 : 0.004) : 0.002
    if (rng.chance(pendingChance)) continue

    const takenBy = o.mode === 'UNCOVERED' ? adscriptoFor(o.event.course, o.ymd, leaves).id : o.teacherId
    let takenAt = plusMinutes(o.startAt, (o.teacherLateMinutes || 0) + rng.int(3, 14))
    const lateRoll = rng.next()
    if (lateRoll < 0.025) takenAt = plusMinutes(o.endAt, rng.int(1, 3) * 24 * 60 + rng.int(0, 300))
    else if (lateRoll < 0.1) takenAt = plusMinutes(o.endAt, rng.int(20, 240))
    takenAt = minDate(takenAt, NOW)

    const groupDay = `${o.event.course}|${o.ymd}`
    const previous = lastSessionOfGroupDay.get(groupDay)
    const copied = previous && rng.chance(0.06)
    const sessionId = uuid()
    o.sessionId = sessionId
    o.takenAt = takenAt
    lastSessionOfGroupDay.set(groupDay, sessionId)
    const roster = (byCourse.get(o.event.course) ?? []).filter((e) => activeOn(e, o.ymd))
    sessions.push({
      id: sessionId,
      eventId: o.event.id,
      eventFamilyId: o.event.id,
      occurrenceYmd: o.ymd,
      occurrenceDate: dayStart(o.ymd),
      startAt: o.startAt,
      endAt: o.endAt,
      schoolYearId: ctx.schoolYearId,
      courseOfferingId: o.event.offeringId,
      subjectId: o.event.subjectId,
      status: 'TAKEN',
      source: copied ? 'COPIED_FROM_PREVIOUS' : 'MANUAL',
      copiedFromSessionId: copied ? previous : null,
      takenByUserId: takenBy,
      takenAt,
      rosterSize: roster.length,
      notes: o.mode === 'UNCOVERED' ? 'Clase sin docente: la lista la pasó adscripción.' : null,
      createdAt: takenAt,
    })

    const isFirst = !o.event.afternoon && !firstOfDay.has(groupDay)
    if (isFirst) firstOfDay.add(groupDay)

    for (const enr of roster) {
      const s = enr.student
      const state = rc.dayStates.get(stateKey(s.id, o.ymd)) ?? { kind: 'P' }
      let status: StudentAttendanceStatus = 'PRESENT'
      let note: string | null = null
      if (state.kind === 'A') status = 'ABSENT'
      else if (state.kind === 'L' && isFirst) {
        status = 'LATE'
        note = `Llegó a las ${hhmm(state.lateAt!)}.`
      } else if (state.kind === 'E' && (o.event.afternoon || o.startAt.getTime() >= state.leaveAt!.getTime())) {
        status = 'ABSENT'
        if (!o.event.afternoon && o.startAt.getTime() - state.leaveAt!.getTime() < 50 * 60_000) {
          note = `Se retiró a las ${hhmm(state.leaveAt!)} con ${rngFor(`retiro-${s.id}-${o.ymd}`).pick(RETIRO)}.`
        }
      } else if (rngFor(`noise-${sessionId}-${s.id}`).chance(0.004)) {
        status = 'LATE'
        note = 'Volvió tarde del recreo.'
      }

      const entryId = uuid()
      if (status === 'ABSENT') {
        const range = activeRanges.find((r) => r.student.id === s.id && r.fromYmd <= o.ymd && o.ymd <= r.toYmd)
        const single = rc.individual.get(stateKey(s.id, o.ymd))
        if (range && range.createdAt.getTime() <= NOW.getTime()) {
          // Previo: entra justificada al pasar lista. Posterior: se justifica al cargarlo.
          const at = range.createdAt.getTime() <= takenAt.getTime() ? takenAt : range.createdAt
          status = 'ABSENT_JUSTIFIED'
          justifications.push({ entryId, type: 'ABSENCE', reason: range.reason, notes: range.notes, previousStatus: 'ABSENT', newStatus: 'ABSENT_JUSTIFIED', createdByUserId: range.createdById, createdAt: at, rangeId: range.id })
        } else if (single && single.createdAt.getTime() > takenAt.getTime()) {
          status = 'ABSENT_JUSTIFIED'
          justifications.push({ entryId, type: 'ABSENCE', reason: single.reason, previousStatus: 'ABSENT', newStatus: 'ABSENT_JUSTIFIED', createdByUserId: single.createdById, createdAt: single.createdAt })
        }
      }
      entries.push({
        id: entryId,
        sessionId,
        studentId: s.id,
        studentEnrollmentId: enr.id,
        status,
        note,
        studentLastName: s.lastName,
        studentFirstName: s.firstName,
        studentDocumentId: s.documentId,
        markedByUserId: takenBy,
        markedAt: takenAt,
        createdAt: takenAt,
      })
    }
  }

  await inChunks(sessions, 1000, (chunk) => prisma.studentAttendanceSession.createMany({ data: chunk }))
  await inChunks(entries, 5000, (chunk) => prisma.studentAttendanceEntry.createMany({ data: chunk }))
  await prisma.studentAbsenceJustificationRange.createMany({
    data: rc.ranges.map((r) => ({
      id: r.id,
      studentId: r.student.id,
      schoolYearId: ctx.schoolYearId,
      fromYmd: r.fromYmd,
      toYmd: r.toYmd,
      reason: r.reason,
      notes: r.notes,
      createdByUserId: r.createdById,
      createdAt: r.createdAt,
      revokedAt: r.revokedAt,
      revokedByUserId: r.revokedById,
    })),
  })
  await inChunks(justifications, 5000, (chunk) => prisma.studentAttendanceJustification.createMany({ data: chunk }))
  const audit: Prisma.AuditLogCreateManyInput[] = rc.ranges.flatMap((r) => {
    const rows: Prisma.AuditLogCreateManyInput[] = [
      { occurredAt: r.createdAt, action: 'STUDENT_ATTENDANCE_RANGE_JUSTIFIED', actorUserId: r.createdById, actorIp: '10.20.0.42', userAgent: USER_AGENT, entityType: 'StudentAbsenceJustificationRange', entityId: r.id, metadata: { studentId: r.student.id, fromYmd: r.fromYmd, toYmd: r.toYmd } },
    ]
    if (r.revokedAt) rows.push({ occurredAt: r.revokedAt, action: 'STUDENT_ATTENDANCE_RANGE_REVOKED', actorUserId: r.revokedById, actorIp: '10.20.0.42', userAgent: USER_AGENT, entityType: 'StudentAbsenceJustificationRange', entityId: r.id, metadata: { studentId: r.student.id } })
    return rows
  })
  await prisma.auditLog.createMany({ data: audit })
  return { sessions: sessions.length, entries: entries.length, ranges: rc.ranges.length, justifications: justifications.length }
}

// ─── Libretas ───────────────────────────────────────────────────────────────

type PeriodRec = {
  id: string
  code: string
  name: string
  kind: 'DIAGNOSTICO' | 'TRAMO' | 'ENTREGA'
  sortOrder: number
  isMeeting: boolean
  requiresGeneralGrade: boolean
  requiresConceptualJudgement: boolean
  startYmd: string | null
  endYmd: string | null
  closesYmd: string | null
}

type BookRec = { id: string; course: CourseCode; subject: string; subjectId: string; offeringId: string; titularKey: string; occs: Occ[] }

type GradeKeeper = {
  /** Notas de cada estudiante por (libreta, período): alimentan R. */
  values: Map<string, number[]>
  /** R de cada (libreta, período, estudiante). */
  r: Map<string, number>
}

const ymdOfPeriod = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)

async function loadPeriods(schoolYearId: string): Promise<PeriodRec[]> {
  const rows = await prisma.academicPeriod.findMany({
    where: { schoolYearId, level: 'EBI', isActive: true },
    orderBy: { sortOrder: 'asc' },
  })
  return rows.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    kind: p.kind,
    sortOrder: p.sortOrder,
    isMeeting: p.isMeeting,
    requiresGeneralGrade: p.requiresGeneralGrade,
    requiresConceptualJudgement: p.requiresConceptualJudgement,
    startYmd: ymdOfPeriod(p.startsOn),
    endYmd: ymdOfPeriod(p.endsOn),
    closesYmd: ymdOfPeriod(p.closesOn),
  }))
}

function tramosOf(entrega: PeriodRec, periods: PeriodRec[]): PeriodRec[] {
  const previous = periods.filter((p) => p.kind === 'ENTREGA' && p.sortOrder < entrega.sortOrder).reduce((m, p) => Math.max(m, p.sortOrder), -Infinity)
  return periods.filter((p) => p.kind === 'TRAMO' && p.sortOrder > previous && p.sortOrder < entrega.sortOrder)
}

function tier(v: number): 'alto' | 'medio' | 'bajo' {
  return v >= 8 ? 'alto' : v >= 5 ? 'medio' : 'bajo'
}

function informe(rng: Rng, r: number, conduct: number): string {
  const actitud = conduct >= 8 ? 'buena' : conduct >= 6 ? 'regular' : 'mala'
  return [rng.pick(D.INFORME_RENDIMIENTO[tier(r)]), rng.pick(D.INFORME_ACTITUD[actitud]), rng.pick(D.INFORME_SUGERENCIA[tier(r)])].join(' ')
}

function gradeValue(s: StudentRec, subject: string, rng: Rng, adjust: number): number {
  return clamp(Math.round(s.ability + (s.affinity.get(subject) ?? 0) + adjust + rng.normal(0, 0.95)), 1, 10)
}

function activityFor(subject: string, code: string): string {
  const practical = subject === 'Educación Física y Recreación' || subject === 'Comunicación Visual' || subject === 'Educación Musical'
  if (practical && code === 'ESCRITO') return 'TRABAJO_EN_CLASE'
  const lab = ['Biología', 'Química', 'Física', 'Ciencias Físico-Química'].includes(subject)
  if (lab && code === 'TRABAJO_DOMICILIARIO') return 'LABORATORIO'
  return code
}

function assessmentTitle(subject: string, code: string, topic: string, tramoCode: string): string {
  if (code === 'PRUEBA') {
    const n = tramoCode === 'JULIO' ? 'Prueba semestral' : '2.ª prueba semestral'
    return subject === 'Educación Física y Recreación' ? `${n} (práctica)` : n
  }
  const prefix: Record<string, string> = {
    ESCRITO: 'Escrito',
    TRABAJO_EN_CLASE: 'Trabajo en clase',
    TRABAJO_DOMICILIARIO: 'Trabajo domiciliario',
    PROYECTO: 'Proyecto',
    LABORATORIO: 'Laboratorio',
    ORAL: 'Oral',
  }
  return `${prefix[code] ?? 'Actividad'}: ${topic}`
}

async function provisionBooks(ctx: YearCtx, events: EventRec[], occs: Occ[]): Promise<BookRec[]> {
  await provisionGradeBooks(ctx.schoolYearId, prisma)
  const rows = await prisma.gradeBook.findMany({ where: { schoolYearId: ctx.schoolYearId }, select: { id: true, courseOfferingId: true, subjectId: true } })
  const books: BookRec[] = []
  for (const row of rows) {
    const event = events.find((e) => e.offeringId === row.courseOfferingId && e.subjectId === row.subjectId)
    if (!event) continue
    books.push({
      id: row.id,
      course: event.course,
      subject: event.subject,
      subjectId: event.subjectId,
      offeringId: event.offeringId,
      titularKey: event.teacherKey,
      occs: occs.filter((o) => o.event.offeringId === row.courseOfferingId && o.event.subjectId === row.subjectId),
    })
  }
  return books
}

type BookOutput = {
  assessments: Prisma.AssessmentCreateManyInput[]
  grades: Prisma.AssessmentGradeCreateManyInput[]
  revisions: Prisma.GradeRevisionCreateManyInput[]
  periods: Prisma.GradeBookPeriodCreateManyInput[]
  periodGrades: Prisma.PeriodGradeCreateManyInput[]
  endorsements: Prisma.EndorsementCreateManyInput[]
  messages: Prisma.GradeBookMessageCreateManyInput[]
  plannings: Prisma.GradeBookPlanningCreateManyInput[]
  development: Prisma.CourseDevelopmentEntryCreateManyInput[]
  audit: Prisma.AuditLogCreateManyInput[]
  notifications: Prisma.InAppNotificationCreateManyInput[]
}

const emptyOutput = (): BookOutput => ({ assessments: [], grades: [], revisions: [], periods: [], periodGrades: [], endorsements: [], messages: [], plannings: [], development: [], audit: [], notifications: [] })

type EntregaState = 'CLOSED' | 'PARTIAL' | 'EMPTY' | 'FUTURE'

/** Estado de una entrega según la fecha de corte; la que está en curso queda a medio cargar. */
function entregaState(p: PeriodRec, book: BookRec, rng: Rng, leaves: LeaveRec[]): { state: EntregaState; closedAt: Date | null; late: boolean } {
  const end = p.endYmd!
  const closes = p.closesYmd!
  const target = rng.chance(0.12) ? addDays(closes, rng.int(1, 6)) : addDays(end, rng.int(-3, Math.max(0, dayDiff(end, closes))))
  const closedAt = wall(target, rng.int(17, 22), rng.int(0, 59))
  if (closedAt.getTime() <= NOW.getTime()) {
    const onLeave = leaveOn(leaves, book.titularKey, target)
    if (!onLeave || dayDiff(target, TODAY) > 10) return { state: 'CLOSED', closedAt, late: target > closes }
  }
  if (TODAY < addDays(end, -12)) return { state: 'FUTURE', closedAt: null, late: false }
  return { state: rng.chance(0.6) ? 'PARTIAL' : 'EMPTY', closedAt: null, late: false }
}

const dayDiff = (a: string, b: string) => Math.round(dt(b).diff(dt(a), 'days').days)

function buildBook(
  ctx: YearCtx,
  book: BookRec,
  periods: PeriodRec[],
  roster: EnrollmentRec[],
  rc: RollCallCtx,
  leaves: LeaveRec[],
  scales: { gradeScaleId: string },
  activityTypes: Map<string, string>,
  keeper: GradeKeeper,
  out: BookOutput,
) {
  const titular = person(book.titularKey)
  const rngBook = rngFor(`book-${book.id}`)
  const topics = D.ASSESSMENT_TOPICS[book.subject] ?? ['Unidad de trabajo']
  let topicIndex = rngBook.int(0, 2)
  const occByYmd = new Map(book.occs.map((o) => [o.ymd, o] as const))
  const whoTeaches = (ymd: string) => {
    const o = occByYmd.get(ymd)
    return o && o.mode === 'COVERED' ? o.teacherId : titular.id
  }
  const isAbsent = (s: StudentRec, ymd: string) => {
    const st = rc.dayStates.get(stateKey(s.id, ymd))
    return st?.kind === 'A'
  }
  const activeAt = (ymd: string) => roster.filter((e) => activeOn(e, ymd) && e.createdAt.getTime() <= wall(ymd, 23, 0).getTime())

  // Planificación (marzo) y, a veces, una replanificación a mitad de año.
  const planAt = minDate(officeTime(addDays(ctx.cal.start, rngBook.int(10, 24)), rngBook, 17, 22), NOW)
  if (planAt.getTime() <= NOW.getTime() && planAt.getTime() > wall(ctx.cal.start, 0, 0).getTime()) {
    const units = topics.slice(0, 6).map((t, i) => `${i + 1}. ${t}`).join('\n')
    out.plannings.push({
      gradeBookId: book.id,
      formative: `Planificación anual de ${book.subject} para ${COURSE_LABEL[book.course]} año.\n\nUnidades previstas:\n${units}\n\nMetodología: trabajo en equipos, uso de la plataforma CREA y actividades prácticas. Evaluación continua con escritos, trabajos y una prueba por semestre.`,
      replanning: ctx.year === 2025 || TODAY > `${ctx.year}-08-10` ? (rngBook.chance(0.45) ? 'Se reorganizó el segundo semestre para recuperar las clases perdidas por paros y licencias; se priorizan las unidades 4 y 5.' : null) : null,
      attachments: rngBook.chance(0.3) ? 'Planificación en Drive del departamento.' : null,
      updatedByUserId: titular.id,
      createdAt: planAt,
      updatedAt: planAt,
    })
  }

  // Desarrollo del curso: lo que se dio en cada clase.
  const taught = book.occs.filter((o) => o.past)
  taught.forEach((o, i) => {
    const r = rngFor(`dev-${o.event.id}-${o.ymd}`)
    if (o.mode === 'UNCOVERED') {
      const at = minDate(officeTime(addDays(o.ymd, r.int(1, 4)), r, 18, 22), NOW)
      out.development.push({ gradeBookId: book.id, date: noon(o.ymd), hoursTaught: 0, hoursNotTaught: o.event.len, description: o.leave ? 'Clase no dictada: el docente estaba de licencia y no hubo suplente.' : 'Clase no dictada por inasistencia docente.', createdByUserId: titular.id, createdAt: at, updatedAt: at })
      return
    }
    if (!r.chance(o.mode === 'COVERED' ? 0.75 : 0.9)) return
    const topic = topics[Math.min(topics.length - 1, Math.floor((i / Math.max(1, book.occs.length)) * topics.length))]!
    const at = minDate(plusMinutes(o.endAt, r.int(5, 600)), NOW)
    out.development.push({
      gradeBookId: book.id,
      date: noon(o.ymd),
      hoursTaught: o.event.len,
      hoursNotTaught: 0,
      description: `${topic}. ${r.pick(D.DEVELOPMENT_ACTIVITIES)}${o.mode === 'COVERED' ? ' (Clase a cargo del suplente.)' : ''}`,
      createdByUserId: o.teacherId,
      createdAt: at,
      updatedAt: at,
    })
  })

  // Evaluaciones de cada tramo.
  for (const tramo of periods.filter((p) => p.kind === 'TRAMO' && p.code !== 'APE_DICIEMBRE')) {
    const plan = D.TRAMO_PLAN[tramo.code]
    if (!plan || !tramo.startYmd || !tramo.endYmd) continue
    const inWindow = book.occs.filter((o) => o.ymd >= tramo.startYmd! && o.ymd <= tramo.endYmd!)
    if (inWindow.length === 0) continue
    for (const [code, frac] of plan) {
      const idx = Math.min(inWindow.length - 1, Math.max(0, Math.round(frac * (inWindow.length - 1)) + rngBook.int(-1, 1)))
      const occ = inWindow[idx]!
      if (!occ.past) continue
      const activity = activityFor(book.subject, code)
      const topic = topics[topicIndex % topics.length]!
      topicIndex += 1
      const creator = whoTeaches(occ.ymd)
      const assessmentId = uuid()
      const createdAt = minDate(plusMinutes(occ.endAt, rngBook.int(10, 300)), NOW)
      out.assessments.push({
        id: assessmentId,
        gradeBookId: book.id,
        periodId: tramo.id,
        date: noon(occ.ymd),
        title: assessmentTitle(book.subject, activity, topic, tramo.code),
        activityTypeId: activityTypes.get(activity) ?? null,
        gradingScaleId: scales.gradeScaleId,
        scope: 'GROUP',
        createdByUserId: creator,
        createdAt,
        updatedAt: createdAt,
      })
      const gradedAt = plusMinutes(occ.endAt, rngBook.int(2, 9) * 24 * 60 + rngBook.int(0, 300))
      if (gradedAt.getTime() > NOW.getTime()) continue
      const written = activity === 'ESCRITO' || activity === 'PRUEBA'
      const adjust = activity === 'PRUEBA' ? -0.35 : written ? -0.1 : 0.45
      // En el tramo en curso el docente todavía está corrigiendo: quedan notas sin cargar.
      const stillGrading = tramo.endYmd! >= TODAY
      for (const enr of activeAt(occ.ymd)) {
        const s = enr.student
        const r = rngFor(`grade-${assessmentId}-${s.id}`)
        if (stillGrading && r.chance(0.04)) continue
        // Faltó: no rinde el escrito; un trabajo lo entrega igual la mayoría de las veces.
        const missed = isAbsent(s, occ.ymd) && (written || r.chance(0.4))
        const value = missed ? null : gradeValue(s, book.subject, r, adjust)
        const gradeId = uuid()
        out.grades.push({
          id: gradeId,
          assessmentId,
          studentId: s.id,
          studentEnrollmentId: enr.id,
          studentLastName: s.lastName,
          studentFirstName: s.firstName,
          studentDocumentId: s.documentId,
          valueHundredths: value === null ? null : value * 100,
          isAbsent: missed,
          comment: missed ? (written ? 'No rindió: faltó ese día.' : 'No entregó.') : value !== null && value <= 3 && r.chance(0.4) ? 'Debe rehacer el trabajo.' : null,
          gradedByUserId: creator,
          gradedAt,
          createdAt: gradedAt,
          updatedAt: gradedAt,
        })
        if (value !== null) {
          const k = `${book.id}|${tramo.id}|${s.id}`
          keeper.values.set(k, [...(keeper.values.get(k) ?? []), value])
          if (r.chance(0.015)) {
            const changedAt = minDate(plusMinutes(gradedAt, r.int(1, 5) * 24 * 60), NOW)
            out.revisions.push({ assessmentGradeId: gradeId, assessmentId, studentId: s.id, previousValueHundredths: (value >= 6 ? value - 1 : value + 1) * 100, newValueHundredths: value * 100, reason: 'Error de transcripción: se corrigió la nota.', origin: 'TEACHER', changedByUserId: creator, changedAt })
          }
        }
      }
    }

    // Notas sueltas desde la carta del alumno (orales, participación).
    const individuals = rngBook.shuffle(activeAt(tramo.endYmd!)).slice(0, rngBook.int(3, 8))
    for (const enr of individuals) {
      const occ = rngBook.pick(inWindow)
      if (!occ.past) continue
      const s = enr.student
      const r = rngFor(`ind-${book.id}-${tramo.id}-${s.id}`)
      const assessmentId = uuid()
      const creator = whoTeaches(occ.ymd)
      const at = minDate(plusMinutes(occ.endAt, r.int(5, 240)), NOW)
      const activity = r.chance(0.6) ? 'ORAL' : 'PARTICIPACION'
      const value = gradeValue(s, book.subject, r, 0.3)
      out.assessments.push({ id: assessmentId, gradeBookId: book.id, periodId: tramo.id, date: noon(occ.ymd), title: activity === 'ORAL' ? `Oral: ${r.pick(topics)}` : 'Participación en clase', activityTypeId: activityTypes.get(activity) ?? null, gradingScaleId: scales.gradeScaleId, scope: 'INDIVIDUAL', createdByUserId: creator, createdAt: at, updatedAt: at })
      out.grades.push({ assessmentId, studentId: s.id, studentEnrollmentId: enr.id, studentLastName: s.lastName, studentFirstName: s.firstName, studentDocumentId: s.documentId, valueHundredths: value * 100, gradedByUserId: creator, gradedAt: at, createdAt: at, updatedAt: at })
      const k = `${book.id}|${tramo.id}|${s.id}`
      keeper.values.set(k, [...(keeper.values.get(k) ?? []), value])
    }
  }

  // Diagnóstico (marzo): sólo texto.
  const diag = periods.find((p) => p.kind === 'DIAGNOSTICO')
  if (diag && diag.closesYmd) {
    const closeYmd = addDays(diag.closesYmd, -rngBook.int(0, 8))
    const closedAt = wall(closeYmd, rngBook.int(18, 22), rngBook.int(0, 59))
    if (closedAt.getTime() <= NOW.getTime()) {
      const gbpId = uuid()
      out.periods.push({ id: gbpId, gradeBookId: book.id, periodId: diag.id, status: 'CLOSED', closedByUserId: titular.id, closedAt, closedLate: false, createdAt: closedAt, updatedAt: closedAt })
      for (const enr of activeAt(diag.endYmd ?? ctx.cal.start)) {
        const r = rngFor(`diag-${book.id}-${enr.student.id}`)
        out.periodGrades.push({ gradeBookPeriodId: gbpId, studentId: enr.student.id, studentLastName: enr.student.lastName, studentFirstName: enr.student.firstName, studentDocumentId: enr.student.documentId, conceptualJudgement: r.pick(D.DIAGNOSTICO_TEXTS[tier(enr.student.ability + (enr.student.affinity.get(book.subject) ?? 0))]), updatedByUserId: titular.id, createdAt: closedAt, updatedAt: closedAt })
      }
    }
  }

  // Entregas: R, C (conducta) e informe; al cerrarse cierran también sus tramos.
  for (const entrega of periods.filter((p) => p.kind === 'ENTREGA')) {
    const rng = rngFor(`entrega-${book.id}-${entrega.code}`)
    const { state, closedAt, late } = entregaState(entrega, book, rng, leaves)
    const tramos = tramosOf(entrega, periods)
    if (state === 'FUTURE') {
      for (const tramo of tramos) {
        if (tramo.startYmd && tramo.startYmd <= TODAY) out.periods.push({ gradeBookId: book.id, periodId: tramo.id, status: 'OPEN', createdAt: wall(tramo.startYmd, 8, 0) })
      }
      continue
    }
    const roster = activeAt(entrega.endYmd!)
    const gbpId = uuid()
    const loadedAt = closedAt ?? minDate(officeTime(addDays(TODAY, -rng.int(0, 4)), rng, 18, 22), NOW)
    const groupReport = state === 'EMPTY' ? null : `${rng.pick(D.GROUP_REPORT_OPENINGS)} ${rng.pick(D.GROUP_REPORT_CLOSINGS)}`
    out.periods.push({
      id: gbpId,
      gradeBookId: book.id,
      periodId: entrega.id,
      status: state === 'CLOSED' ? 'CLOSED' : 'OPEN',
      closedByUserId: state === 'CLOSED' ? titular.id : null,
      closedAt: state === 'CLOSED' ? closedAt : null,
      closedLate: late,
      groupReport: state === 'CLOSED' || rng.chance(0.5) ? groupReport : null,
      groupReportUpdatedAt: groupReport ? loadedAt : null,
      groupReportUpdatedByUserId: groupReport ? titular.id : null,
      createdAt: loadedAt,
      updatedAt: loadedAt,
    })
    for (const tramo of tramos) {
      out.periods.push({
        gradeBookId: book.id,
        periodId: tramo.id,
        status: state === 'CLOSED' ? 'CLOSED' : 'OPEN',
        closedByUserId: state === 'CLOSED' ? titular.id : null,
        closedAt: state === 'CLOSED' ? closedAt : null,
        createdAt: tramo.startYmd ? wall(tramo.startYmd, 8, 0) : loadedAt,
        updatedAt: loadedAt,
      })
    }
    if (state === 'EMPTY') continue

    const entregaIndex = periods.filter((p) => p.kind === 'ENTREGA' && p.sortOrder < entrega.sortOrder).length
    for (const enr of roster) {
      const s = enr.student
      const r = rngFor(`pg-${book.id}-${entrega.id}-${s.id}`)
      const values = tramos.flatMap((t) => keeper.values.get(`${book.id}|${t.id}|${s.id}`) ?? [])
      // La R se mueve poco de una entrega a otra: pesa el nivel del alumno en la materia, con una
      // tendencia lenta propia (mejora o se cae), y las notas del tramo la ajustan.
      const trend = rngFor(`trend-${book.id}-${s.id}`).normal(0.05, 0.15)
      const level = s.ability + (s.affinity.get(book.subject) ?? 0) + trend * entregaIndex
      const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : level
      const rValue = clamp(Math.round(0.8 * level + 0.2 * mean + r.normal(0, 0.08)), 1, 10)
      const conduct = clamp(Math.round(s.conduct + r.normal(0, 0.6)), 1, 10)
      keeper.r.set(`${book.id}|${entrega.code}|${s.id}`, rValue)
      const partial = state === 'PARTIAL'
      out.periodGrades.push({
        gradeBookPeriodId: gbpId,
        studentId: s.id,
        studentLastName: s.lastName,
        studentFirstName: s.firstName,
        studentDocumentId: s.documentId,
        meetingValueHundredths: partial && r.chance(0.15) ? null : rValue * 100,
        conductValueHundredths: partial && r.chance(0.45) ? null : conduct * 100,
        conceptualJudgement: partial && r.chance(0.55) ? null : informe(r, rValue, conduct),
        updatedByUserId: titular.id,
        createdAt: loadedAt,
        updatedAt: loadedAt,
      })
    }

    if (state === 'CLOSED' && closedAt) {
      out.audit.push({ occurredAt: closedAt, action: 'GRADE_PERIOD_CLOSED', actorUserId: titular.id, actorIp: '10.20.0.77', userAgent: USER_AGENT, entityType: 'GradeBookPeriod', entityId: gbpId, metadata: { gradeBookId: book.id, period: entrega.code, late } })
      endorse(book, entrega, gbpId, closedAt, rng, out)
    }
    if (rng.chance(0.3)) {
      const at = wall(addDays(entrega.closesYmd!, -rng.int(2, 6)), rng.int(9, 12), rng.int(0, 59))
      if (at.getTime() <= NOW.getTime()) {
        const director = person(rng.chance(0.7) ? 'DIR' : 'SUBDIR')
        const msgId = uuid()
        out.messages.push({ id: msgId, gradeBookId: book.id, periodId: entrega.id, authorUserId: director.id, authorRoleCode: 'DIRECCION', body: rng.pick(D.DIRECTOR_MESSAGES), createdAt: at })
        const replyAt = plusMinutes(at, rng.int(120, 1800))
        if (replyAt.getTime() <= NOW.getTime() && rng.chance(0.8)) {
          out.messages.push({ gradeBookId: book.id, periodId: entrega.id, authorUserId: titular.id, authorRoleCode: 'TEACHER', body: rng.pick(D.TEACHER_REPLIES), parentId: msgId, createdAt: replyAt })
        }
        if (NOW.getTime() - at.getTime() < 10 * 86_400_000) {
          out.notifications.push({ userId: titular.id, type: 'GRADEBOOK_MESSAGE', title: 'Mensaje de Dirección', body: `${director.name} te escribió sobre ${book.subject} (${COURSE_LABEL[book.course]}).`, actionUrl: `/libreta/${book.id}`, createdAt: at })
        }
      }
    }
    if (state !== 'CLOSED' && ctx.year === 2026) {
      out.notifications.push({ userId: titular.id, type: 'GRADEBOOK_PERIOD_CLOSING', title: `${entrega.name}: cierra el ${dt(entrega.closesYmd!).toFormat('dd/MM')}`, body: `La libreta de ${book.subject} (${COURSE_LABEL[book.course]}) todavía tiene pendientes.`, actionUrl: `/libreta/${book.id}`, createdAt: minDate(wall(addDays(entrega.closesYmd!, -7), 8, 0), NOW) })
    }
  }
}

function endorse(book: BookRec, entrega: PeriodRec, gbpId: string, closedAt: Date, rng: Rng, out: BookOutput) {
  const director = person(rng.chance(0.7) ? 'DIR' : 'SUBDIR')
  let at = plusMinutes(closedAt, rng.int(2, 8) * 24 * 60)
  if (at.getTime() > NOW.getTime()) return
  if (rng.chance(0.12)) {
    out.endorsements.push({ gradeBookPeriodId: gbpId, section: 'JUDGEMENTS', status: 'OBSERVED', actorUserId: director.id, actorRoleCode: 'DIRECCION', observations: 'Revisar la redacción de algunos informes: que digan qué tiene que mejorar el estudiante.', occurredAt: at })
    const corrected = plusMinutes(at, rng.int(1, 3) * 24 * 60)
    if (corrected.getTime() > NOW.getTime()) return
    out.endorsements.push({ gradeBookPeriodId: gbpId, section: 'JUDGEMENTS', status: 'CORRECTED', actorUserId: person(book.titularKey).id, actorRoleCode: 'TEACHER', observations: 'Informes corregidos.', occurredAt: corrected })
    at = plusMinutes(corrected, rng.int(1, 2) * 24 * 60)
    if (at.getTime() > NOW.getTime()) return
  }
  for (const section of ['GRADES', 'CLOSURE', 'JUDGEMENTS', 'GROUP_REPORT', 'ALL'] as const) {
    out.endorsements.push({ gradeBookPeriodId: gbpId, section, status: 'ENDORSED', actorUserId: director.id, actorRoleCode: 'DIRECCION', occurredAt: plusMinutes(at, section === 'ALL' ? 5 : 0) })
  }
  out.audit.push({ occurredAt: at, action: 'GRADEBOOK_ENDORSED', actorUserId: director.id, actorIp: '10.20.0.11', userAgent: USER_AGENT, entityType: 'GradeBookPeriod', entityId: gbpId, metadata: { gradeBookId: book.id, period: entrega.code } })
}

async function writeBookOutput(out: BookOutput) {
  await inChunks(out.assessments, 2000, (c) => prisma.assessment.createMany({ data: c }))
  await inChunks(out.grades, 5000, (c) => prisma.assessmentGrade.createMany({ data: c }))
  await inChunks(out.revisions, 2000, (c) => prisma.gradeRevision.createMany({ data: c }))
  await inChunks(out.periods, 2000, (c) => prisma.gradeBookPeriod.createMany({ data: c }))
  await inChunks(out.periodGrades, 5000, (c) => prisma.periodGrade.createMany({ data: c }))
  await inChunks(out.endorsements, 2000, (c) => prisma.endorsement.createMany({ data: c }))
  const roots = out.messages.filter((m) => !m.parentId)
  const replies = out.messages.filter((m) => m.parentId)
  await prisma.gradeBookMessage.createMany({ data: roots })
  await prisma.gradeBookMessage.createMany({ data: replies })
  await prisma.gradeBookPlanning.createMany({ data: out.plannings })
  await inChunks(out.development, 2000, (c) => prisma.courseDevelopmentEntry.createMany({ data: c }))
  await inChunks(out.audit, 2000, (c) => prisma.auditLog.createMany({ data: c }))
  await inChunks(out.notifications, 2000, (c) => prisma.inAppNotification.createMany({ data: c }))
}

/** Reuniones de profesores y conducta institucional de adscripción en cada entrega cerrada. */
async function createMeetingsAndConduct(ctx: YearCtx, periods: PeriodRec[], yearEnrollments: EnrollmentRec[], keeper: GradeKeeper) {
  const meetings: Prisma.TeacherMeetingRecordCreateManyInput[] = []
  const conduct: Prisma.StudentConductRecordCreateManyInput[] = []
  for (const entrega of periods.filter((p) => p.kind === 'ENTREGA')) {
    const meetingYmd = addDays(entrega.closesYmd!, -1)
    const at = wall(meetingYmd, 15, 30)
    if (at.getTime() > NOW.getTime()) continue
    for (const course of D.COURSE_CODES) {
      const rng = rngFor(`meeting-${ctx.year}-${entrega.code}-${course}`)
      const roster = yearEnrollments.filter((e) => e.course === course && activeOn(e, entrega.endYmd!))
      const ads = person(course === '9-EBI' ? 'ADS2' : 'ADS1')
      const director = person('DIR')
      for (const decision of rng.shuffle(D.MEETING_GROUP_DECISIONS).slice(0, 2)) {
        meetings.push({ schoolYearId: ctx.schoolYearId, courseOfferingId: ctx.offeringByCourse.get(course)!, periodId: entrega.id, decision, createdByUserId: director.id, createdAt: at })
      }
      const struggling = roster
        .map((e) => ({ e, low: [...keeper.r.entries()].filter(([k, v]) => k.includes(`|${entrega.code}|${e.student.id}`) && v < 5).length }))
        .filter((x) => x.low >= 2)
        .slice(0, 4)
      for (const { e } of struggling) {
        meetings.push({ schoolYearId: ctx.schoolYearId, courseOfferingId: ctx.offeringByCourse.get(course)!, periodId: entrega.id, studentId: e.student.id, decision: rng.pick(D.MEETING_STUDENT_DECISIONS.slice(0, 4)), createdByUserId: ads.id, createdAt: plusMinutes(at, 30) })
      }
      for (const e of roster) {
        const r = rngFor(`conduct-${entrega.id}-${e.student.id}`)
        const value = clamp(Math.round(e.student.conduct + r.normal(0, 0.5)), 1, 10)
        conduct.push({ studentId: e.student.id, schoolYearId: ctx.schoolYearId, periodId: entrega.id, valueHundredths: value * 100, notes: value <= 5 ? r.pick(['Llamadas de atención reiteradas en el período.', 'Se trabajó con la familia acuerdos de convivencia.']) : null, updatedByUserId: ads.id, createdAt: minDate(plusMinutes(at, -60 * 24), NOW), updatedAt: minDate(plusMinutes(at, -60 * 24), NOW) })
      }
    }
  }
  await prisma.teacherMeetingRecord.createMany({ data: meetings })
  await inChunks(conduct, 3000, (c) => prisma.studentConductRecord.createMany({ data: c }))
}

// ─── Cierre de 2025: APE, materias pendientes y pase de año ─────────────────

async function closeYear2025(ctx: YearCtx, books: BookRec[], periods: PeriodRec[], yearEnrollments: EnrollmentRec[], keeper: GradeKeeper) {
  const apeDec = periods.find((p) => p.code === 'APE_DICIEMBRE')
  const apeFeb = periods.find((p) => p.code === 'APE_FEBRERO')
  const pendingRows: Prisma.StudentPendingSubjectCreateManyInput[] = []
  const periodRows: Prisma.GradeBookPeriodCreateManyInput[] = []
  const gradeRows: Prisma.PeriodGradeCreateManyInput[] = []
  const decGbp = new Map<string, string>()
  const febGbp = new Map<string, string>()

  for (const enr of yearEnrollments) {
    if (enr.status !== 'ACTIVE') {
      enr.academicResult = null
      continue
    }
    const s = enr.student
    const rng = rngFor(`ape-${s.id}`)
    const failing = books.filter((b) => b.course === enr.course && (keeper.r.get(`${b.id}|ENTREGA_4|${s.id}`) ?? 10) < 5)
    let remaining = 0
    for (const book of failing) {
      const passDec = rng.chance(s.ability >= 4.6 ? 0.55 : 0.3)
      const decTaken = rng.chance(0.92)
      let febResult: 'PASSED' | 'FAILED' | 'NOT_TAKEN' | null = null
      if (apeDec) {
        const gbp = decGbp.get(book.id) ?? uuid()
        if (!decGbp.has(book.id)) {
          decGbp.set(book.id, gbp)
          const at = wall('2025-12-19', 19, rng.int(0, 59))
          periodRows.push({ id: gbp, gradeBookId: book.id, periodId: apeDec.id, status: 'CLOSED', closedByUserId: person(book.titularKey).id, closedAt: at, createdAt: wall('2025-12-01', 9, 0), updatedAt: at })
        }
        if (decTaken) gradeRows.push({ gradeBookPeriodId: gbp, studentId: s.id, studentLastName: s.lastName, studentFirstName: s.firstName, studentDocumentId: s.documentId, meetingValueHundredths: (passDec ? rng.int(5, 7) : rng.int(2, 4)) * 100, updatedByUserId: person(book.titularKey).id, createdAt: wall('2025-12-18', 12, 0), updatedAt: wall('2025-12-18', 12, 0) })
      }
      const passedDec = decTaken && passDec
      if (!passedDec && apeFeb) {
        const roll = rng.next()
        febResult = roll < 0.5 ? 'PASSED' : roll < 0.85 ? 'FAILED' : 'NOT_TAKEN'
        const febAt = wall('2026-02-26', 19, rng.int(0, 59))
        if (febAt.getTime() <= NOW.getTime()) {
          const gbp = febGbp.get(book.id) ?? uuid()
          if (!febGbp.has(book.id)) {
            febGbp.set(book.id, gbp)
            periodRows.push({ id: gbp, gradeBookId: book.id, periodId: apeFeb.id, status: 'CLOSED', closedByUserId: person(book.titularKey).id, closedAt: febAt, createdAt: wall('2026-02-02', 9, 0), updatedAt: febAt })
          }
          if (febResult !== 'NOT_TAKEN') gradeRows.push({ gradeBookPeriodId: gbp, studentId: s.id, studentLastName: s.lastName, studentFirstName: s.firstName, studentDocumentId: s.documentId, meetingValueHundredths: (febResult === 'PASSED' ? rng.int(5, 6) : rng.int(2, 4)) * 100, conceptualJudgement: febResult === 'PASSED' ? 'Aprobó la instancia de APE de febrero.' : 'No alcanzó los logros mínimos en la APE de febrero.', updatedByUserId: person(book.titularKey).id, createdAt: febAt, updatedAt: febAt })
        } else {
          febResult = null
        }
      }
      const resolved = passedDec || febResult === 'PASSED'
      if (!resolved) remaining += 1
      pendingRows.push({
        studentId: s.id,
        schoolYearId: ctx.schoolYearId,
        subjectId: book.subjectId,
        origin: 'FAILED_THIS_YEAR',
        apeDecember: decTaken ? (passDec ? 'PASSED' : 'FAILED') : 'NOT_TAKEN',
        apeFebruary: passedDec ? null : febResult,
        resolvedAt: passedDec ? wall('2025-12-19', 12, 0) : febResult === 'PASSED' ? wall('2026-02-26', 12, 0) : null,
        notes: resolved ? null : 'La arrastra al año siguiente.',
        createdByUserId: person(enr.course === '9-EBI' ? 'ADS2' : 'ADS1').id,
        createdAt: wall('2025-12-12', 11, 0),
      })
    }
    enr.apeReferred = failing.length > 0
    if (enr.course === '7-EBI') enr.academicResult = remaining > 0 ? 'PROMOTED_WITH_PENDING' : 'PROMOTED'
    else enr.academicResult = remaining >= 3 ? 'REPEATED' : remaining > 0 ? 'PROMOTED_WITH_PENDING' : 'PROMOTED'
  }
  await prisma.gradeBookPeriod.createMany({ data: periodRows })
  await prisma.periodGrade.createMany({ data: gradeRows })
  await prisma.studentPendingSubject.createMany({ data: pendingRows })
  for (const enr of yearEnrollments) {
    if (enr.academicResult === undefined) continue
    const egresa = enr.course === '9-EBI' && enr.academicResult && enr.academicResult !== 'REPEATED'
    await prisma.studentEnrollment.update({
      where: { id: enr.id },
      data: {
        academicResult: enr.academicResult,
        apeReferred: enr.apeReferred ?? false,
        notes: egresa ? `${enr.notes} · Egresó de Educación Media Básica; continúa bachillerato en otro centro.` : enr.notes,
      },
    })
  }
  await prisma.gradeBook.updateMany({ where: { schoolYearId: ctx.schoolYearId }, data: { status: 'ARCHIVED' } })
  return { pending: pendingRows.length }
}

// ─── Matrículas ─────────────────────────────────────────────────────────────

async function writeEnrollments(ctx: YearCtx, list: EnrollmentRec[]) {
  await prisma.studentEnrollment.createMany({
    data: list.map((e) => ({
      id: e.id,
      studentId: e.student.id,
      schoolYearId: ctx.schoolYearId,
      courseOfferingId: ctx.offeringByCourse.get(e.course)!,
      enrollmentStatus: e.status,
      withdrawnAt: e.untilYmd ? wall(addDays(e.untilYmd, 1), 11, 0) : null,
      withdrawalAcademicYear: e.untilYmd ? ctx.year : null,
      notes: e.notes,
      createdAt: e.createdAt,
    })),
  })
}

function leaving(list: EnrollmentRec[], course: CourseCode, index: number, status: 'WITHDRAWN' | 'TRANSFERRED', untilYmd: string, note: string) {
  const target = list.filter((e) => e.course === course)[index]
  if (!target || untilYmd > TODAY) return
  target.status = status
  target.untilYmd = untilYmd
  target.notes = note
}

// ─── Cuotas ─────────────────────────────────────────────────────────────────

async function createTuition(ctx: YearCtx, list: EnrollmentRec[]) {
  const years: Prisma.StudentTuitionYearCreateManyInput[] = []
  const months: Prisma.StudentTuitionMonthCreateManyInput[] = []
  const annual = ctx.year === 2025 ? 980_000 : 1_050_000
  const monthly = ctx.year === 2025 ? 845_000 : 910_000
  for (const enr of list) {
    const rng = rngFor(`tuition-${ctx.year}-${enr.student.id}`)
    const scholarship = rngFor(`beca-${enr.student.id}`).chance(0.08)
    const profile = rng.next()
    const debtor = profile > 0.93
    const late = profile > 0.75
    const yearPaid = !debtor || rng.chance(0.5)
    const yearPaidAt = wall(`${ctx.year}-02-${String(rng.int(10, 27)).padStart(2, '0')}`, rng.int(9, 17), rng.int(0, 59))
    years.push({ studentId: enr.student.id, schoolYearId: ctx.schoolYearId, year: ctx.year, paid: yearPaid, paidAt: yearPaid ? yearPaidAt : null, amountCents: scholarship ? annual / 2 : annual, notes: scholarship ? 'Beca del 50 %.' : yearPaid ? 'Matrícula abonada.' : 'Plan de pagos acordado con tesorería.', createdAt: wall(`${ctx.year}-02-01`, 9, 0) })
    const skipped = new Set(debtor ? rng.shuffle([4, 5, 6, 7, 8, 9]).slice(0, rng.int(2, 4)) : [])
    for (let month = 3; month <= 12; month += 1) {
      const first = `${ctx.year}-${String(month).padStart(2, '0')}-01`
      if (enr.untilYmd && first > enr.untilYmd) break
      const due = first
      const day = late ? rng.int(11, 27) : rng.int(1, 10)
      const paidAt = wall(`${due.slice(0, 8)}${String(day).padStart(2, '0')}`, rng.int(9, 18), rng.int(0, 59))
      const paid = !skipped.has(month) && paidAt.getTime() <= NOW.getTime()
      months.push({
        studentId: enr.student.id,
        schoolYearId: ctx.schoolYearId,
        year: ctx.year,
        month,
        paid,
        paidAt: paid ? paidAt : null,
        amountCents: scholarship ? monthly / 2 : monthly,
        notes: paid ? (late ? 'Pago fuera de fecha.' : null) : first > TODAY ? null : skipped.has(month) ? 'Adeudada: tesorería se comunicó con la familia.' : 'Pendiente.',
        createdAt: wall(`${ctx.year}-02-01`, 9, 0),
      })
    }
  }
  await prisma.studentTuitionYear.createMany({ data: years })
  await inChunks(months, 3000, (c) => prisma.studentTuitionMonth.createMany({ data: c }))
}

// ─── Adecuaciones, alertas y avisos ─────────────────────────────────────────

async function createAccommodations(list: EnrollmentRec[]) {
  const ads = person('ADS1')
  const picks = rngFor('accommodations').shuffle(list.filter((e) => e.status === 'ACTIVE')).slice(0, 7)
  const summaries: Array<['CURRICULAR' | 'EVALUATION' | 'ACCESSIBILITY' | 'OTHER', string]> = [
    ['EVALUATION', 'Más tiempo en escritos y pruebas; consignas segmentadas y leídas en voz alta.'],
    ['EVALUATION', 'Evaluar preferentemente de forma oral; no penalizar la ortografía.'],
    ['ACCESSIBILITY', 'Ubicarlo cerca del pizarrón y con buena iluminación; materiales con letra ampliada.'],
    ['CURRICULAR', 'Contenidos priorizados en Matemática según el plan acordado con el equipo multidisciplinario.'],
    ['ACCESSIBILITY', 'Puede salir del aula unos minutos si lo necesita; avisar a adscripción.'],
    ['EVALUATION', 'Permitir el uso de calculadora y tablas en todas las evaluaciones.'],
    ['OTHER', 'Acompañamiento de una tutora externa los martes en la primera hora.'],
  ]
  await prisma.studentAccommodation.createMany({
    data: picks.map((e, i) => ({
      studentId: e.student.id,
      kind: summaries[i]![0],
      summary: summaries[i]![1],
      externalUrl: null,
      validFrom: noon(`${e.year}-03-20`),
      validUntil: noon(`${e.year}-12-15`),
      createdByUserId: ads.id,
      updatedByUserId: ads.id,
      createdAt: wall(`${e.year}-03-20`, 11, 0),
    })),
  })
}

async function createStudentAlerts(ctx: YearCtx) {
  const candidates = await collectAlertCandidates(ctx.schoolYearId)
  const fallback = ctx.year === 2025 ? wall('2025-11-28', 12, 0) : minDate(NOW, NOW)
  await prisma.studentAlert.createMany({
    data: candidates.map((c) => ({ schoolYearId: ctx.schoolYearId, studentId: c.studentId, type: c.type, key: c.key, payload: c.payload as Prisma.InputJsonValue, createdAt: fallback })),
    skipDuplicates: true,
  })
  return candidates.length
}

async function createRecentNotifications(occs: Occ[], alerts: number) {
  const rows: Prisma.InAppNotificationCreateManyInput[] = []
  const directors = [person('DIR'), person('SUBDIR')]
  const admins = await prisma.user.findMany({ where: { orgRole: { code: 'ADMIN' } }, select: { id: true } })
  const recentSubs = occs.filter((o) => o.mode === 'COVERED' && o.ymd >= addDays(TODAY, -3) && o.ymd <= addDays(TODAY, 10))
  const notified = new Set<string>()
  for (const o of recentSubs) {
    if (notified.has(o.teacherId)) continue
    notified.add(o.teacherId)
    rows.push({ userId: o.teacherId, type: 'EVENT_ASSIGNED', title: 'Tenés una suplencia asignada', body: `${o.event.subject} de ${COURSE_LABEL[o.event.course]}, desde el ${dt(o.ymd).toFormat('dd/MM')}. Ya podés pasar la lista y cargar tus notas.`, actionUrl: '/me/roll-call', createdAt: minDate(wall(addDays(o.ymd, -1), 12, 0), NOW) })
  }
  const lateRolls = occs
    .filter((o) => o.takenAt && o.ymd >= addDays(TODAY, -7) && o.takenAt.getTime() - o.endAt.getTime() > 60 * 60_000)
    .slice(-3)
  for (const o of lateRolls) {
    for (const u of [...directors, ...admins]) {
      const who = [...people.values()].find((p) => p.id === o.teacherId) ?? person(o.event.teacherKey)
      rows.push({ userId: u.id, type: 'ROLL_CALL_LATE', title: 'Lista pasada fuera de hora', body: `${who.name} pasó la lista de ${o.event.subject} (${COURSE_LABEL[o.event.course]}) del ${dt(o.ymd).toFormat('dd/MM')} después de terminada la clase.`, actionUrl: '/admin/student-attendance', createdAt: o.takenAt!, readAt: u.id === directors[0]!.id ? minDate(plusMinutes(o.takenAt!, 600), NOW) : null })
    }
  }
  if (alerts > 0) {
    for (const u of [...directors, person('ADS1'), person('ADS2'), ...admins]) {
      rows.push({ userId: u.id, type: 'STUDENT_ALERT', title: 'Alertas de estudiantes', body: 'Faltas seguidas o estudiantes que llegaron a 18 o 25 faltas. Revisalas en Reportes.', actionUrl: '/admin/student-attendance', createdAt: minDate(wall(addDays(TODAY, -2), 9, 15), NOW) })
    }
  }
  await prisma.inAppNotification.createMany({ data: rows })
}

async function createLoginAudit() {
  const rows: Prisma.AuditLogCreateManyInput[] = []
  const days = eachYmd(addDays(TODAY, -21), TODAY).filter((d) => weekday(d) >= 1 && weekday(d) <= 5)
  for (const p of people.values()) {
    if (p.spec.leftAfter2025) continue
    for (const ymd of days) {
      const rng = rngFor(`login-${p.key}-${ymd}`)
      if (!rng.chance(p.spec.role === 'TEACHER' ? 0.55 : 0.85)) continue
      const at = wall(ymd, rng.int(7, 20), rng.int(0, 59))
      if (at.getTime() > NOW.getTime()) continue
      rows.push({ occurredAt: at, action: 'AUTH_LOGIN_SUCCESS', actorUserId: p.id, actorIp: `190.64.${rng.int(1, 254)}.${rng.int(1, 254)}`, userAgent: USER_AGENT, entityType: 'User', entityId: p.id, metadata: { method: 'keycloak' } })
    }
  }
  await prisma.auditLog.createMany({ data: rows })
}

// ─── Un año completo ────────────────────────────────────────────────────────

async function seedYear(ctx: YearCtx, yearEnrollments: EnrollmentRec[], bio: Biometric) {
  log(`── ${ctx.year} ──`)
  const events = await createClassEvents(ctx)
  await createInstitutionalEvents(ctx)
  const leaves = await createLeaves(ctx)
  const occs = expandOccurrences(ctx, events, leaves)
  const subs = await createSubstitutions(ctx, occs)
  log(`Horario: ${events.length} series de clase, ${occs.length} clases en el año, ${leaves.length} licencias, ${subs} suplencias`)

  const writer = new AttendanceWriter(bio, ctx.schoolYearId)
  teacherAttendance(ctx, occs, writer)
  staffAttendance(ctx, leaves, writer)
  await writer.flush()
  log(`Asistencia del personal: ${writer.attendance.length} marcas, ${writer.punches.length} fichadas del reloj`)

  const rc = simulateStudentDays(ctx, yearEnrollments, occs, leaves)
  const roll = await createRollCalls(ctx, yearEnrollments, occs, leaves, rc)
  log(`Pase de lista: ${roll.sessions} listas, ${roll.entries} marcas, ${roll.ranges} justificativos, ${roll.justifications} faltas justificadas`)

  const books = await provisionBooks(ctx, events, occs)
  const periods = await loadPeriods(ctx.schoolYearId)
  const scale = await prisma.gradingScale.findUniqueOrThrow({ where: { code: 'NUMERICA_1_10' }, select: { id: true } })
  const types = await prisma.activityType.findMany({ where: { scope: 'GLOBAL' }, select: { id: true, code: true } })
  const activityTypes = new Map(types.map((t) => [t.code, t.id]))
  const keeper: GradeKeeper = { values: new Map(), r: new Map() }
  const out = emptyOutput()
  for (const book of books) {
    const roster = yearEnrollments.filter((e) => e.course === book.course)
    buildBook(ctx, book, periods, roster, rc, leaves, { gradeScaleId: scale.id }, activityTypes, keeper, out)
  }
  await writeBookOutput(out)
  await createMeetingsAndConduct(ctx, periods, yearEnrollments, keeper)
  log(`Libretas: ${books.length}, ${out.assessments.length} evaluaciones, ${out.grades.length} notas, ${out.periodGrades.length} notas de período, ${out.endorsements.length} visados`)
  return { occs, books, periods, keeper }
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL no está definida')
  log(`Corte: ${NOW.toISOString()} (${TODAY}, ${TZ})`)
  if (DRY_RUN) {
    await describeWipe()
    log('Dry run: no se modificó nada.')
    return
  }
  if (process.env.SEED_CONFIRM !== 'borrar-todo') {
    throw new Error('Este seed BORRA los datos operativos. Revisá con --dry-run y corré con SEED_CONFIRM=borrar-todo.')
  }

  await ensureBuiltinOrgRoles()
  await ensureDefaultProfilePermissionsIfNeeded()
  await prisma.systemSettings.upsert({ where: { id: 'default' }, create: { id: 'default' }, update: {} })
  await wipe()
  if ((await prisma.user.count({ where: { orgRole: { code: 'ADMIN' } } })) === 0) await ensureBootstrapAdmin()

  const years = await setupYears()
  const y25 = years.get(2025)!
  const y26 = years.get(2026)!
  await createStaff()
  const bio = await createBiometricDevice()

  // Estudiantes de 2025: tres grupos, con algunos hermanos repartidos entre cursos.
  const families: StudentRec['family'][] = []
  const e2025: EnrollmentRec[] = []
  const cohorts2025: Array<[CourseCode, number, number]> = [['7-EBI', 31, 2012], ['8-EBI', 29, 2011], ['9-EBI', 27, 2010]]
  for (const [course, count, birthYear] of cohorts2025) {
    for (let i = 0; i < count; i += 1) {
      const sibling = course !== '7-EBI' && i % 9 === 4 && families.length > 0 ? families.shift() : undefined
      const s = makeStudent(`2025-${course}`, i, rngFor(`by-${course}-${i}`).chance(0.12) ? birthYear - 1 : birthYear, rngFor(`school-${course}-${i}`).pick(D.PRIMARY_SCHOOLS), `2025-02-${String(10 + (i % 15)).padStart(2, '0')}`, sibling ?? undefined)
      if (course === '7-EBI' && i % 8 === 2) families.push(s.family)
      e2025.push({ id: uuid(), student: s, year: 2025, course, status: 'ACTIVE', untilYmd: null, notes: 'Matrícula activa.', createdAt: wall('2025-02-26', 10, 0) })
    }
  }
  leaving(e2025, '8-EBI', 6, 'TRANSFERRED', '2025-05-09', 'Pase al Liceo N.º 41 por mudanza de la familia.')
  leaving(e2025, '9-EBI', 11, 'WITHDRAWN', '2025-08-29', 'Dejó de concurrir. Adscripción hizo el seguimiento con la familia.')
  leaving(e2025, '7-EBI', 19, 'TRANSFERRED', '2025-10-03', 'Pase a un liceo de Canelones.')

  // Ingresos de 2026 (7.º y pases de otros liceos): los registros existen desde febrero de 2026.
  const new2026: Array<[CourseCode, StudentRec]> = []
  for (let i = 0; i < 32; i += 1) {
    const sibling = i % 10 === 3 && families.length > 0 ? families.shift() : undefined
    new2026.push(['7-EBI', makeStudent('2026-7-EBI', i, rngFor(`by26-${i}`).chance(0.1) ? 2012 : 2013, rngFor(`school26-${i}`).pick(D.PRIMARY_SCHOOLS), `2026-02-${String(9 + (i % 16)).padStart(2, '0')}`, sibling ?? undefined)])
  }
  for (const [course, n, birthYear] of [['8-EBI', 2, 2012], ['9-EBI', 2, 2011]] as const) {
    for (let i = 0; i < n; i += 1) new2026.push([course, makeStudent(`2026-pase-${course}`, i, birthYear, rngFor(`pase-${course}-${i}`).pick(D.OTHER_LICEOS), '2026-02-23')])
  }
  await createStudentsAndUsernames()
  log(`Estudiantes: ${students.length}`)

  await writeEnrollments(y25, e2025)
  const r2025 = await seedYear(y25, e2025, bio)
  const closing = await closeYear2025(y25, r2025.books, r2025.periods, e2025, r2025.keeper)
  await createTuition(y25, e2025)
  const alerts25 = await createStudentAlerts(y25)
  log(`Cierre 2025: ${closing.pending} materias a APE; alertas: ${alerts25}`)

  // Pase de año: 7.º → 8.º, 8.º → 9.º salvo los que repiten; 9.º egresa.
  const e2026: EnrollmentRec[] = []
  const passAt = wall('2026-02-27', 10, 0)
  for (const prev of e2025) {
    if (prev.status !== 'ACTIVE') continue
    const repeats = prev.academicResult === 'REPEATED'
    let course: CourseCode | null = null
    if (prev.course === '7-EBI') course = '8-EBI'
    else if (prev.course === '8-EBI') course = repeats ? '8-EBI' : '9-EBI'
    else if (repeats) course = '9-EBI'
    if (!course) continue
    e2026.push({ id: uuid(), student: prev.student, year: 2026, course, status: 'ACTIVE', untilYmd: null, notes: repeats ? 'Repite en el nuevo ciclo' : 'Promovido al nuevo ciclo', createdAt: passAt })
  }
  for (const [course, s] of new2026) {
    e2026.push({ id: uuid(), student: s, year: 2026, course, status: 'ACTIVE', untilYmd: null, notes: course === '7-EBI' ? 'Ingreso a 7.º.' : 'Pase desde otro liceo.', createdAt: wall('2026-02-25', 11, 0) })
  }
  leaving(e2026, '7-EBI', 27, 'TRANSFERRED', '2026-04-24', 'Pase a un colegio de Ciudad de la Costa.')
  leaving(e2026, '8-EBI', 14, 'WITHDRAWN', '2026-08-21', 'Dejó de concurrir; se dio aviso a la familia y al programa de seguimiento.')
  await writeEnrollments(y26, e2026)
  const r2026 = await seedYear(y26, e2026, bio)
  await createTuition(y26, e2026)
  await createAccommodations(e2026)
  const alerts26 = await createStudentAlerts(y26)
  await createRecentNotifications(r2026.occs, alerts26)
  await createLoginAudit()

  const counts = {
    estudiantes: await prisma.student.count(),
    matriculas: await prisma.studentEnrollment.count(),
    listas: await prisma.studentAttendanceSession.count(),
    marcasLista: await prisma.studentAttendanceEntry.count(),
    libretas: await prisma.gradeBook.count(),
    notas: await prisma.assessmentGrade.count(),
    asistenciasPersonal: await prisma.attendance.count(),
  }
  log(`Listo. ${JSON.stringify(counts)}`)
  log(`Alertas 2026: ${alerts26}. Clave de todas las cuentas sembradas: ${SKIP_KEYCLOAK ? '(Keycloak omitido)' : PASSWORD}`)
  console.log('')
  for (const p of people.values()) console.log(`   ${p.spec.role.padEnd(10)} ${p.username.padEnd(28)} ${p.name} — ${p.spec.title}${p.spec.leftAfter2025 ? ' (de baja)' : ''}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
