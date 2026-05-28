/**
 * Dataset realista EduTrack.
 *
 * Crea datos operativos coherentes para demo/servidor:
 * - Ciclos 2024, 2025 y 2026 con oferta variable.
 * - Estudiantes con avance historico de curso, egresos, retiros y traslados.
 * - Eventos recurrentes de clases reales por asignatura/curso/orientacion.
 * - Asistencias docentes historicas, licencias, sustituciones, incidencias,
 *   pagos mensuales/anuales, dispositivo biometrico y auditoria.
 *
 *   npx tsx prisma/seed-realistic-dataset.ts
 *   npm run seed:realistic
 */
import 'dotenv/config'
import crypto from 'node:crypto'
import argon2 from 'argon2'
import { PrismaClient } from '@prisma/client'
import type { AttendanceStatus, Event, User } from '@prisma/client'
import { DateTime } from 'luxon'
import { seedAcademicCatalog } from './seed-academic-catalog.js'
import { runBootstrap } from './seed-bootstrap.js'
import { seedTeachers } from './seed-teachers.js'
import { APP_TIMEZONE, uruguayWallToUtc } from '../src/config/app-timezone.js'

const prisma = new PrismaClient()

const SCHOOL_YEAR_DATES: Record<number, { start: string; end: string; attendanceUntil: string }> = {
  2024: { start: '2024-03-04', end: '2024-11-29', attendanceUntil: '2024-11-29' },
  2025: { start: '2025-03-03', end: '2025-12-05', attendanceUntil: '2025-12-05' },
  2026: { start: '2026-03-02', end: '2026-12-11', attendanceUntil: '2026-05-27' },
}

const COURSE_OFFERS: Record<number, Record<string, boolean>> = {
  2024: {
    '7-EBI': true,
    '8-EBI': true,
    '9-EBI': true,
    '1-EMS': true,
    '2-EMS': true,
    '3-EMS': true,
  },
  2025: {
    '7-EBI': true,
    '8-EBI': true,
    '9-EBI': true,
    '1-EMS': true,
    '2-EMS': true,
    '3-EMS': true,
  },
  2026: {
    '7-EBI': true,
    '8-EBI': true,
    '9-EBI': true,
    '1-EMS': true,
    '2-EMS': false,
    '3-EMS': true,
  },
}

const ORIENTATION_OFFERS: Record<number, Record<string, string[]>> = {
  2024: {
    '2-EMS': ['CIENCIAS-VIDA', 'CIENCIA-TECNOLOGIA', 'CSOCIALES-HUMANIDADES'],
  },
  2025: {
    '2-EMS': ['CREATIVO-ARTISTICO', 'CIENCIAS-VIDA', 'CIENCIA-TECNOLOGIA', 'CSOCIALES-HUMANIDADES'],
    '3-EMS': ['CIENCIAS-VIDA', 'CIENCIA-TECNOLOGIA', 'HH-CIENCIAS-ECONOMICAS'],
  },
  2026: {
    '3-EMS': [
      'CIENCIAS-VIDA',
      'CIENCIA-ARTE-DISENO',
      'CIENCIA-TECNOLOGIA',
      'HH-CIENCIAS-ECONOMICAS',
      'HH-CIENCIA-POLITICA',
    ],
  },
}

const SUBJECTS_BY_COURSE: Record<string, string[]> = {
  '7-EBI': ['Idioma Español', 'Matemática', 'Inglés', 'Biología', 'Historia', 'Ciencias Físico-Química', 'Educación Física y Recreación'],
  '8-EBI': ['Idioma Español', 'Matemática', 'Inglés', 'Geografía', 'Historia', 'Ciencias de la Computación', 'Educación Ciudadana'],
  '9-EBI': ['Literatura', 'Matemática', 'Inglés', 'Física', 'Química', 'Biología', 'Educación Ciudadana'],
  '1-EMS': ['Literatura', 'Matemática', 'Inglés', 'Física', 'Química', 'Filosofía', 'Historia'],
  '2-EMS': ['Literatura', 'Matemática', 'Inglés', 'Filosofía', 'Educación Ciudadana', 'Biología', 'Física'],
  '3-EMS': ['Inglés', 'Literatura', 'Metodología de la Investigación', 'Filosofía y Crítica de los Saberes'],
}

const ORIENTATION_SUBJECTS: Record<string, string[]> = {
  'CIENCIAS-VIDA': ['Química', 'Física', 'Biología Humana', 'Biología Vegetal', 'Matemática CV'],
  'CIENCIA-TECNOLOGIA': ['Matemática CTQ', 'Química', 'Física', 'Matemática CT'],
  'CIENCIA-ARTE-DISENO': ['Historia del Arte', 'Comunicación Visual y Diseño', 'Matemática CTA', 'Física CTA'],
  'HH-CIENCIAS-ECONOMICAS': ['Administración y Contabilidad', 'Economía y Educación Financiera', 'Historia Económica', 'Matemática CSH1'],
  'HH-CIENCIA-POLITICA': ['Derecho y Ciencia Política', 'Historia', 'Economía y Educación Financiera', 'Matemática CSH1'],
  'CSOCIALES-HUMANIDADES': ['Historia', 'Sociología', 'Geografía', 'Biología'],
  'CREATIVO-ARTISTICO': ['Historia del Arte', 'Música', 'Teatro', 'Danza'],
}

const CLASS_SLOTS = [
  { start: [7, 30], end: [8, 15] },
  { start: [8, 20], end: [9, 5] },
  { start: [9, 20], end: [10, 5] },
  { start: [10, 10], end: [10, 55] },
  { start: [11, 10], end: [11, 55] },
  { start: [12, 0], end: [12, 45] },
] as const

const STUDENT_FIRST_NAMES = [
  'Agustina',
  'Benjamín',
  'Camila',
  'Dante',
  'Emilia',
  'Facundo',
  'Guadalupe',
  'Hernán',
  'Isabella',
  'Joaquín',
  'Kiara',
  'Lautaro',
  'Martina',
  'Nahuel',
  'Olivia',
  'Pedro',
  'Renata',
  'Santino',
  'Thiago',
  'Valentina',
  'Abril',
  'Bruno',
  'Catalina',
  'Diego',
  'Emma',
  'Francisco',
  'Germán',
  'Helena',
  'Ignacio',
  'Julieta',
]

const STUDENT_LAST_NAMES = [
  'Acosta',
  'Barrios',
  'Cabrera',
  'Duarte',
  'Estevez',
  'Ferreira',
  'Giménez',
  'Hernández',
  'Ibarra',
  'Lemos',
  'Méndez',
  'Núñez',
  'Olivera',
  'Pintos',
  'Quiroga',
  'Ramos',
  'Suárez',
  'Techera',
  'Varela',
  'Zunino',
]

const TEACHER_POOLS: Record<string, string[]> = {
  matematica: ['ana.kelland', 'lucas.martinez', 'maximiliano.rodriguez', 'matias.scarenzio'],
  ciencias: ['gabriela.lopez', 'santiago.garrido', 'natalia.acosta', 'valentina.morales'],
  humanidades: ['cecilia.pereira', 'jorge.fernandez', 'rita.fernandez', 'veronica.nunez'],
  lenguas: ['leidy.gomez', 'lucia.cabrera', 'romina.sosa', 'luciana.rios'],
  arte: ['noelia.castro', 'rita.zabala', 'sharon.mendez', 'silvina.duarte'],
  gestion: ['eduardo.rodriguez', 'leandro.silva', 'luis.torres', 'marcelo.garcia', 'marcos.pereira'],
}

function stableHash(input: string) {
  let h = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function ratio(key: string) {
  return (stableHash(key) % 10_000) / 10_000
}

function intBetween(key: string, min: number, max: number) {
  return min + (stableHash(key) % (max - min + 1))
}

function pick<T>(items: readonly T[], key: string): T {
  return items[stableHash(key) % items.length]
}

function buildValidCi(baseNumber: number) {
  const base7 = String(Math.abs(baseNumber) % 9_999_999).padStart(7, '0')
  const weights = [2, 9, 8, 7, 6, 3, 4]
  const sum = base7.split('').reduce((acc, digit, index) => acc + Number(digit) * weights[index], 0)
  const checkDigit = (10 - (sum % 10)) % 10
  return `${base7}${checkDigit}`
}

function sha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function ymdToDate(ymd: string) {
  return uruguayWallToUtc(ymd, 0, 0)
}

function wall(ymd: string, hour: number, minute: number) {
  return uruguayWallToUtc(ymd, hour, minute)
}

function minutesToWall(ymd: string, minutes: number) {
  const normalized = Math.max(0, Math.min(23 * 60 + 59, minutes))
  return wall(ymd, Math.floor(normalized / 60), normalized % 60)
}

function toYmd(date: Date) {
  return DateTime.fromJSDate(date, { zone: 'utc' }).setZone(APP_TIMEZONE).toFormat('yyyy-MM-dd')
}

function wallMinutesFromStoredTime(date: Date) {
  const wallTime = DateTime.fromJSDate(date, { zone: 'utc' }).setZone(APP_TIMEZONE)
  return wallTime.hour * 60 + wallTime.minute
}

function weekday(ymd: string) {
  return DateTime.fromISO(ymd, { zone: APP_TIMEZONE }).weekday % 7
}

function eachYmd(start: string, end: string) {
  const days: string[] = []
  let cursor = DateTime.fromISO(start, { zone: APP_TIMEZONE }).startOf('day')
  const final = DateTime.fromISO(end, { zone: APP_TIMEZONE }).startOf('day')
  while (cursor <= final) {
    days.push(cursor.toFormat('yyyy-MM-dd'))
    cursor = cursor.plus({ days: 1 })
  }
  return days
}

function subjectArea(subjectName: string) {
  const s = subjectName.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  if (s.includes('matematica') || s.includes('contabilidad') || s.includes('economia') || s.includes('administracion')) return 'matematica'
  if (s.includes('fisica') || s.includes('quimica') || s.includes('biologia') || s.includes('astronomia')) return 'ciencias'
  if (s.includes('historia') || s.includes('filosofia') || s.includes('derecho') || s.includes('sociologia') || s.includes('geografia')) return 'humanidades'
  if (s.includes('ingles') || s.includes('literatura') || s.includes('espanol')) return 'lenguas'
  if (s.includes('arte') || s.includes('musica') || s.includes('danza') || s.includes('teatro') || s.includes('visual') || s.includes('diseño') || s.includes('diseno')) return 'arte'
  return 'gestion'
}

async function clearOperationalData() {
  console.log('[dataset] Limpiando datos operativos previos...')
  await prisma.attendanceJustification.deleteMany()
  await prisma.attendanceIncident.deleteMany()
  await prisma.biometricPunch.deleteMany()
  await prisma.attendance.deleteMany()
  await prisma.substitution.deleteMany()
  await prisma.medicalLeave.deleteMany()
  await prisma.event.updateMany({ data: { parentEventId: null } })
  await prisma.event.deleteMany()
  await prisma.studentTuitionMonth.deleteMany()
  await prisma.studentTuitionYear.deleteMany()
  await prisma.studentEnrollment.deleteMany()
  await prisma.student.deleteMany()
  await prisma.nonWorkingDay.deleteMany()
  await prisma.biometricLinkRequest.deleteMany()
  await prisma.biometricUserMapping.deleteMany()
  await prisma.biometricDevice.deleteMany()
  await prisma.inAppNotification.deleteMany()
  await prisma.auditLog.deleteMany()
}

async function ensureOfferingsForAllYears() {
  const schoolYears = await prisma.schoolYear.findMany({ select: { id: true, code: true } })
  const schoolYearByCode = new Map(schoolYears.map((row) => [row.code, row.id]))
  const courses = await prisma.course.findMany({ select: { id: true, code: true } })
  const orientations = await prisma.orientation.findMany({ select: { id: true, code: true } })
  const orientationByCode = new Map(orientations.map((row) => [row.code, row.id]))

  for (const [yearRaw, offers] of Object.entries(COURSE_OFFERS)) {
    const year = Number(yearRaw)
    const schoolYearId = schoolYearByCode.get(year)
    if (!schoolYearId) continue

    for (const course of courses) {
      if (!course.code) continue
      const offered = offers[course.code] ?? false
      await prisma.courseOffering.upsert({
        where: { courseId_schoolYearId: { courseId: course.id, schoolYearId } },
        create: {
          courseId: course.id,
          schoolYearId,
          isActive: offered,
          isOffered: offered,
          visibleInFilters: offered,
          notes: offered ? `Oferta realista ${year}` : `No ofertado en ${year}`,
        },
        update: {
          isActive: offered,
          isOffered: offered,
          visibleInFilters: offered,
          notes: offered ? `Oferta realista ${year}` : `No ofertado en ${year}`,
        },
      })

      const orientationCodes = ORIENTATION_OFFERS[year]?.[course.code] ?? []
      for (const orientationCode of orientationCodes) {
        const orientationId = orientationByCode.get(orientationCode)
        if (!orientationId) continue
        await (prisma as any).courseOrientation.upsert({
          where: { courseId_orientationId_schoolYearId: { courseId: course.id, orientationId, schoolYearId } },
          create: {
            courseId: course.id,
            orientationId,
            schoolYearId,
            isActive: true,
            isOffered: true,
            visibleInFilters: true,
            notes: `Orientacion ofertada ${year}`,
          },
          update: {
            isActive: true,
            isOffered: true,
            visibleInFilters: true,
            notes: `Orientacion ofertada ${year}`,
          },
        })
      }
    }
  }
}

async function seedNonWorkingDays() {
  const schoolYears = await prisma.schoolYear.findMany({ select: { id: true, code: true } })
  const byCode = new Map(schoolYears.map((row) => [row.code, row.id]))
  const rows = [
    ['2024-03-25', 2024, 'Semana de Turismo', 'Receso institucional'],
    ['2024-03-26', 2024, 'Semana de Turismo', 'Receso institucional'],
    ['2024-05-01', 2024, 'Dia de los Trabajadores', 'Feriado nacional'],
    ['2024-06-19', 2024, 'Natalicio de Artigas', 'Acto institucional sin clases'],
    ['2024-08-25', 2024, 'Declaratoria de la Independencia', 'Feriado nacional'],
    ['2025-04-14', 2025, 'Semana de Turismo', 'Receso institucional'],
    ['2025-04-15', 2025, 'Semana de Turismo', 'Receso institucional'],
    ['2025-05-01', 2025, 'Dia de los Trabajadores', 'Feriado nacional'],
    ['2025-07-18', 2025, 'Jura de la Constitucion', 'Feriado nacional'],
    ['2025-08-25', 2025, 'Declaratoria de la Independencia', 'Feriado nacional'],
    ['2026-04-02', 2026, 'Semana de Turismo', 'Receso institucional'],
    ['2026-04-03', 2026, 'Semana de Turismo', 'Receso institucional'],
    ['2026-05-01', 2026, 'Dia de los Trabajadores', 'Feriado nacional'],
    ['2026-05-18', 2026, 'Jornada de coordinacion docente', 'Sin clases para estudiantes'],
  ] as const

  await prisma.nonWorkingDay.createMany({
    data: rows.map(([date, year, reason, notes]) => ({
      date: ymdToDate(date),
      type: reason.includes('Dia') || reason.includes('Jura') || reason.includes('Declaratoria') ? 'HOLIDAY' : 'NON_WORKING_DAY',
      reason,
      notes,
      schoolYearId: byCode.get(year) ?? null,
    })),
    skipDuplicates: true,
  })
}

async function seedBiometricDevice(users: Array<Pick<User, 'id' | 'username' | 'email'>>) {
  const device = await prisma.biometricDevice.create({
    data: {
      code: 'F22-LICEO-CENTRAL',
      admsSerial: 'F22-UY-2026-001',
      name: 'ZKTeco F22 - Acceso principal',
      secretHash: sha256('liceo-f22-demo-secret'),
      timezone: APP_TIMEZONE,
      isActive: true,
      allowedIps: ['127.0.0.1', '10.10.0.25'],
      lastSeenAt: wall('2026-05-27', 18, 22),
    },
  })

  const mappings = new Map<string, { id: string; deviceUserId: string }>()
  for (const [index, user] of users.entries()) {
    const mapping = await prisma.biometricUserMapping.create({
      data: {
        deviceId: device.id,
        userId: user.id,
        deviceUserId: String(2001 + index),
        isActive: true,
      },
      select: { id: true, userId: true, deviceUserId: true },
    })
    mappings.set(user.id, { id: mapping.id, deviceUserId: mapping.deviceUserId })
  }

  return { device, mappings }
}

async function seedStudents() {
  const years = await prisma.schoolYear.findMany({ select: { id: true, code: true } })
  const schoolYearId = new Map(years.map((row) => [row.code, row.id]))
  const offerings = await prisma.courseOffering.findMany({
    include: { course: { select: { code: true, name: true } }, schoolYear: { select: { code: true } } },
  })
  const offeringId = new Map(offerings.map((row) => [`${row.schoolYear.code}:${row.course.code}`, row.id]))

  const plans: Array<{ count: number; path: Array<[number, string, 'ACTIVE' | 'WITHDRAWN' | 'GRADUATED' | 'TRANSFERRED']>; note: string }> = [
    { count: 18, path: [[2024, '7-EBI', 'ACTIVE'], [2025, '8-EBI', 'ACTIVE'], [2026, '9-EBI', 'ACTIVE']], note: 'Cohorte EBI con avance regular' },
    { count: 14, path: [[2024, '8-EBI', 'ACTIVE'], [2025, '9-EBI', 'ACTIVE'], [2026, '1-EMS', 'ACTIVE']], note: 'Cohorte de pasaje a EMS' },
    { count: 10, path: [[2024, '9-EBI', 'ACTIVE'], [2025, '1-EMS', 'ACTIVE'], [2026, '1-EMS', 'ACTIVE']], note: 'Trayectorias con recursado parcial' },
    { count: 12, path: [[2024, '1-EMS', 'ACTIVE'], [2025, '2-EMS', 'ACTIVE'], [2026, '3-EMS', 'ACTIVE']], note: 'Trayectoria EMS completa' },
    { count: 8, path: [[2024, '3-EMS', 'GRADUATED']], note: 'Egreso historico 2024' },
    { count: 10, path: [[2025, '7-EBI', 'ACTIVE'], [2026, '8-EBI', 'ACTIVE']], note: 'Ingreso 2025' },
    { count: 14, path: [[2026, '7-EBI', 'ACTIVE']], note: 'Ingreso 2026' },
  ]

  let index = 0
  let created = 0
  for (const plan of plans) {
    for (let i = 0; i < plan.count; i += 1) {
      const firstName = STUDENT_FIRST_NAMES[index % STUDENT_FIRST_NAMES.length]
      const lastName = `${STUDENT_LAST_NAMES[index % STUDENT_LAST_NAMES.length]} ${STUDENT_LAST_NAMES[(index * 7 + 3) % STUDENT_LAST_NAMES.length]}`
      const documentId = buildValidCi(3_100_000 + index * 37)
      const student = await prisma.student.create({
        data: {
          firstName,
          lastName,
          documentId,
          contactPhone: `+5989${intBetween(`phone-a-${index}`, 1000000, 9999999)}`,
          tutorPhone: `+5989${intBetween(`phone-b-${index}`, 1000000, 9999999)}`,
          contactEmail: `${firstName.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')}.${lastName
            .split(' ')[0]
            .toLowerCase()
            .normalize('NFD')
            .replace(/\p{M}/gu, '')}${index}@familias.liceo.test`,
          address: `${pick(['Rivera', 'Artigas', 'Lavalleja', 'Sarandi', 'Rincon', 'Treinta y Tres'], `street-${index}`)} ${intBetween(`door-${index}`, 1000, 4999)}`,
          healthCardExpiresAt: wall(`${2026 + (index % 3)}-${String(3 + (index % 7)).padStart(2, '0')}-15`, 12, 0),
          liceoAccessNotes: index % 11 === 0 ? 'Tutor solicita recibir avisos por telefono antes de correo.' : null,
          internalNotes: `${plan.note}. Escolaridad generada para dataset realista.`,
          createdAt: wall(`${plan.path[0][0]}-02-10`, 10, index % 50),
        },
      })

      for (const [year, courseCode, status] of plan.path) {
        const adjustedStatus =
          plan.note.includes('recursado') && year === 2026 && i >= 6
            ? i % 2 === 0
              ? 'TRANSFERRED'
              : 'WITHDRAWN'
            : status
        const withdrawnAt =
          adjustedStatus === 'WITHDRAWN'
            ? wall(`${year}-06-${String(5 + (i % 12)).padStart(2, '0')}`, 12, 0)
            : adjustedStatus === 'TRANSFERRED'
              ? wall(`${year}-03-${String(20 + (i % 6)).padStart(2, '0')}`, 12, 0)
              : null
        await prisma.studentEnrollment.create({
          data: {
            studentId: student.id,
            schoolYearId: schoolYearId.get(year)!,
            courseOfferingId: offeringId.get(`${year}:${courseCode}`)!,
            enrollmentStatus: adjustedStatus,
            withdrawnAt,
            withdrawalAcademicYear: withdrawnAt ? year : null,
            notes:
              adjustedStatus === 'GRADUATED'
                ? 'Egreso registrado al cierre del ciclo.'
                : adjustedStatus === 'TRANSFERRED'
                  ? 'Traslado a institucion con oferta no disponible en el liceo.'
                  : adjustedStatus === 'WITHDRAWN'
                    ? 'Retiro administrativo con seguimiento de adscripcion.'
                    : 'Matricula activa y seguimiento normal.',
            createdAt: wall(`${year}-02-${String(12 + (i % 12)).padStart(2, '0')}`, 9, 0),
          },
        })

        const annualPaid = adjustedStatus === 'ACTIVE' ? ratio(`annual-${student.id}-${year}`) > (year === 2026 ? 0.18 : 0.08) : ratio(`annual-out-${student.id}-${year}`) > 0.35
        await prisma.studentTuitionYear.create({
          data: {
            studentId: student.id,
            schoolYearId: schoolYearId.get(year),
            year,
            paid: annualPaid,
            paidAt: annualPaid ? wall(`${year}-03-${String(8 + (index % 10)).padStart(2, '0')}`, 11, 0) : null,
            amountCents: year === 2024 ? 280000 : year === 2025 ? 315000 : 348000,
            notes: annualPaid ? 'Cuota anual regularizada.' : 'Saldo anual pendiente o plan de pago.',
          },
        })

        const lastMonth = year < 2026 ? 12 : 5
        for (let month = 3; month <= 12; month += 1) {
          const isFuture = year === 2026 && month > lastMonth
          const leftBeforeMonth = withdrawnAt ? Number(toYmd(withdrawnAt).slice(5, 7)) < month : false
          const paidThreshold = year === 2024 ? 0.06 : year === 2025 ? 0.12 : 0.22
          const paid = !isFuture && !leftBeforeMonth && ratio(`month-${student.id}-${year}-${month}`) > paidThreshold
          await prisma.studentTuitionMonth.create({
            data: {
              studentId: student.id,
              schoolYearId: schoolYearId.get(year),
              year,
              month,
              paid,
              paidAt: paid ? wall(`${year}-${String(month).padStart(2, '0')}-${String(6 + ((index + month) % 15)).padStart(2, '0')}`, 13, month % 50) : null,
              amountCents: year === 2024 ? 125000 : year === 2025 ? 138000 : 152000,
              notes: isFuture ? 'Mes futuro del ciclo activo.' : paid ? 'Pago mensual acreditado.' : 'Pendiente o bonificacion en revision.',
            },
          })
        }
      }
      index += 1
      created += 1
    }
  }
  console.log(`[dataset] Estudiantes creados: ${created}`)
}

async function seedMedicalLeaves(teachers: Array<Pick<User, 'id' | 'username' | 'name'>>) {
  const selected = teachers.slice(2, 14)
  const ranges = [
    ['2024-05-13', '2024-05-17', 'Gripe con reposo indicado'],
    ['2024-09-02', '2024-09-04', 'Intervencion odontologica'],
    ['2025-04-21', '2025-04-25', 'Licencia medica certificada'],
    ['2025-08-11', '2025-08-13', 'Reposo por lesion menor'],
    ['2025-10-06', '2025-10-10', 'Control y tratamiento medico'],
    ['2026-03-17', '2026-03-19', 'Reposo por afeccion respiratoria'],
    ['2026-04-20', '2026-04-22', 'Estudio medico programado'],
    ['2026-05-11', '2026-05-16', 'Licencia medica con certificado'],
  ] as const

  for (let i = 0; i < ranges.length; i += 1) {
    const [start, end, reason] = ranges[i]
    const teacher = selected[i % selected.length]
    await prisma.medicalLeave.create({
      data: {
        userId: teacher.id,
        type: 'MEDICAL_LEAVE',
        status: 'ACTIVE',
        startDate: ymdToDate(start),
        endDate: ymdToDate(end),
        reason,
        doctorName: pick(['Dra. Laura Castro', 'Dr. Martín Perdomo', 'Dra. Inés Silva', 'Dr. Pablo Reyes'], `doctor-${i}`),
        doctorPhone: `+5982${intBetween(`doctor-phone-${i}`, 2000000, 9999999)}`,
        certificate: `/certificados/demo/licencia-${i + 1}.pdf`,
        approvedAt: wall(start, 15, 30),
        notes: 'Licencia incluida en dataset realista.',
      },
    })
  }
}

async function seedEvents(admin: User, teachers: User[]) {
  const schoolYears = await prisma.schoolYear.findMany({ select: { id: true, code: true } })
  const schoolYearId = new Map(schoolYears.map((row) => [row.code, row.id]))
  const offerings = await prisma.courseOffering.findMany({
    where: { isOffered: true, visibleInFilters: true },
    include: { course: true, schoolYear: true },
  })
  const subjects = await prisma.subject.findMany({ select: { id: true, name: true } })
  const subjectByName = new Map(subjects.map((row) => [row.name, row.id]))
  const orientations = await prisma.orientation.findMany({ select: { id: true, code: true, name: true } })
  const orientationByCode = new Map(orientations.map((row) => [row.code ?? '', row]))
  const courseOrientations = await (prisma as any).courseOrientation.findMany({
    where: { isOffered: true },
    select: { id: true, courseId: true, orientationId: true, schoolYearId: true },
  })
  const courseOrientationId = new Map(
    courseOrientations.map((row: any) => [`${row.schoolYearId}:${row.courseId}:${row.orientationId}`, row.id]),
  )
  const teacherByUsername = new Map(teachers.map((teacher) => [teacher.username ?? '', teacher]))
  const busy = new Set<string>()
  const poolCursor = new Map<string, number>()
  const createdEvents: Event[] = []

  function chooseTeacher(subject: string, year: number, days: number[], slotIndex: number) {
    const area = subjectArea(subject)
    const usernames = TEACHER_POOLS[area] ?? TEACHER_POOLS.gestion
    const start = poolCursor.get(area) ?? 0
    for (let offset = 0; offset < usernames.length + teachers.length; offset += 1) {
      const username = usernames[(start + offset) % usernames.length]
      const candidate = teacherByUsername.get(username) ?? teachers[(start + offset) % teachers.length]
      const conflict = days.some((day) => busy.has(`${year}:${candidate.id}:${day}:${slotIndex}`))
      if (!conflict) {
        days.forEach((day) => busy.add(`${year}:${candidate.id}:${day}:${slotIndex}`))
        poolCursor.set(area, start + offset + 1)
        return candidate
      }
    }
    return teachers[stableHash(`${subject}-${year}-${slotIndex}`) % teachers.length]
  }

  async function createRecurringClass(params: {
    year: number
    courseOffering: (typeof offerings)[number]
    subjectName: string
    subjectIndex: number
    orientation?: { id: string; code: string | null; name: string }
  }) {
    const subjectId = subjectByName.get(params.subjectName)
    if (!subjectId) return
    const dates = SCHOOL_YEAR_DATES[params.year]
    const slotIndex = (params.subjectIndex + params.courseOffering.course.sortOrder) % CLASS_SLOTS.length
    const slot = CLASS_SLOTS[slotIndex]
    const primaryDay = 1 + ((params.subjectIndex + params.courseOffering.course.sortOrder) % 5)
    const secondDay = params.subjectIndex % 3 === 0 ? 1 + ((primaryDay + 2) % 5) : null
    const days = Array.from(new Set([primaryDay, ...(secondDay ? [secondDay] : [])]))
    const teacher = chooseTeacher(params.subjectName, params.year, days, slotIndex)
    const orientationLabel = params.orientation ? ` - ${params.orientation.name}` : ''
    const courseOrientation =
      params.orientation && courseOrientationId.get(`${params.courseOffering.schoolYearId}:${params.courseOffering.courseId}:${params.orientation.id}`)

    const event = await prisma.event.create({
      data: {
        title: `${params.subjectName} - ${params.courseOffering.course.name}${orientationLabel} Grupo A`,
        description: `Clase recurrente realista de ${params.subjectName} para ${params.courseOffering.course.name}.`,
        type: 'CLASE',
        status: params.year < 2026 ? 'COMPLETED' : 'SCHEDULED',
        startDate: ymdToDate(dates.start),
        endDate: ymdToDate(dates.end),
        startTime: wall(dates.start, slot.start[0], slot.start[1]),
        endTime: wall(dates.start, slot.end[0], slot.end[1]),
        location: `Aula ${params.courseOffering.course.sortOrder}${String(slotIndex + 1).padStart(2, '0')}`,
        userId: admin.id,
        assignedUserId: teacher.id,
        schoolYearId: params.courseOffering.schoolYearId,
        courseOfferingId: params.courseOffering.id,
        orientationId: params.orientation?.id ?? null,
        courseOrientationId: courseOrientation ?? null,
        subjectId,
        recurrenceType: 'WEEKLY',
        recurrenceEnd: ymdToDate(dates.end),
        isRecurring: true,
        daysOfWeek: days,
      },
    })
    createdEvents.push(event)
  }

  for (const offering of offerings) {
    const year = offering.schoolYear.code
    const baseSubjects = SUBJECTS_BY_COURSE[offering.course.code ?? ''] ?? []
    for (let i = 0; i < baseSubjects.length; i += 1) {
      await createRecurringClass({ year, courseOffering: offering, subjectName: baseSubjects[i], subjectIndex: i })
    }

    const orientationCodes = ORIENTATION_OFFERS[year]?.[offering.course.code ?? ''] ?? []
    for (const orientationCode of orientationCodes.slice(0, offering.course.code === '3-EMS' ? 5 : 2)) {
      const orientation = orientationByCode.get(orientationCode)
      if (!orientation) continue
      const list = ORIENTATION_SUBJECTS[orientationCode] ?? []
      for (let i = 0; i < Math.min(3, list.length); i += 1) {
        await createRecurringClass({
          year,
          courseOffering: offering,
          subjectName: list[i],
          subjectIndex: baseSubjects.length + i + stableHash(orientationCode) % 3,
          orientation,
        })
      }
    }
  }

  for (const year of [2024, 2025, 2026]) {
    const dates = SCHOOL_YEAR_DATES[year]
    await prisma.event.create({
      data: {
        title: `Coordinacion docente semanal ${year}`,
        description: 'Espacio de coordinacion pedagogica y seguimiento de grupos.',
        type: 'REUNION',
        status: year < 2026 ? 'COMPLETED' : 'SCHEDULED',
        startDate: ymdToDate(dates.start),
        endDate: ymdToDate(dates.end),
        startTime: wall(dates.start, 14, 0),
        endTime: wall(dates.start, 15, 30),
        location: 'Sala docente',
        userId: admin.id,
        assignedUserId: teachers[year % teachers.length].id,
        schoolYearId: schoolYearId.get(year)!,
        recurrenceType: 'WEEKLY',
        recurrenceEnd: ymdToDate(dates.end),
        isRecurring: true,
        daysOfWeek: [3],
      },
    })
  }

  await prisma.event.create({
    data: {
      title: 'Jornada laboral Administracion',
      description: 'Turno administrativo diario para direccion y bedelia.',
      type: 'JORNADA_LABORAL',
      status: 'SCHEDULED',
      startDate: ymdToDate(SCHOOL_YEAR_DATES[2026].start),
      endDate: ymdToDate(SCHOOL_YEAR_DATES[2026].end),
      startTime: wall(SCHOOL_YEAR_DATES[2026].start, 8, 0),
      endTime: wall(SCHOOL_YEAR_DATES[2026].start, 16, 0),
      location: 'Administracion',
      userId: admin.id,
      assignedUserId: admin.id,
      schoolYearId: schoolYearId.get(2026)!,
      recurrenceType: 'DAILY',
      recurrenceEnd: ymdToDate(SCHOOL_YEAR_DATES[2026].end),
      isRecurring: true,
      daysOfWeek: [1, 2, 3, 4, 5],
    },
  })

  console.log(`[dataset] Eventos recurrentes creados: ${createdEvents.length + 4}`)
  return createdEvents
}

async function seedAttendances(params: {
  admin: User
  teachers: User[]
  device: { id: string }
  mappings: Map<string, { id: string; deviceUserId: string }>
}) {
  const events = await prisma.event.findMany({
    where: { assignedUserId: { not: null }, isRecurring: true },
    include: { schoolYear: true },
  })
  const nonWorkingDays = await prisma.nonWorkingDay.findMany({ select: { date: true } })
  const blocked = new Set(nonWorkingDays.map((row) => toYmd(row.date)))
  const leaves = await prisma.medicalLeave.findMany({ where: { status: 'ACTIVE' } })
  const teachers = await prisma.user.findMany({ where: { orgRole: { code: 'TEACHER' } }, select: { id: true } })
  const teacherIds = new Set(teachers.map((teacher) => teacher.id))
  const adminUsers = await prisma.user.findMany({ where: { orgRole: { code: 'ADMIN' } }, select: { id: true } })
  const adminId = adminUsers[0]?.id
  let attendanceCount = 0
  let incidentCount = 0
  let substitutionCount = 0
  let punchCount = 0

  function hasLeave(userId: string, date: string) {
    const day = ymdToDate(date).getTime()
    return leaves.find((leave) => leave.userId === userId && ymdToDate(toYmd(leave.startDate)).getTime() <= day && ymdToDate(toYmd(leave.endDate)).getTime() >= day)
  }

  async function createPunch(userId: string, attendanceId: string, type: 'CHECK_IN' | 'CHECK_OUT', occurredAt: Date) {
    const mapping = params.mappings.get(userId)
    if (!mapping || toYmd(occurredAt).slice(0, 4) !== '2026') return
    const existingPunchAtSameInstant = await prisma.biometricPunch.findFirst({
      where: {
        deviceId: params.device.id,
        deviceUserId: mapping.deviceUserId,
        occurredAt,
      },
      select: { id: true },
    })
    if (existingPunchAtSameInstant) return
    await prisma.biometricPunch.create({
      data: {
        deviceId: params.device.id,
        mappingId: mapping.id,
        userId,
        attendanceId,
        externalId: `${mapping.deviceUserId}-${occurredAt.getTime()}-${type}`,
        deviceUserId: mapping.deviceUserId,
        occurredAt,
        receivedAt: new Date(occurredAt.getTime() + intBetween(`recv-${attendanceId}`, 10, 90) * 1000),
        punchType: type,
        processStatus: 'PROCESSED',
        payload: { source: 'seed-realistic-dataset', type, deviceUserId: mapping.deviceUserId },
      },
    })
    punchCount += 1
  }

  for (const event of events) {
    if (!event.assignedUserId || !event.startTime || !event.endTime || !event.recurrenceEnd) continue
    const year = event.schoolYear.code
    const dates = SCHOOL_YEAR_DATES[year]
    const end = dates.attendanceUntil
    const startMinutes = wallMinutesFromStoredTime(event.startTime)
    const endMinutes = wallMinutesFromStoredTime(event.endTime)
    const days = event.daysOfWeek.length ? event.daysOfWeek : [weekday(toYmd(event.startDate))]

    for (const date of eachYmd(toYmd(event.startDate), end)) {
      if (!days.includes(weekday(date)) || blocked.has(date)) continue
      const userId = event.assignedUserId
      const leave = hasLeave(userId, date)
      const baseKey = `${event.id}-${date}`
      const absenceRate = year === 2024 ? 0.035 : year === 2025 ? 0.052 : 0.07
      const lateRate = year === 2024 ? 0.09 : year === 2025 ? 0.12 : 0.16
      const earlyRate = year === 2024 ? 0.025 : year === 2025 ? 0.035 : 0.045

      if (leave) {
        const attendance = await prisma.attendance.create({
          data: {
            userId,
            eventId: event.id,
            type: 'CHECK_IN',
            status: 'ABSENT_JUSTIFIED',
            date: ymdToDate(date),
            time: minutesToWall(date, startMinutes),
            notes: `Ausencia justificada por licencia: ${leave.reason}`,
          },
        })
        await prisma.attendanceJustification.create({
          data: {
            attendanceId: attendance.id,
            type: 'ABSENCE',
            reason: leave.reason,
            previousStatus: 'ABSENT_NOT_JUSTIFIED',
            newStatus: 'ABSENT_JUSTIFIED',
            createdByUserId: adminId,
            notes: 'Justificacion automatica por licencia medica del dataset.',
          },
        })
        attendanceCount += 1
        continue
      }

      if (teacherIds.has(userId) && ratio(`${baseKey}-absent`) < absenceRate) {
        const shouldCreateSubstitution = ratio(`${baseKey}-substitution`) > 0.52
        const substitute = shouldCreateSubstitution
          ? params.teachers.find((teacher) => teacher.id !== userId && ratio(`${baseKey}-${teacher.id}-sub`) > 0.72)
          : null
        const attendance = await prisma.attendance.create({
          data: {
            userId,
            eventId: event.id,
            type: 'CHECK_IN',
            status: substitute ? 'SUBSTITUTED' : ratio(`${baseKey}-just`) > 0.45 ? 'ABSENT_JUSTIFIED' : 'ABSENT_NOT_JUSTIFIED',
            date: ymdToDate(date),
            time: minutesToWall(date, startMinutes),
            notes: substitute ? 'Docente cubierto por suplencia.' : 'Inasistencia registrada para seguimiento.',
          },
        })
        attendanceCount += 1

        const incident = await prisma.attendanceIncident.create({
          data: {
            type: 'TEACHER_NO_SHOW',
            status: substitute ? 'RESOLVED' : ratio(`${baseKey}-ack`) > 0.55 ? 'ACKNOWLEDGED' : 'OPEN',
            title: `Ausencia docente - ${event.title}`,
            description: substitute ? 'Ausencia cubierta con docente suplente.' : 'No se registro entrada al inicio de la clase.',
            severity: substitute ? 'MEDIUM' : 'HIGH',
            userId,
            eventId: event.id,
            attendanceId: attendance.id,
            detectedAt: minutesToWall(date, startMinutes + 15),
            acknowledgedAt: substitute ? minutesToWall(date, startMinutes + 18) : null,
            resolvedAt: substitute ? minutesToWall(date, startMinutes + 25) : null,
            resolvedBy: substitute ? adminId : null,
          },
        })
        incidentCount += 1

        if (substitute && event.startTime && event.endTime) {
          await prisma.substitution.create({
            data: {
              eventId: event.id,
              originalTeacherUserId: userId,
              substituteUserId: substitute.id,
              date: ymdToDate(date),
              startTime: minutesToWall(date, startMinutes),
              endTime: minutesToWall(date, endMinutes),
              reason: 'Suplencia por ausencia docente',
              notes: 'Cobertura generada para dataset realista.',
              createdByUserId: adminId,
            },
          })
          substitutionCount += 1
          const inTime = minutesToWall(date, startMinutes - 4)
          const outTime = minutesToWall(date, endMinutes + 2)
          const subIn = await prisma.attendance.create({
            data: { userId: substitute.id, eventId: event.id, type: 'CHECK_IN', status: 'PRESENT', date: ymdToDate(date), time: inTime, notes: 'Entrada docente suplente.' },
          })
          const subOut = await prisma.attendance.create({
            data: { userId: substitute.id, eventId: event.id, type: 'CHECK_OUT', status: 'EXIT', date: ymdToDate(date), time: outTime, notes: 'Salida docente suplente.' },
          })
          attendanceCount += 2
          await createPunch(substitute.id, subIn.id, 'CHECK_IN', inTime)
          await createPunch(substitute.id, subOut.id, 'CHECK_OUT', outTime)
        }

        if (incident.status !== 'OPEN') {
          await prisma.inAppNotification.create({
            data: {
              userId: adminId ?? params.admin.id,
              type: 'ATTENDANCE_INCIDENT',
              title: incident.title,
              body: incident.description ?? 'Incidente de asistencia.',
              actionUrl: '/admin/attendance',
              readAt: incident.status === 'RESOLVED' ? new Date(incident.detectedAt.getTime() + 60 * 60 * 1000) : null,
              createdAt: incident.detectedAt,
            },
          })
        }
        continue
      }

      const lateMinutes = ratio(`${baseKey}-late`) < lateRate ? intBetween(`${baseKey}-late-min`, 7, 22) : intBetween(`${baseKey}-early-in`, -8, 4)
      const earlyMinutes = ratio(`${baseKey}-early`) < earlyRate ? intBetween(`${baseKey}-early-min`, 8, 18) : -intBetween(`${baseKey}-late-out`, 0, 7)
      const inTime = minutesToWall(date, startMinutes + lateMinutes)
      const outTime = minutesToWall(date, endMinutes - earlyMinutes)
      const inStatus: AttendanceStatus = lateMinutes > 5 ? 'LATE' : 'PRESENT'
      const outStatus: AttendanceStatus = earlyMinutes > 5 ? 'EARLY_EXIT' : 'EXIT'
      const checkIn = await prisma.attendance.create({
        data: {
          userId,
          eventId: event.id,
          type: 'CHECK_IN',
          status: inStatus,
          date: ymdToDate(date),
          time: inTime,
          notes: inStatus === 'LATE' ? pick(['Retraso por transporte', 'Ingreso tarde avisado a adscripcion', 'Demora en clase previa'], `${baseKey}-late-note`) : 'Entrada normal.',
        },
      })
      const checkOut = await prisma.attendance.create({
        data: {
          userId,
          eventId: event.id,
          type: 'CHECK_OUT',
          status: outStatus,
          date: ymdToDate(date),
          time: outTime,
          notes: outStatus === 'EARLY_EXIT' ? pick(['Retiro por coordinacion', 'Salida autorizada por direccion', 'Traslado a otra actividad'], `${baseKey}-early-note`) : 'Salida normal.',
        },
      })
      attendanceCount += 2
      await createPunch(userId, checkIn.id, 'CHECK_IN', inTime)
      await createPunch(userId, checkOut.id, 'CHECK_OUT', outTime)

      if (inStatus === 'LATE') {
        await prisma.attendanceIncident.create({
          data: {
            type: 'LATE_ARRIVAL',
            status: ratio(`${baseKey}-late-res`) > 0.35 ? 'RESOLVED' : 'ACKNOWLEDGED',
            title: `Llegada tarde - ${event.title}`,
            description: `Llegada ${lateMinutes} minutos tarde.`,
            severity: lateMinutes > 15 ? 'HIGH' : 'MEDIUM',
            userId,
            eventId: event.id,
            attendanceId: checkIn.id,
            detectedAt: inTime,
            acknowledgedAt: new Date(inTime.getTime() + 20 * 60 * 1000),
            resolvedAt: ratio(`${baseKey}-late-res`) > 0.35 ? new Date(inTime.getTime() + 90 * 60 * 1000) : null,
            resolvedBy: ratio(`${baseKey}-late-res`) > 0.35 ? adminId : null,
          },
        })
        incidentCount += 1
      }

      if (outStatus === 'EARLY_EXIT') {
        await prisma.attendanceIncident.create({
          data: {
            type: 'EARLY_EXIT',
            status: 'RESOLVED',
            title: `Salida anticipada - ${event.title}`,
            description: `Salida ${earlyMinutes} minutos antes de finalizar.`,
            severity: 'MEDIUM',
            userId,
            eventId: event.id,
            attendanceId: checkOut.id,
            detectedAt: outTime,
            acknowledgedAt: new Date(outTime.getTime() + 10 * 60 * 1000),
            resolvedAt: new Date(outTime.getTime() + 55 * 60 * 1000),
            resolvedBy: adminId,
          },
        })
        incidentCount += 1
      }
    }
  }

  console.log(`[dataset] Asistencias creadas: ${attendanceCount}`)
  console.log(`[dataset] Marcaciones biometricas creadas: ${punchCount}`)
  console.log(`[dataset] Incidencias creadas: ${incidentCount}`)
  console.log(`[dataset] Suplencias creadas: ${substitutionCount}`)
}

async function seedAudit(admin: User) {
  const recentEvents = await prisma.event.findMany({ orderBy: { createdAt: 'desc' }, take: 8, select: { id: true, title: true, createdAt: true } })
  for (const event of recentEvents) {
    await prisma.auditLog.create({
      data: {
        occurredAt: event.createdAt,
        action: 'EVENT_CREATED',
        actorUserId: admin.id,
        actorIp: '10.10.0.12',
        userAgent: 'EduTrack seed realistic dataset',
        source: 'SEED',
        entityType: 'Event',
        entityId: event.id,
        metadata: { title: event.title, dataset: 'realistic' },
      },
    })
  }

  await prisma.auditLog.create({
    data: {
      occurredAt: wall('2026-05-20', 17, 15),
      action: 'SYSTEM_SETTINGS_UPDATED',
      actorUserId: admin.id,
      actorIp: '10.10.0.12',
      userAgent: 'EduTrack seed realistic dataset',
      source: 'SEED',
      entityType: 'SystemSettings',
      entityId: 'default',
      metadata: { attendanceLateToleranceMinutes: 5, attendanceEarlyExitToleranceMinutes: 5 },
    },
  })
}

async function ensureDemoStaffUsers() {
  const staffRole = await prisma.orgRole.findUnique({ where: { code: 'STAFF' } })
  if (!staffRole) return
  const passwordHash = await argon2.hash('funcionario123', { type: argon2.argon2id })
  const rows = [
    ['maria.adscriptora', 'María', 'Santos', 'Adscripta turno matutino'],
    ['pablo.bedel', 'Pablo', 'Molina', 'Bedelia y gestion de asistencias'],
  ] as const
  for (let i = 0; i < rows.length; i += 1) {
    const [username, firstName, lastName, note] = rows[i]
    await prisma.user.upsert({
      where: { username },
      create: {
        username,
        email: `${username}@liceo.test`,
        firstName,
        lastName,
        name: `${firstName} ${lastName}`,
        phone: `+59898${String(500000 + i).padStart(6, '0')}`,
        nationalId: buildValidCi(1_800_000 + i),
        birthdate: wall(`198${i + 1}-04-12`, 0, 0),
        passwordHash,
        roleId: staffRole.id,
        emailVerifiedAt: new Date(),
        isApproved: true,
        approvedAt: new Date(),
        isActive: true,
      },
      update: {
        firstName,
        lastName,
        name: `${firstName} ${lastName}`,
        isActive: true,
      },
    })
    console.log(`[dataset] Usuario STAFF listo: ${username} (${note})`)
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL no esta definida')

  console.log('[dataset] Base estructural: bootstrap + catalogo + docentes...')
  await runBootstrap()
  await seedAcademicCatalog()
  await seedTeachers()
  await ensureDemoStaffUsers()

  await clearOperationalData()
  await ensureOfferingsForAllYears()
  await seedNonWorkingDays()

  const admin = await prisma.user.findFirstOrThrow({ where: { orgRole: { code: 'ADMIN' } } })
  const teachers = await prisma.user.findMany({
    where: { orgRole: { code: 'TEACHER' }, isActive: true },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  })
  const allMappedUsers = [admin, ...teachers]
  const biometric = await seedBiometricDevice(allMappedUsers)

  await seedStudents()
  await seedMedicalLeaves(teachers)
  await seedEvents(admin, teachers)
  await seedAttendances({ admin, teachers, device: biometric.device, mappings: biometric.mappings })
  await seedAudit(admin)

  await prisma.systemSettings.update({
    where: { id: 'default' },
    data: {
      attendanceNoShowGraceMinutes: 15,
      attendanceLateToleranceMinutes: 5,
      attendanceEarlyExitToleranceMinutes: 5,
      attendanceClassBridgeGapMinutes: 60,
      attendanceMonitorEnabled: true,
      biometricLateHour: 8,
      biometricLateMinute: 30,
    },
  })

  const counts = await Promise.all([
    prisma.student.count(),
    prisma.studentEnrollment.count(),
    prisma.event.count(),
    prisma.attendance.count(),
    prisma.attendanceIncident.count(),
    prisma.substitution.count(),
    prisma.studentTuitionMonth.count(),
  ])
  console.log('')
  console.log('[dataset] Dataset realista completado.')
  console.log(`[dataset] Estudiantes: ${counts[0]} | Matriculas historicas: ${counts[1]}`)
  console.log(`[dataset] Eventos: ${counts[2]} | Asistencias: ${counts[3]} | Incidencias: ${counts[4]} | Suplencias: ${counts[5]}`)
  console.log(`[dataset] Cuotas mensuales: ${counts[6]}`)
  console.log('[dataset] Credenciales: admin/admin123, docentes/docente123, staff/funcionario123')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
