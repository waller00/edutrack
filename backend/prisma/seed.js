import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import argon2 from 'argon2'

const prisma = new PrismaClient()

const FIXTURE_PASSWORD = 'admin123'
const EMAIL_DOMAIN = 'edutrack.local'
const SEED_PREFIX = '[SEED_EDUTRACK]'
const FIXTURE_UUID_PREFIX = '00000000-0000-4000-8000-'

const BASE_USERS = [
  {
    slot: 1,
    username: 'admin',
    email: `admin@${EMAIL_DOMAIN}`,
    firstName: 'Admin',
    lastName: 'Principal',
    role: 'ADMIN',
    phone: '+59899000001',
    nationalId: buildValidCi(1234567),
    birthdate: new Date('1986-02-14T00:00:00.000Z'),
    seedProfile: null,
  },
  {
    slot: 2,
    username: 'laura.perez',
    email: `laura.perez@${EMAIL_DOMAIN}`,
    firstName: 'Laura',
    lastName: 'Perez',
    role: 'TEACHER',
    phone: '+59899100011',
    nationalId: buildValidCi(2234567),
    birthdate: new Date('1990-04-08T00:00:00.000Z'),
    seedProfile: {
      seriesCount: 5,
      recurringWeeks: [18, 17, 16, 15, 14, 13, 12, 11, 10, 8, 6],
      historyOffsets: [92, 86, 78, 71, 65, 57, 49, 38, 27],
      attendancePattern: ['FULL', 'LATE', 'FULL', 'EARLY', 'ABSENT', 'FULL', 'LATE', 'FULL', 'ABSENT', 'FULL'],
      leaveWeekOffset: 9,
      leaveLengthDays: 4,
      extraInactiveLeave: true,
    },
  },
  {
    slot: 3,
    username: 'diego.sosa',
    email: `diego.sosa@${EMAIL_DOMAIN}`,
    firstName: 'Diego',
    lastName: 'Sosa',
    role: 'TEACHER',
    phone: '+59899100012',
    nationalId: buildValidCi(2234568),
    birthdate: new Date('1988-09-19T00:00:00.000Z'),
    seedProfile: {
      seriesCount: 4,
      recurringWeeks: [17, 16, 15, 13, 12, 10, 8, 7],
      historyOffsets: [99, 90, 82, 74, 63, 55, 44],
      attendancePattern: ['LATE', 'FULL', 'ABSENT', 'FULL', 'LATE', 'EARLY', 'FULL', 'ABSENT'],
      leaveWeekOffset: 8,
      leaveLengthDays: 3,
      extraInactiveLeave: false,
    },
  },
  {
    slot: 4,
    username: 'valentina.gomez',
    email: `valentina.gomez@${EMAIL_DOMAIN}`,
    firstName: 'Valentina',
    lastName: 'Gomez',
    role: 'TEACHER',
    phone: '+59899100013',
    nationalId: buildValidCi(2234569),
    birthdate: new Date('1993-01-27T00:00:00.000Z'),
    seedProfile: {
      seriesCount: 3,
      recurringWeeks: [18, 16, 14, 13, 11, 9, 7],
      historyOffsets: [87, 80, 70, 61, 52, 41],
      attendancePattern: ['FULL', 'FULL', 'EARLY', 'LATE', 'FULL', 'ABSENT', 'FULL'],
      leaveWeekOffset: 7,
      leaveLengthDays: 5,
      extraInactiveLeave: true,
    },
  },
  {
    slot: 5,
    username: 'staff.pruebas',
    email: `staff.pruebas@${EMAIL_DOMAIN}`,
    firstName: 'Santiago',
    lastName: 'Pruebas',
    role: 'STAFF',
    phone: '+59899200021',
    nationalId: buildValidCi(3234567),
    birthdate: new Date('1989-11-03T00:00:00.000Z'),
    seedProfile: {
      seriesCount: 4,
      recurringWeeks: [18, 17, 15, 14, 12, 11, 9, 8, 6],
      historyOffsets: [96, 88, 79, 72, 64, 58, 50, 43],
      attendancePattern: ['FULL', 'FULL', 'LATE', 'ABSENT', 'FULL', 'EARLY', 'FULL', 'LATE'],
      leaveWeekOffset: 8,
      leaveLengthDays: 4,
      extraInactiveLeave: false,
    },
  },
  {
    slot: 6,
    username: 'camila.rios',
    email: `camila.rios@${EMAIL_DOMAIN}`,
    firstName: 'Camila',
    lastName: 'Rios',
    role: 'TEACHER',
    phone: '+59899100014',
    nationalId: buildValidCi(2234570),
    birthdate: new Date('1991-07-14T00:00:00.000Z'),
    seedProfile: {
      seriesCount: 5,
      recurringWeeks: [18, 17, 16, 14, 13, 12, 10, 9, 8, 6],
      historyOffsets: [101, 94, 85, 77, 68, 59, 48, 34],
      attendancePattern: ['FULL', 'LATE', 'FULL', 'FULL', 'EARLY', 'ABSENT', 'LATE', 'FULL'],
      leaveWeekOffset: 10,
      leaveLengthDays: 3,
      extraInactiveLeave: false,
    },
  },
  {
    slot: 7,
    username: 'bruno.ledesma',
    email: `bruno.ledesma@${EMAIL_DOMAIN}`,
    firstName: 'Bruno',
    lastName: 'Ledesma',
    role: 'TEACHER',
    phone: '+59899100015',
    nationalId: buildValidCi(2234571),
    birthdate: new Date('1987-12-05T00:00:00.000Z'),
    seedProfile: {
      seriesCount: 4,
      recurringWeeks: [17, 15, 14, 12, 11, 9, 7],
      historyOffsets: [98, 91, 84, 75, 66, 56, 46, 36, 28],
      attendancePattern: ['ABSENT', 'FULL', 'LATE', 'FULL', 'ABSENT', 'EARLY', 'FULL'],
      leaveWeekOffset: 6,
      leaveLengthDays: 4,
      extraInactiveLeave: true,
    },
  },
  {
    slot: 8,
    username: 'florencia.nunez',
    email: `florencia.nunez@${EMAIL_DOMAIN}`,
    firstName: 'Florencia',
    lastName: 'Nunez',
    role: 'STAFF',
    phone: '+59899200022',
    nationalId: buildValidCi(3234568),
    birthdate: new Date('1994-03-11T00:00:00.000Z'),
    seedProfile: {
      seriesCount: 4,
      recurringWeeks: [18, 17, 16, 15, 13, 12, 10, 9, 7, 6],
      historyOffsets: [103, 95, 87, 78, 69, 62, 53],
      attendancePattern: ['FULL', 'EARLY', 'FULL', 'LATE', 'FULL', 'ABSENT', 'FULL', 'LATE'],
      leaveWeekOffset: 9,
      leaveLengthDays: 5,
      extraInactiveLeave: false,
    },
  },
  {
    slot: 9,
    username: 'martin.vera',
    email: `martin.vera@${EMAIL_DOMAIN}`,
    firstName: 'Martin',
    lastName: 'Vera',
    role: 'STAFF',
    phone: '+59899200023',
    nationalId: buildValidCi(3234569),
    birthdate: new Date('1985-06-22T00:00:00.000Z'),
    seedProfile: {
      seriesCount: 3,
      recurringWeeks: [18, 16, 14, 12, 10, 8, 6],
      historyOffsets: [90, 82, 76, 68, 60, 51, 42, 33],
      attendancePattern: ['LATE', 'FULL', 'FULL', 'ABSENT', 'EARLY', 'FULL'],
      leaveWeekOffset: 7,
      leaveLengthDays: 4,
      extraInactiveLeave: true,
    },
  },
  {
    slot: 10,
    username: 'soledad.pintos',
    email: `soledad.pintos@${EMAIL_DOMAIN}`,
    firstName: 'Soledad',
    lastName: 'Pintos',
    role: 'STAFF',
    phone: '+59899200024',
    nationalId: buildValidCi(3234570),
    birthdate: new Date('1990-10-18T00:00:00.000Z'),
    seedProfile: {
      seriesCount: 5,
      recurringWeeks: [18, 17, 16, 15, 14, 12, 11, 9, 8, 7, 6],
      historyOffsets: [104, 96, 89, 83, 74, 65, 56, 47, 39],
      attendancePattern: ['FULL', 'FULL', 'LATE', 'FULL', 'EARLY', 'FULL', 'ABSENT', 'LATE', 'FULL'],
      leaveWeekOffset: 11,
      leaveLengthDays: 3,
      extraInactiveLeave: false,
    },
  },
]

const TEACHER_SERIES = [
  { code: 'tutoria', type: 'CLASE', title: 'Tutoría semanal', description: 'Espacio de acompañamiento académico y seguimiento individual.', weekday: 1, hour: 8, minute: 0, durationMinutes: 90, location: 'Aula 201' },
  { code: 'seguimiento', type: 'REUNION', title: 'Reunión de seguimiento', description: 'Revisión de avance con coordinación y familias.', weekday: 2, hour: 11, minute: 0, durationMinutes: 60, location: 'Sala de reuniones' },
  { code: 'taller', type: 'CAPACITACION', title: 'Taller de acompañamiento', description: 'Espacio fijo para metodologías activas y planificación.', weekday: 3, hour: 15, minute: 0, durationMinutes: 120, location: 'Salón multiuso' },
  { code: 'consulta', type: 'EVENTO', title: 'Espacio de consulta', description: 'Bloque recurrente para entrevistas, devoluciones y consultas.', weekday: 4, hour: 17, minute: 30, durationMinutes: 90, location: 'Sala de tutorías' },
]

const STAFF_SERIES = [
  { code: 'mesa', type: 'JORNADA_LABORAL', title: 'Turno de mesa de entradas', description: 'Atención al público, recepción de documentación y derivaciones.', weekday: 1, hour: 8, minute: 30, durationMinutes: 480, location: 'Recepción' },
  { code: 'coordinacion', type: 'REUNION', title: 'Reunión operativa', description: 'Coordinación semanal de tareas administrativas.', weekday: 2, hour: 10, minute: 0, durationMinutes: 60, location: 'Oficina central' },
  { code: 'archivo', type: 'EVENTO', title: 'Bloque de archivo y seguimiento', description: 'Actualización de legajos, seguimiento de casos y trazabilidad.', weekday: 3, hour: 14, minute: 0, durationMinutes: 120, location: 'Archivo' },
  { code: 'capacitacion', type: 'CAPACITACION', title: 'Capacitación administrativa', description: 'Instancia periódica para procesos internos y herramientas del sistema.', weekday: 4, hour: 16, minute: 0, durationMinutes: 120, location: 'Sala de informática' },
]

const TEACHER_HISTORICAL_TITLES = [
  'Tutoría individual cerrada',
  'Clase abierta de apoyo',
  'Reunión con familias',
  'Taller de resolución de conflictos',
  'Acompañamiento de evaluación',
  'Encuentro de coordinación docente',
  'Jornada de cierre de período',
]

const STAFF_HISTORICAL_TITLES = [
  'Cierre administrativo mensual',
  'Recepción extraordinaria de documentación',
  'Reunión de coordinación interna',
  'Capacitación de procesos',
  'Seguimiento de expedientes',
  'Inventario operativo',
  'Atención extendida a familias',
]

const ATTENDANCE_PATTERNS = {
  FULL: { checkIn: 'PRESENT', checkOut: 'EXIT', note: 'Asistencia puntual y jornada completa.' },
  LATE: { checkIn: 'LATE', checkOut: 'EXIT', note: 'Ingreso tardío con recuperación del tiempo.' },
  EARLY: { checkIn: 'PRESENT', checkOut: 'EARLY_EXIT', note: 'Salida anticipada por coordinación externa.' },
  ABSENT: { checkIn: 'ABSENT_NOT_JUSTIFIED', checkOut: null, note: 'Ausencia registrada sin justificación.' },
}

function fixtureId(n) {
  return `${FIXTURE_UUID_PREFIX}${String(n).padStart(12, '0')}`
}

function startOfDay(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function endOfDay(date) {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d
}

function addDays(date, days) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function addMonths(date, months) {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

function withTime(date, hour, minute = 0) {
  const d = new Date(date)
  d.setHours(hour, minute, 0, 0)
  return d
}

function buildValidCi(baseNumber) {
  const base7 = String(baseNumber).padStart(7, '0')
  const weights = [2, 9, 8, 7, 6, 3, 4]
  const sum = base7.split('').reduce((acc, digit, index) => acc + Number(digit) * weights[index], 0)
  const checkDigit = (10 - (sum % 10)) % 10
  return `${base7}${checkDigit}`
}

function getWeekdayInWeek(referenceMonday, weekOffset, weekday) {
  return addDays(referenceMonday, -(weekOffset * 7) + (weekday - 1))
}

function getMonday(date) {
  const d = startOfDay(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  return addDays(d, diff)
}

function makeSeedNote(text) {
  return `${SEED_PREFIX} ${text}`
}

function getRoleDisplay(role) {
  return role === 'TEACHER' ? 'Tutor' : 'Staff'
}

function getSeriesTemplates(role) {
  return role === 'TEACHER' ? TEACHER_SERIES : STAFF_SERIES
}

function getHistoricalTitles(role) {
  return role === 'TEACHER' ? TEACHER_HISTORICAL_TITLES : STAFF_HISTORICAL_TITLES
}

function getUserSeedProfile(user) {
  return BASE_USERS.find((spec) => spec.username === user.username || spec.email === user.email)?.seedProfile || null
}

async function ensureSchoolYearBackfill() {
  let active = await prisma.schoolYear.findFirst({ where: { status: 'ACTIVE' }, orderBy: { code: 'desc' } })
  if (!active) {
    const code = new Date().getUTCFullYear()
    active = await prisma.schoolYear.create({
      data: { code, label: `Ciclo lectivo ${code}`, status: 'ACTIVE' },
    })
  }
  await prisma.course.updateMany({ where: { schoolYearId: null }, data: { schoolYearId: active.id } })
  await prisma.event.updateMany({ where: { schoolYearId: null }, data: { schoolYearId: active.id } })
  await prisma.student.updateMany({ where: { schoolYearId: null }, data: { schoolYearId: active.id } })
}

async function cleanupManagedArtifacts() {
  await prisma.attendance.deleteMany({
    where: {
      OR: [
        { notes: { contains: SEED_PREFIX } },
        { id: { startsWith: FIXTURE_UUID_PREFIX } },
      ],
    },
  })

  await prisma.medicalLeave.deleteMany({
    where: {
      OR: [
        { notes: { contains: SEED_PREFIX } },
        { id: { startsWith: FIXTURE_UUID_PREFIX } },
      ],
    },
  })

  await prisma.event.deleteMany({
    where: {
      OR: [
        { description: { contains: SEED_PREFIX } },
        { id: { startsWith: FIXTURE_UUID_PREFIX } },
      ],
    },
  })
}

async function upsertBaseUsers(passwordHash, now) {
  const summary = { created: 0, updated: 0 }
  const users = []

  const orgRoles = await prisma.orgRole.findMany({ select: { id: true, code: true } })
  const roleIdByCode = new Map(orgRoles.map((r) => [r.code, r.id]))

  for (const spec of BASE_USERS) {
    const roleId = roleIdByCode.get(spec.role)
    if (!roleId) {
      throw new Error(`[${SEED_PREFIX}] Falta OrgRole '${spec.role}' en la base (¿seed-org-roles antes de seed.js?)`)
    }

    const existing = await prisma.user.findFirst({
      where: {
        OR: [
          { email: spec.email },
          { username: spec.username },
        ],
      },
    })

    const createData = {
      id: fixtureId(spec.slot),
      email: spec.email,
      username: spec.username,
      firstName: spec.firstName,
      lastName: spec.lastName,
      name: `${spec.firstName} ${spec.lastName}`,
      roleId,
      phone: spec.phone,
      nationalId: spec.nationalId,
      birthdate: spec.birthdate,
      passwordHash,
      emailVerifiedAt: now,
      isApproved: true,
      approvedAt: now,
      isActive: true,
      failedLoginAttempts: 0,
      lockUntil: null,
      createdAt: addMonths(now, -4),
      updatedAt: now,
    }

    const updateData = {
      email: spec.email,
      username: spec.username,
      firstName: spec.firstName,
      lastName: spec.lastName,
      name: `${spec.firstName} ${spec.lastName}`,
      roleId,
      phone: spec.phone,
      nationalId: spec.nationalId,
      birthdate: spec.birthdate,
      passwordHash,
      emailVerifiedAt: now,
      isApproved: true,
      approvedAt: now,
      isActive: true,
      failedLoginAttempts: 0,
      lockUntil: null,
      updatedAt: now,
    }

    const userRecord = existing
      ? await prisma.user.update({ where: { id: existing.id }, data: updateData })
      : await prisma.user.create({ data: createData })

    if (existing) summary.updated += 1
    else summary.created += 1

    users.push({ ...userRecord, role: spec.role })
  }

  return { users, summary }
}

function buildRecurringEventsForUser({ adminId, user, userIndex, monday, now }) {
  const templates = getSeriesTemplates(user.role)
  const profile = getUserSeedProfile(user)
  const selectedTemplates = Array.from({ length: profile.seriesCount }, (_, i) => templates[(i + userIndex - 1) % templates.length])

  return selectedTemplates.map((template, seriesIndex) => {
    const seriesStartDay = getWeekdayInWeek(monday, Math.max(...profile.recurringWeeks), template.weekday)
    const startTime = withTime(seriesStartDay, template.hour, template.minute)
    const endTime = new Date(startTime.getTime() + template.durationMinutes * 60 * 1000)
    const recurringId = fixtureId(100000 + userIndex * 1000 + seriesIndex)

    return {
      id: recurringId,
      title: `${template.title} · ${user.firstName} ${user.lastName}`,
      description: makeSeedNote(`${getRoleDisplay(user.role)} recurrente: ${template.description}`),
      type: template.type,
      status: 'SCHEDULED',
      startDate: seriesStartDay,
      endDate: seriesStartDay,
      startTime,
      endTime,
      location: template.location,
      userId: adminId,
      assignedUserId: user.id,
      recurrenceType: 'WEEKLY',
      recurrenceEnd: addDays(now, 14),
      isRecurring: true,
      daysOfWeek: [template.weekday],
      createdAt: addDays(seriesStartDay, -7),
      updatedAt: now,
      seedMeta: template,
    }
  })
}

function buildHistoricalEventsForUser({ adminId, user, userIndex, now }) {
  const titles = getHistoricalTitles(user.role)
  const profile = getUserSeedProfile(user)
  const offsets = profile.historyOffsets

  return offsets.map((daysAgo, normalIndex) => {
    const day = startOfDay(addDays(now, -daysAgo))
    const title = titles[normalIndex]
    const hour = user.role === 'TEACHER' ? 8 + (normalIndex % 4) * 2 : 9 + (normalIndex % 3) * 2
    const durationMinutes = user.role === 'TEACHER' ? 90 : normalIndex % 2 === 0 ? 240 : 120
    const startTime = withTime(day, hour, normalIndex % 2 === 0 ? 0 : 30)
    const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000)
    const id = fixtureId(200000 + userIndex * 1000 + normalIndex)

    const type = user.role === 'TEACHER'
      ? ['CLASE', 'REUNION', 'CAPACITACION', 'EVENTO'][normalIndex % 4]
      : ['JORNADA_LABORAL', 'REUNION', 'CAPACITACION', 'EVENTO'][normalIndex % 4]

    return {
      id,
      title: `${title} · ${user.firstName}`,
      description: makeSeedNote(`Evento histórico finalizado para ${user.name}.`),
      type,
      status: 'COMPLETED',
      startDate: day,
      endDate: day,
      startTime,
      endTime,
      location: user.role === 'TEACHER' ? 'Aula asignada' : 'Área administrativa',
      userId: adminId,
      assignedUserId: user.id,
      recurrenceType: 'NONE',
      recurrenceEnd: null,
      isRecurring: false,
      daysOfWeek: [],
      createdAt: addDays(day, -5),
      updatedAt: addDays(day, 1),
    }
  })
}

function buildMedicalLeaveForUser({ adminId, user, userIndex, monday }) {
  const profile = getUserSeedProfile(user)
  const leaveStart = getWeekdayInWeek(monday, profile.leaveWeekOffset, 1)
  const leaveEnd = endOfDay(addDays(leaveStart, profile.leaveLengthDays - 1))
  const approvedAt = addDays(leaveStart, -3)

  return {
    id: fixtureId(300000 + userIndex),
    userId: user.id,
    type: 'MEDICAL_LEAVE',
    status: 'ACTIVE',
    startDate: startOfDay(leaveStart),
    endDate: leaveEnd,
    reason: `Licencia médica pasada por cuadro viral y reposo indicado para ${user.firstName}.`,
    doctorName: user.role === 'TEACHER' ? 'Dra. Mariana Costa' : 'Dr. Pablo Barreto',
    doctorPhone: '+59829001122',
    certificate: `certificados/${user.username}-licencia-medica.pdf`,
    approvedBy: adminId,
    approvedAt,
    deactivatedBy: null,
    deactivatedAt: null,
    notes: makeSeedNote(`Licencia histórica para testing funcional. Período ${leaveStart.toISOString()} a ${leaveEnd.toISOString()}.`),
    createdAt: addDays(approvedAt, -1),
    updatedAt: approvedAt,
  }
}

function buildSecondaryLeaveForUser({ adminId, user, userIndex, monday }) {
  const profile = getUserSeedProfile(user)
  if (!profile.extraInactiveLeave) return null

  const leaveStart = getWeekdayInWeek(monday, profile.leaveWeekOffset + 5, 2)
  const leaveEnd = endOfDay(addDays(leaveStart, 1))

  return {
    id: fixtureId(310000 + userIndex),
    userId: user.id,
    type: user.role === 'TEACHER' ? 'WORK_LEAVE' : 'OTHER',
    status: 'INACTIVE',
    startDate: startOfDay(leaveStart),
    endDate: leaveEnd,
    reason: `Licencia histórica secundaria para ${user.firstName}, usada en pruebas de filtros por estado.`,
    doctorName: null,
    doctorPhone: null,
    certificate: null,
    approvedBy: adminId,
    approvedAt: addDays(leaveStart, -2),
    deactivatedBy: adminId,
    deactivatedAt: addDays(leaveEnd, 2),
    notes: makeSeedNote(`Licencia secundaria inactiva para testing de historial.`),
    createdAt: addDays(leaveStart, -3),
    updatedAt: addDays(leaveEnd, 2),
  }
}

function getAttendancePatternForUser(user, index) {
  const profile = getUserSeedProfile(user)
  const key = profile.attendancePattern[index % profile.attendancePattern.length]
  return ATTENDANCE_PATTERNS[key]
}

function buildAttendancesForUser({ user, userIndex, recurringEvents, historicalEvents, leave }) {
  const attendances = []
  let justifiedCount = 0
  let sequence = 0
  const profile = getUserSeedProfile(user)
  const weeklyOffsets = profile.recurringWeeks

  for (const recurringEvent of recurringEvents) {
    for (const weekOffset of weeklyOffsets) {
      const eventDay = getWeekdayInWeek(getMonday(new Date()), weekOffset, recurringEvent.seedMeta.weekday)
      const date = startOfDay(eventDay)
      const insideLeave = date >= startOfDay(leave.startDate) && date <= startOfDay(leave.endDate)
      const attendanceIdBase = 400000 + userIndex * 10000 + sequence * 10

      if (insideLeave) {
        attendances.push({
          id: fixtureId(attendanceIdBase),
          userId: user.id,
          eventId: recurringEvent.id,
          type: 'CHECK_IN',
          status: 'ABSENT_JUSTIFIED',
          date,
          time: new Date(recurringEvent.startTime.getTime() - 5 * 60 * 1000),
          notes: makeSeedNote(`Ausencia justificada por licencia ${leave.id} durante ${date.toISOString().slice(0, 10)}.`),
          createdAt: addDays(date, 0),
          updatedAt: addDays(date, 0),
        })
        justifiedCount += 1
        sequence += 1
        continue
      }

      const pattern = getAttendancePatternForUser(user, sequence)
      const checkInTime = pattern.checkIn === 'LATE'
        ? new Date(recurringEvent.startTime.getTime() + 12 * 60 * 1000)
        : new Date(recurringEvent.startTime.getTime() - 3 * 60 * 1000)

      attendances.push({
        id: fixtureId(attendanceIdBase),
        userId: user.id,
        eventId: recurringEvent.id,
        type: 'CHECK_IN',
        status: pattern.checkIn,
        date,
        time: checkInTime,
        notes: makeSeedNote(pattern.note),
        createdAt: date,
        updatedAt: date,
      })

      if (pattern.checkOut) {
        const checkOutTime = pattern.checkOut === 'EARLY_EXIT'
          ? new Date(recurringEvent.endTime.getTime() - 18 * 60 * 1000)
          : new Date(recurringEvent.endTime.getTime() + 4 * 60 * 1000)

        attendances.push({
          id: fixtureId(attendanceIdBase + 1),
          userId: user.id,
          eventId: recurringEvent.id,
          type: 'CHECK_OUT',
          status: pattern.checkOut,
          date,
          time: checkOutTime,
          notes: makeSeedNote(pattern.note),
          createdAt: date,
          updatedAt: date,
        })
      }

      sequence += 1
    }
  }

  historicalEvents.forEach((event, index) => {
    const attendanceIdBase = 500000 + userIndex * 10000 + index * 10
    const pattern = getAttendancePatternForUser(user, index + recurringEvents.length + 1)
    const date = startOfDay(event.startDate)
    const checkInTime = pattern.checkIn === 'LATE'
      ? new Date(event.startTime.getTime() + 10 * 60 * 1000)
      : new Date(event.startTime.getTime() - 4 * 60 * 1000)

    attendances.push({
      id: fixtureId(attendanceIdBase),
      userId: user.id,
      eventId: event.id,
      type: 'CHECK_IN',
      status: pattern.checkIn,
      date,
      time: checkInTime,
      notes: makeSeedNote(`Historial: ${pattern.note}`),
      createdAt: date,
      updatedAt: date,
    })

    if (pattern.checkOut) {
      const checkOutTime = pattern.checkOut === 'EARLY_EXIT'
        ? new Date(event.endTime.getTime() - 15 * 60 * 1000)
        : new Date(event.endTime.getTime() + 2 * 60 * 1000)

      attendances.push({
        id: fixtureId(attendanceIdBase + 1),
        userId: user.id,
        eventId: event.id,
        type: 'CHECK_OUT',
        status: pattern.checkOut,
        date,
        time: checkOutTime,
        notes: makeSeedNote(`Historial: ${pattern.note}`),
        createdAt: date,
        updatedAt: date,
      })
    }
  })

  return { attendances, justifiedCount }
}

function buildDataset(users, now) {
  const admin = users.find((user) => user.role === 'ADMIN')
  if (!admin) throw new Error('No se encontró usuario administrador para generar fixtures')

  const monday = getMonday(now)
  const nonAdminUsers = users.filter((user) => user.role !== 'ADMIN')

  const dataset = {
    recurringEvents: [],
    normalEvents: [],
    attendances: [],
    leaves: [],
    justifiedCount: 0,
  }

  nonAdminUsers.forEach((user, index) => {
    const userIndex = index + 1
    const recurringEvents = buildRecurringEventsForUser({ adminId: admin.id, user, userIndex, monday, now })
    const normalEvents = buildHistoricalEventsForUser({ adminId: admin.id, user, userIndex, now })
    const leave = buildMedicalLeaveForUser({ adminId: admin.id, user, userIndex, monday })
    const secondaryLeave = buildSecondaryLeaveForUser({ adminId: admin.id, user, userIndex, monday })
    const { attendances, justifiedCount } = buildAttendancesForUser({ user, userIndex, recurringEvents, historicalEvents: normalEvents, leave })

    dataset.recurringEvents.push(...recurringEvents.map(({ seedMeta, ...event }) => event))
    dataset.normalEvents.push(...normalEvents)
    dataset.attendances.push(...attendances)
    dataset.leaves.push(leave)
    if (secondaryLeave) dataset.leaves.push(secondaryLeave)
    dataset.justifiedCount += justifiedCount
  })

  return dataset
}

async function upsertEvents(events) {
  for (const event of events) {
    const { createdAt, ...updateData } = event
    await prisma.event.upsert({
      where: { id: event.id },
      create: event,
      update: updateData,
    })
  }
}

async function upsertAttendances(attendances) {
  for (const attendance of attendances) {
    const { createdAt, ...updateData } = attendance
    await prisma.attendance.upsert({
      where: { id: attendance.id },
      create: attendance,
      update: updateData,
    })
  }
}

async function upsertMedicalLeaves(leaves) {
  for (const leave of leaves) {
    const { createdAt, ...updateData } = leave
    await prisma.medicalLeave.upsert({
      where: { id: leave.id },
      create: leave,
      update: updateData,
    })
  }
}

async function main() {
  const now = new Date()
  const passwordHash = await argon2.hash(FIXTURE_PASSWORD, { type: argon2.argon2id })

  console.log('Limpiando artefactos previos del seed...')
  await cleanupManagedArtifacts()

  console.log('Asegurando usuarios base persistentes...')
  const { users, summary: userSummary } = await upsertBaseUsers(passwordHash, now)

  console.log('Generando dataset relacional de testing...')
  const dataset = buildDataset(users, now)

  console.log('Persistiendo licencias médicas...')
  await upsertMedicalLeaves(dataset.leaves)

  console.log('Persistiendo eventos recurrentes...')
  await upsertEvents(dataset.recurringEvents)

  console.log('Persistiendo eventos históricos...')
  await upsertEvents(dataset.normalEvents)

  console.log('Persistiendo asistencias...')
  await upsertAttendances(dataset.attendances)

  const managedUsers = users.filter((user) => user.role !== 'ADMIN')
  const attendancePerUser = await prisma.attendance.groupBy({
    by: ['userId'],
    where: { userId: { in: managedUsers.map((user) => user.id) } },
    _count: { _all: true },
  })

  console.log('Asegurando ciclos lectivos (schoolYearId en datos semilla)…')
  await ensureSchoolYearBackfill()

  console.log('')
  console.log('Seed EduTrack persistente completado')
  console.log(`Usuarios creados: ${userSummary.created}`)
  console.log(`Usuarios actualizados: ${userSummary.updated}`)
  console.log(`Eventos repetitivos creados/actualizados: ${dataset.recurringEvents.length}`)
  console.log(`Eventos normales creados/actualizados: ${dataset.normalEvents.length}`)
  console.log(`Asistencias creadas/actualizadas: ${dataset.attendances.length}`)
  console.log(`Licencias médicas creadas/actualizadas: ${dataset.leaves.length}`)
  console.log(`Registros justificados: ${dataset.justifiedCount}`)
  console.log('')
  console.log('Asistencias por usuario:')
  managedUsers.forEach((user) => {
    const found = attendancePerUser.find((row) => row.userId === user.id)
    console.log(`- ${user.username}: ${found?._count._all || 0}`)
  })
  console.log('')
  console.log('Credenciales funcionales:')
  console.log(`- ADMIN: admin / ${FIXTURE_PASSWORD} / admin@${EMAIL_DOMAIN}`)
  console.log(`- TUTOR: laura.perez / ${FIXTURE_PASSWORD} / laura.perez@${EMAIL_DOMAIN}`)
  console.log(`- TUTOR: diego.sosa / ${FIXTURE_PASSWORD} / diego.sosa@${EMAIL_DOMAIN}`)
  console.log(`- TUTOR: valentina.gomez / ${FIXTURE_PASSWORD} / valentina.gomez@${EMAIL_DOMAIN}`)
  console.log(`- STAFF: staff.pruebas / ${FIXTURE_PASSWORD} / staff.pruebas@${EMAIL_DOMAIN}`)
  console.log(`- TUTOR: camila.rios / ${FIXTURE_PASSWORD} / camila.rios@${EMAIL_DOMAIN}`)
  console.log(`- TUTOR: bruno.ledesma / ${FIXTURE_PASSWORD} / bruno.ledesma@${EMAIL_DOMAIN}`)
  console.log(`- STAFF: florencia.nunez / ${FIXTURE_PASSWORD} / florencia.nunez@${EMAIL_DOMAIN}`)
  console.log(`- STAFF: martin.vera / ${FIXTURE_PASSWORD} / martin.vera@${EMAIL_DOMAIN}`)
  console.log(`- STAFF: soledad.pintos / ${FIXTURE_PASSWORD} / soledad.pintos@${EMAIL_DOMAIN}`)
}

main()
  .catch((error) => {
    console.error('Error ejecutando seed persistente de EduTrack:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
