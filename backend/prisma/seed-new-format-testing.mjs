import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import argon2 from 'argon2'

const prisma = new PrismaClient()
const PASSWORD = 'admin123'
const TODAY = new Date('2026-05-19T12:00:00.000Z')

const SUBJECTS_BY_LEVEL = {
  '7': ['Matematica', 'Lengua Espanola', 'Ingles', 'Historia', 'Geografia', 'Ciencias del Ambiente', 'Educacion Fisica', 'Arte', 'Ciencias de la Computacion'],
  '8': ['Matematica', 'Lengua Espanola', 'Ingles', 'Historia', 'Geografia', 'Biologia', 'Ciencias Fisico-Quimicas', 'Educacion Fisica', 'Ciencias de la Computacion'],
  '9': ['Matematica', 'Literatura', 'Ingles', 'Historia', 'Geografia', 'Biologia', 'Fisica', 'Quimica', 'Educacion Fisica', 'Ciencias de la Computacion'],
  '1EMS': ['Matematica', 'Literatura', 'Ingles', 'Filosofia', 'Historia', 'Educacion Fisica', 'Ciencias de la Computacion', 'Fisica', 'Quimica'],
  '2EMS_CIENT': ['Matematica', 'Fisica', 'Quimica', 'Ciencias de la Computacion', 'Filosofia', 'Literatura', 'Ingles'],
  '3EMS_CIENT': ['Matematica', 'Fisica', 'Quimica', 'Ciencias de la Computacion', 'Filosofia', 'Literatura'],
  '2EMS_HUM': ['Historia', 'Filosofia', 'Literatura', 'Sociologia', 'Derecho', 'Ingles', 'Matematica'],
  '3EMS_HUM': ['Historia', 'Filosofia', 'Literatura', 'Sociologia', 'Derecho', 'Economia', 'Ingles'],
  '2EMS_VIDA': ['Biologia', 'Quimica', 'Fisica', 'Matematica', 'Ingles', 'Filosofia'],
  '3EMS_VIDA': ['Biologia', 'Quimica', 'Fisica', 'Matematica', 'Literatura'],
  '2EMS_ARTE': ['Arte', 'Literatura', 'Historia', 'Filosofia', 'Ingles', 'Ciencias de la Computacion'],
  '3EMS_ARTE': ['Arte', 'Literatura', 'Historia del Arte', 'Filosofia', 'Comunicacion Visual'],
  '2EMS_ECO': ['Economia', 'Matematica', 'Derecho', 'Historia', 'Ingles', 'Filosofia'],
  '3EMS_ECO': ['Economia', 'Derecho', 'Matematica', 'Sociologia', 'Ingles'],
  '2EMS_GENERAL': ['Matematica', 'Literatura', 'Ingles', 'Filosofia', 'Historia', 'Ciencias de la Computacion'],
  '3EMS_GENERAL': ['Matematica', 'Literatura', 'Ingles', 'Filosofia', 'Historia'],
}

const ACTIVE_2026_GROUPS = [
  ['7A', '7', '7.o A'],
  ['7B', '7', '7.o B'],
  ['8A', '8', '8.o A'],
  ['8B', '8', '8.o B'],
  ['9A', '9', '9.o A'],
  ['9B', '9', '9.o B'],
  ['1EMS-A', '1EMS', '1.o EMS A'],
  ['1EMS-B', '1EMS', '1.o EMS B'],
  ['2EMS-CIENT-A', '2EMS_CIENT', '2.o EMS Ciencias y Tecnologia A'],
  ['2EMS-HUM-A', '2EMS_HUM', '2.o EMS Ciencias Sociales y Humanidades A'],
  ['3EMS-CIENT-A', '3EMS_CIENT', '3.o EMS Ciencias y Tecnologia A'],
  ['3EMS-HUM-A', '3EMS_HUM', '3.o EMS Ciencias Sociales y Humanidades A'],
]

const CATALOG_ONLY = [
  ['2EMS-VIDA-CAT', '2EMS_VIDA', '2.o EMS Ciencias de la Vida'],
  ['3EMS-VIDA-CAT', '3EMS_VIDA', '3.o EMS Ciencias de la Vida'],
  ['2EMS-ARTE-CAT', '2EMS_ARTE', '2.o EMS Creativo Artistico'],
  ['3EMS-ARTE-CAT', '3EMS_ARTE', '3.o EMS Creativo Artistico'],
  ['2EMS-ECO-CAT', '2EMS_ECO', '2.o EMS Ciencias Economicas'],
  ['3EMS-ECO-CAT', '3EMS_ECO', '3.o EMS Ciencias Economicas'],
  ['2EMS-GRAL-CAT', '2EMS_GENERAL', '2.o EMS General'],
  ['3EMS-GRAL-CAT', '3EMS_GENERAL', '3.o EMS General'],
]

const FIRST_NAMES = ['Valentina', 'Mateo', 'Lucia', 'Joaquin', 'Camila', 'Santiago', 'Martina', 'Facundo', 'Sofia', 'Bruno', 'Emilia', 'Ignacio', 'Agustina', 'Thiago', 'Florencia', 'Sebastian', 'Renata', 'Juan', 'Catalina', 'Tomas', 'Micaela', 'Nicolas', 'Victoria', 'Diego', 'Julieta', 'Franco', 'Paula', 'Rodrigo', 'Josefina', 'Lautaro', 'Manuela', 'Matias', 'Bianca', 'Gonzalo', 'Antonella', 'Lucas', 'Clara', 'Federico', 'Ana', 'Maximiliano']
const LAST_NAMES = ['Rodriguez', 'Gonzalez', 'Martinez', 'Fernandez', 'Pereira', 'Silva', 'Sosa', 'Acosta', 'Viera', 'Barrios', 'Cabrera', 'Mendez', 'Castro', 'Pintos', 'Suarez', 'Molina', 'Ramos', 'Torres', 'Lema', 'Nuñez', 'Cardozo', 'Olivera', 'Techera', 'Moreira', 'Benitez', 'Vidal', 'Ferreira', 'Alvarez', 'Correa', 'Medina']

const TEACHERS = [
  ['admin', 'Administracion', 'Testing', 'ADMIN', 'Direccion'],
  ['adscripta.turno', 'Sofia', 'Acosta', 'STAFF', 'Adscripcion'],
  ['coordinacion', 'Clara', 'Mendez', 'STAFF', 'Coordinacion'],
  ['doc.mat.ferreira', 'Nicolas', 'Ferreira', 'TEACHER', 'Matematica'],
  ['doc.mat.ramos', 'Paula', 'Ramos', 'TEACHER', 'Matematica'],
  ['doc.lengua.silva', 'Laura', 'Silva', 'TEACHER', 'Lengua Espanola'],
  ['doc.literatura.viera', 'Mariana', 'Viera', 'TEACHER', 'Literatura'],
  ['doc.ingles.bentos', 'Carolina', 'Bentos', 'TEACHER', 'Ingles'],
  ['doc.historia.martin', 'Martin', 'Cabrera', 'TEACHER', 'Historia'],
  ['doc.geo.pereira', 'Gustavo', 'Pereira', 'TEACHER', 'Geografia'],
  ['doc.bio.rocha', 'Valeria', 'Rocha', 'TEACHER', 'Biologia'],
  ['doc.fisica.sosa', 'Diego', 'Sosa', 'TEACHER', 'Fisica'],
  ['doc.quimica.rios', 'Camila', 'Rios', 'TEACHER', 'Quimica'],
  ['doc.comp.molina', 'Andres', 'Molina', 'TEACHER', 'Ciencias de la Computacion'],
  ['doc.edfisica.gomez', 'Bruno', 'Gomez', 'TEACHER', 'Educacion Fisica'],
  ['doc.filo.lema', 'Ana', 'Lema', 'TEACHER', 'Filosofia'],
  ['doc.derecho.suarez', 'Federico', 'Suarez', 'TEACHER', 'Derecho'],
  ['doc.sociologia.pintos', 'Lucia', 'Pintos', 'TEACHER', 'Sociologia'],
  ['doc.economia.mendez', 'Rafael', 'Mendez', 'TEACHER', 'Economia'],
  ['doc.arte.castro', 'Victoria', 'Castro', 'TEACHER', 'Arte'],
  ['doc.ciencias.ambiente', 'Agustin', 'Pereira', 'TEACHER', 'Ciencias del Ambiente'],
  ['doc.cfq.alvarez', 'Natalia', 'Alvarez', 'TEACHER', 'Ciencias Fisico-Quimicas'],
]

function utcDate(y, m, d, h = 0, min = 0) {
  return new Date(Date.UTC(y, m - 1, d, h, min, 0, 0))
}

function addDays(date, days) {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

function dateKey(date) {
  return date.toISOString().slice(0, 10)
}

function classTime(day, hour, minute) {
  return utcDate(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hour, minute)
}

function ci(index) {
  return `5${String(1000000 + index * 37).slice(0, 7)}`
}

function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

async function wipeData() {
  await prisma.attendanceIncident.deleteMany()
  await prisma.biometricPunch.deleteMany()
  await prisma.attendance.deleteMany()
  await prisma.medicalLeave.deleteMany()
  await prisma.event.updateMany({ data: { parentEventId: null } })
  await prisma.event.deleteMany()
  await prisma.studentTuitionMonth.deleteMany()
  await prisma.studentTuitionYear.deleteMany()
  await prisma.studentEnrollment.deleteMany()
  await prisma.student.deleteMany()
  await prisma.subject.deleteMany()
  await prisma.courseOffering.deleteMany()
  await prisma.course.deleteMany()
  await prisma.nonWorkingDay.deleteMany()
  await prisma.webPushSubscription.deleteMany()
  await prisma.refreshToken.deleteMany()
  await prisma.passwordReset.deleteMany()
  await prisma.emailVerification.deleteMany()
  await prisma.livenessSession.deleteMany()
  await prisma.biometricUserMapping.deleteMany()
  await prisma.biometricDevice.deleteMany()
  await prisma.auditLog.deleteMany()
  await prisma.inAppNotification.deleteMany()
  await prisma.user.deleteMany()
  await prisma.schoolYear.deleteMany()
}

async function ensureRole(code, label, sortOrder) {
  return prisma.orgRole.upsert({
    where: { code },
    update: { label, sortOrder, active: true, builtIn: true },
    create: { code, label, sortOrder, active: true, builtIn: true },
  })
}

async function createUsers() {
  const roles = {
    ADMIN: await ensureRole('ADMIN', 'Administrador', 1),
    STAFF: await ensureRole('STAFF', 'Adscripcion y administracion', 2),
    TEACHER: await ensureRole('TEACHER', 'Docente', 3),
  }
  const users = new Map()
  for (let i = 0; i < TEACHERS.length; i++) {
    const [username, firstName, lastName, role, subject] = TEACHERS[i]
    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id })
    const user = await prisma.user.create({
      data: {
        username,
        email: `${username}@testing.edutrack.local`,
        firstName,
        lastName,
        name: `${firstName} ${lastName}`,
        phone: `+59899${String(100000 + i).slice(-6)}`,
        nationalId: ci(i + 1),
        birthdate: utcDate(1978 + (i % 18), (i % 12) + 1, (i % 26) + 1),
        roleId: roles[role].id,
        passwordHash,
        emailVerifiedAt: new Date(),
        isApproved: true,
        approvedAt: new Date(),
        isActive: true,
        failedLoginAttempts: 0,
        lockUntil: null,
        twoFactorEnabled: false,
      },
    })
    users.set(username, { ...user, subject })
  }
  return users
}

function teacherFor(subject, users) {
  const normalized = subject.toLowerCase()
  const direct = [...users.values()].find((u) => normalized.includes(String(u.subject).toLowerCase()))
  if (direct) return direct
  if (normalized.includes('fisico-quimicas')) return users.get('doc.cfq.alvarez')
  if (normalized.includes('ambiente')) return users.get('doc.ciencias.ambiente')
  if (normalized.includes('lengua')) return users.get('doc.lengua.silva')
  return users.get('doc.mat.ferreira')
}

async function createSchoolYears() {
  const data = [
    [2024, 'Ciclo lectivo 2024', 'CLOSED', utcDate(2024, 3, 4), utcDate(2024, 12, 13)],
    [2025, 'Ciclo lectivo 2025', 'CLOSED', utcDate(2025, 3, 3), utcDate(2025, 12, 12)],
    [2026, 'Ciclo lectivo 2026', 'ACTIVE', utcDate(2026, 3, 2), utcDate(2026, 12, 11)],
  ]
  const years = new Map()
  for (const [code, label, status, startsOn, endsOn] of data) {
    const y = await prisma.schoolYear.create({ data: { code, label, status, startsOn, endsOn } })
    years.set(code, y)
  }
  return years
}

async function createCoursesAndOfferings(years) {
  const courses = new Map()
  const offerings = new Map()
  const allCourses = [...ACTIVE_2026_GROUPS, ...CATALOG_ONLY]
  for (const [code, level, label] of allCourses) {
    const activeCatalog = !code.endsWith('-CAT')
    const course = await prisma.course.create({
      data: {
        code,
        name: label,
        description: activeCatalog
          ? 'Grupo del catalogo academico del liceo.'
          : 'Orientacion EMS disponible como catalogo, sin grupo activo 2026.',
        isActive: activeCatalog,
        subjects: {
          create: SUBJECTS_BY_LEVEL[level].map((name, index) => ({
            name,
            code: `${code}-${index + 1}`,
            sortOrder: index + 1,
            isActive: true,
          })),
        },
      },
      include: { subjects: true },
    })
    courses.set(code, { ...course, level })
  }

  for (const year of [2024, 2025, 2026]) {
    for (const [code] of ACTIVE_2026_GROUPS) {
      const course = courses.get(code)
      const offering = await prisma.courseOffering.create({
        data: {
          courseId: course.id,
          schoolYearId: years.get(year).id,
          isActive: year === 2026,
          notes: year === 2026 ? 'Grupo en cursado activo.' : 'Grupo historico finalizado.',
        },
        include: { course: { include: { subjects: true } }, schoolYear: true },
      })
      offerings.set(`${year}:${code}`, offering)
    }
  }

  for (const [code] of CATALOG_ONLY) {
    const course = courses.get(code)
    const offering = await prisma.courseOffering.create({
      data: {
        courseId: course.id,
        schoolYearId: years.get(2026).id,
        isActive: false,
        notes: 'Orientacion disponible como catalogo 2026, sin cursado activo.',
      },
      include: { course: { include: { subjects: true } }, schoolYear: true },
    })
    offerings.set(`2026:${code}`, offering)
  }

  return { courses, offerings }
}

function nextPath(level, track) {
  if (level === '7') return { level: '8' }
  if (level === '8') return { level: '9' }
  if (level === '9') return { level: '1EMS' }
  if (level === '1EMS') return { level: track === 'HUM' ? '2EMS_HUM' : '2EMS_CIENT', track }
  if (level === '2EMS_CIENT') return { level: '3EMS_CIENT', track: 'CIENT' }
  if (level === '2EMS_HUM') return { level: '3EMS_HUM', track: 'HUM' }
  return null
}

function groupCodeFor(level, seed) {
  if (level === '7') return seed % 2 === 0 ? '7A' : '7B'
  if (level === '8') return seed % 2 === 0 ? '8A' : '8B'
  if (level === '9') return seed % 2 === 0 ? '9A' : '9B'
  if (level === '1EMS') return seed % 2 === 0 ? '1EMS-A' : '1EMS-B'
  if (level === '2EMS_CIENT') return '2EMS-CIENT-A'
  if (level === '2EMS_HUM') return '2EMS-HUM-A'
  if (level === '3EMS_CIENT') return '3EMS-CIENT-A'
  if (level === '3EMS_HUM') return '3EMS-HUM-A'
  return null
}

async function createStudents(years, offerings) {
  const cohorts = [
    { startYear: 2024, startLevel: '7', count: 34 },
    { startYear: 2024, startLevel: '8', count: 30 },
    { startYear: 2024, startLevel: '9', count: 28 },
    { startYear: 2024, startLevel: '1EMS', count: 24 },
    { startYear: 2024, startLevel: '2EMS_CIENT', count: 12 },
    { startYear: 2024, startLevel: '2EMS_HUM', count: 10 },
    { startYear: 2024, startLevel: '3EMS_CIENT', count: 8 },
    { startYear: 2024, startLevel: '3EMS_HUM', count: 7 },
    { startYear: 2025, startLevel: '7', count: 24 },
    { startYear: 2025, startLevel: '1EMS', count: 14 },
    { startYear: 2025, startLevel: '2EMS_CIENT', count: 5 },
    { startYear: 2025, startLevel: '2EMS_HUM', count: 4 },
    { startYear: 2026, startLevel: '7', count: 27 },
    { startYear: 2026, startLevel: '1EMS', count: 9 },
  ]
  let index = 0
  const students = []
  for (const cohort of cohorts) {
    const { startYear, startLevel, count } = cohort
    for (let i = 0; i < count; i++) {
      index += 1
      const firstName = FIRST_NAMES[(index - 1) % FIRST_NAMES.length]
      const firstLastName = LAST_NAMES[Math.floor((index - 1) / FIRST_NAMES.length) % LAST_NAMES.length]
      const secondLastName = LAST_NAMES[(index * 7 + 5) % LAST_NAMES.length]
      const lastName = secondLastName === firstLastName
        ? `${firstLastName} ${LAST_NAMES[(index * 11 + 3) % LAST_NAMES.length]}`
        : `${firstLastName} ${secondLastName}`
      const track = index % 3 === 0 ? 'HUM' : 'CIENT'
      const student = await prisma.student.create({
        data: {
          firstName,
          lastName,
          documentId: `5${String(2000000 + index * 29).slice(0, 7)}`,
          contactPhone: `094${String(400000 + index).slice(-6)}`,
          tutorPhone: `099${String(700000 + index).slice(-6)}`,
          contactEmail: `${firstName}.${lastName}.${index}@familias.testing`.toLowerCase(),
          address: `Barrio ${['Centro', 'Cordon', 'La Blanqueada', 'Union', 'Prado', 'Aguada'][index % 6]}, Montevideo`,
          healthCardExpiresAt: utcDate(2026 + (index % 2), (index % 12) + 1, 20),
          liceoAccessNotes: index % 17 === 0 ? 'Familia solicita comunicaciones por telefono.' : null,
          internalNotes: index % 23 === 0 ? 'Seguimiento por adscripcion.' : null,
        },
      })
      students.push(student)

      let level = startLevel
      let repeated = false
      for (const year of [2024, 2025, 2026].filter((y) => y >= startYear)) {
        if (!level) break
        const transferred = (index % 37 === 0 && year === 2025) || (index % 29 === 0 && year === 2026)
        const withdrawn = (index % 41 === 0 && year === 2024) || (index % 43 === 0 && year === 2025) || (index % 47 === 0 && year === 2026)
        const repeatThisYear = index % 19 === 0 && year === 2025 && !repeated
        const groupCode = groupCodeFor(level, index)
        const offering = offerings.get(`${year}:${groupCode}`)
        if (offering) {
          const next = nextPath(level, track)
          const graduatesThisYear = year < 2026 && !next && !transferred && !withdrawn
          const enrollmentStatus = transferred
            ? 'TRANSFERRED'
            : withdrawn
              ? 'WITHDRAWN'
              : graduatesThisYear
                ? 'GRADUATED'
                : 'ACTIVE'
          await prisma.studentEnrollment.create({
            data: {
              studentId: student.id,
              schoolYearId: years.get(year).id,
              courseOfferingId: offering.id,
              enrollmentStatus,
              withdrawnAt: transferred || withdrawn || graduatesThisYear ? utcDate(year, transferred ? 6 : withdrawn ? 5 : 11, 15) : null,
              withdrawalAcademicYear: transferred || withdrawn || graduatesThisYear ? year : null,
              notes: `${year === 2026 ? 'Matricula vigente' : 'Matricula historica'} - ${groupCode}.`,
            },
          })
          await prisma.studentTuitionYear.create({
            data: {
              studentId: student.id,
              year,
              paid: year < 2026 ? index % 17 !== 0 : index % 11 !== 0,
              paidAt: (year < 2026 ? index % 17 !== 0 : index % 11 !== 0) ? utcDate(year, 3, 10 + (index % 12)) : null,
              amountCents: 185000,
              notes: (year < 2026 ? index % 17 === 0 : index % 11 === 0) ? 'Saldo anual pendiente.' : 'Anualidad registrada.',
            },
          })
          const lastMonth = year === 2026 ? 5 : 11
          for (let month = 3; month <= lastMonth; month++) {
            const paid = year < 2026
              ? (index + month + year) % 13 !== 0
              : (index + month + year) % 7 !== 0
            await prisma.studentTuitionMonth.create({
              data: {
                studentId: student.id,
                year,
                month,
                paid,
                paidAt: paid ? utcDate(year, month, 8 + (index % 5)) : null,
                amountCents: 15500,
                notes: paid ? 'Mensualidad paga.' : 'Mensualidad pendiente.',
              },
            })
          }
        }
        if (transferred || withdrawn) break
        if (repeatThisYear) {
          repeated = true
        } else {
          const next = nextPath(level, track)
          level = next?.level
        }
      }
    }
  }
  return students
}

function firstMonday(year) {
  return year === 2024 ? utcDate(2024, 3, 4) : year === 2025 ? utcDate(2025, 3, 3) : utcDate(2026, 3, 2)
}

function endLimit(year) {
  return year === 2026 ? TODAY : utcDate(year, 11, 29)
}

function eventStatus(year) {
  return year === 2026 ? 'SCHEDULED' : 'COMPLETED'
}

function recurrenceEnd(year) {
  return year === 2026 ? utcDate(2026, 12, 4) : utcDate(year, 11, 29)
}

async function createEventsAndAttendance(years, offerings, users) {
  const admin = users.get('admin')
  const slots = [
    [[1, 3], 8, 0],
    [[2, 4], 8, 0],
    [[1, 3], 9, 40],
    [[2, 4], 9, 40],
    [[1, 5], 11, 20],
    [[3, 5], 11, 20],
    [[1], 13, 0],
    [[2], 13, 0],
    [[3], 13, 0],
    [[4], 13, 0],
    [[5], 13, 0],
  ]
  const teacherBusy = new Set()
  const groupBusy = new Set()
  const attendances = []
  const incidents = []
  let eventCount = 0

  for (const year of [2024, 2025, 2026]) {
    for (const [groupCode] of ACTIVE_2026_GROUPS) {
      const offering = offerings.get(`${year}:${groupCode}`)
      if (!offering) continue
      const subjects = offering.course.subjects
      for (let subjectIndex = 0; subjectIndex < subjects.length; subjectIndex++) {
        const subject = subjects[subjectIndex]
        const teacher = teacherFor(subject.name, users)
        let picked = null
        for (let attempt = 0; attempt < slots.length; attempt++) {
          const slot = slots[(subjectIndex * 2 + attempt + groupCode.length) % slots.length]
          const [days, hour, minute] = slot
          const keys = days.map((day) => `${year}:${day}:${hour}:${minute}`)
          const hasClash = keys.some((key) => teacherBusy.has(`${teacher.id}:${key}`) || groupBusy.has(`${groupCode}:${key}`))
          if (!hasClash) {
            picked = slot
            for (const key of keys) {
              teacherBusy.add(`${teacher.id}:${key}`)
              groupBusy.add(`${groupCode}:${key}`)
            }
            break
          }
        }
        if (!picked) continue
        const [daysOfWeek, hour, minute] = picked
        let startDate = firstMonday(year)
        while (startDate.getUTCDay() !== daysOfWeek[0]) startDate = addDays(startDate, 1)
        const startTime = classTime(startDate, hour, minute)
        const endTime = new Date(startTime.getTime() + 90 * 60 * 1000)
        const event = await prisma.event.create({
          data: {
            title: `${subject.name} - ${offering.course.name}`,
            description: year === 2026 ? 'Clase activa del ciclo lectivo 2026.' : `Clase historica finalizada ${year}.`,
            type: 'CLASE',
            status: eventStatus(year),
            startDate,
            endDate: startDate,
            startTime,
            endTime,
            location: `Aula ${100 + (eventCount % 18)}`,
            userId: admin.id,
            assignedUserId: teacher.id,
            schoolYearId: years.get(year).id,
            courseOfferingId: offering.id,
            subjectId: subject.id,
            recurrenceType: 'WEEKLY',
            recurrenceEnd: recurrenceEnd(year),
            isRecurring: true,
            daysOfWeek,
          },
        })
        eventCount += 1

        const rand = rng(year * 1000 + eventCount)
        for (let occurrence = new Date(startDate); occurrence <= endLimit(year); occurrence = addDays(occurrence, 1)) {
          if (!daysOfWeek.includes(occurrence.getUTCDay())) continue
          const r = rand()
          const status = r < 0.025 ? 'ABSENT_NOT_JUSTIFIED' : r < 0.06 ? 'ABSENT_JUSTIFIED' : r < 0.15 ? 'LATE' : 'PRESENT'
          const checkInTime = status === 'LATE'
            ? new Date(classTime(occurrence, hour, minute).getTime() + (8 + Math.floor(rand() * 18)) * 60 * 1000)
            : classTime(occurrence, hour, minute)
          attendances.push({
            userId: teacher.id,
            eventId: event.id,
            type: 'CHECK_IN',
            status,
            date: occurrence,
            time: checkInTime,
            notes: status === 'PRESENT' ? 'Ingreso registrado.' : 'Registro generado para historial de asistencia docente.',
          })
          if (status !== 'ABSENT_NOT_JUSTIFIED') {
            attendances.push({
              userId: teacher.id,
              eventId: event.id,
              type: 'CHECK_OUT',
              status: rand() < 0.04 ? 'EARLY_EXIT' : 'EXIT',
              date: occurrence,
              time: new Date(classTime(occurrence, hour, minute).getTime() + 90 * 60 * 1000),
              notes: 'Salida registrada.',
            })
          }
          if (status === 'ABSENT_NOT_JUSTIFIED' || status === 'LATE') {
            incidents.push({ eventId: event.id, userId: teacher.id, date: occurrence, status })
          }
        }
      }
    }
  }

  for (let i = 0; i < attendances.length; i += 500) {
    await prisma.attendance.createMany({ data: attendances.slice(i, i + 500) })
  }

  for (const incident of incidents.slice(0, 60)) {
    await prisma.attendanceIncident.create({
      data: {
        type: incident.status === 'LATE' ? 'LATE_ARRIVAL' : 'TEACHER_NO_SHOW',
        status: 'RESOLVED',
        title: incident.status === 'LATE' ? 'Llegada tarde a clase' : 'Ausencia docente sin justificar',
        description: `Incidente detectado en ${dateKey(incident.date)}.`,
        severity: incident.status === 'LATE' ? 'MEDIUM' : 'HIGH',
        userId: incident.userId,
        eventId: incident.eventId,
        detectedAt: incident.date,
        acknowledgedAt: addDays(incident.date, 1),
        resolvedAt: addDays(incident.date, 2),
        resolvedBy: admin.id,
      },
    })
  }

  for (const year of [2024, 2025, 2026]) {
    const staffStart = firstMonday(year)
    for (const username of ['adscripta.turno', 'coordinacion']) {
      const staff = users.get(username)
      const startTime = classTime(staffStart, 8, 0)
      const endTime = classTime(staffStart, 16, 0)
      await prisma.event.create({
        data: {
          title: username === 'adscripta.turno' ? 'Turno de adscripcion' : 'Turno de coordinacion',
          description: year === 2026
            ? 'Jornada laboral activa de lunes a viernes, 08:00 a 16:00.'
            : `Jornada laboral historica ${year}, lunes a viernes.`,
          type: 'JORNADA_LABORAL',
          status: eventStatus(year),
          startDate: staffStart,
          endDate: staffStart,
          startTime,
          endTime,
          location: username === 'adscripta.turno' ? 'Adscripcion' : 'Direccion',
          userId: admin.id,
          assignedUserId: staff.id,
          schoolYearId: years.get(year).id,
          recurrenceType: 'WEEKLY',
          recurrenceEnd: recurrenceEnd(year),
          isRecurring: true,
          daysOfWeek: [1, 2, 3, 4, 5],
        },
      })
      eventCount += 1
    }
  }

  await prisma.event.create({
    data: {
      title: 'Coordinacion docente semanal',
      description: 'Reunion institucional activa del equipo docente.',
      type: 'REUNION',
      status: 'SCHEDULED',
      startDate: utcDate(2026, 3, 6),
      endDate: utcDate(2026, 3, 6),
      startTime: utcDate(2026, 3, 6, 12, 0),
      endTime: utcDate(2026, 3, 6, 13, 0),
      location: 'Sala docente',
      userId: admin.id,
      assignedUserId: users.get('coordinacion').id,
      schoolYearId: years.get(2026).id,
      recurrenceType: 'WEEKLY',
      recurrenceEnd: utcDate(2026, 12, 4),
      isRecurring: true,
      daysOfWeek: [5],
    },
  })

  return { eventCount, attendanceCount: attendances.length }
}

async function createOperationalExtras(years, users) {
  for (const [date, reason] of [
    [utcDate(2024, 6, 19), 'Natalicio de Artigas'],
    [utcDate(2025, 8, 25), 'Declaratoria de la Independencia'],
    [utcDate(2026, 5, 1), 'Dia de los trabajadores'],
  ]) {
    await prisma.nonWorkingDay.create({
      data: { date, type: 'HOLIDAY', reason, schoolYearId: years.get(date.getUTCFullYear()).id },
    })
  }
  await prisma.medicalLeave.create({
    data: {
      userId: users.get('doc.historia.martin').id,
      type: 'MEDICAL_LEAVE',
      status: 'INACTIVE',
      startDate: utcDate(2025, 8, 4),
      endDate: utcDate(2025, 8, 8, 23, 59),
      reason: 'Reposo medico historico.',
      doctorName: 'Dra. Andrea Pereira',
      approvedBy: users.get('admin').id,
      approvedAt: utcDate(2025, 8, 3),
      deactivatedBy: users.get('admin').id,
      deactivatedAt: utcDate(2025, 8, 9),
    },
  })
  await prisma.medicalLeave.create({
    data: {
      userId: users.get('adscripta.turno').id,
      type: 'MEDICAL_LEAVE',
      status: 'ACTIVE',
      startDate: utcDate(2026, 5, 20),
      endDate: utcDate(2026, 5, 22, 23, 59),
      reason: 'Licencia medica vigente de testing.',
      doctorName: 'Dr. Pablo Correa',
      approvedBy: users.get('admin').id,
      approvedAt: TODAY,
    },
  })
}

async function main() {
  await wipeData()
  const users = await createUsers()
  await prisma.systemSettings.upsert({
    where: { id: 'default' },
    update: { livenessCheckEnabled: true, updatedAt: new Date() },
    create: {
      id: 'default',
      livenessCheckEnabled: true,
      attendanceNoShowGraceMinutes: 15,
      attendanceLateToleranceMinutes: 5,
      attendanceClassBridgeGapMinutes: 60,
      attendanceMonitorEnabled: true,
      attendanceMonitorIntervalMs: 120000,
      biometricLateHour: 8,
      biometricLateMinute: 30,
    },
  })
  const years = await createSchoolYears()
  const { courses, offerings } = await createCoursesAndOfferings(years)
  const students = await createStudents(years, offerings)
  const { eventCount, attendanceCount } = await createEventsAndAttendance(years, offerings, users)
  await createOperationalExtras(years, users)

  console.log('Dataset educativo uruguayo creado.')
  console.log('Credenciales: admin/admin123, adscripta.turno/admin123, doc.mat.ferreira/admin123')
  console.log(`Usuarios: ${users.size}; cursos catalogo: ${courses.size}; ofertas anuales: ${offerings.size}`)
  console.log(`Estudiantes: ${students.length}; eventos clase: ${eventCount}; asistencias docentes: ${attendanceCount}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => prisma.$disconnect())
