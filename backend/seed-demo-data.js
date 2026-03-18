import { PrismaClient } from '@prisma/client'
import { faker } from '@faker-js/faker'
import argon2 from 'argon2'

const prisma = new PrismaClient()

faker.seed(123456)

const PASSWORD = 'demo12345'
const DAYS_BACK = 45
const STAFF_COUNT = 18
const TEACHER_COUNT = 18
const MEDICAL_LEAVE_COUNT = 10

function startOfDay(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function atTime(date, hour, minute = 0) {
  const d = new Date(date)
  d.setHours(hour, minute, 0, 0)
  return d
}

function pick(array) {
  return array[Math.floor(Math.random() * array.length)]
}

function maybe(probability) {
  return Math.random() < probability
}

function ciFor(index) {
  return `9${String(1000000 + index).padStart(7, '0')}`
}

function roleEventType(role) {
  if (role === 'TEACHER') return pick(['CLASE', 'CAPACITACION', 'EVENTO'])
  return pick(['JORNADA_LABORAL', 'REUNION', 'CAPACITACION', 'EVENTO'])
}

function eventHours(type) {
  switch (type) {
    case 'CLASE':
      return { startHour: pick([8, 10, 14, 16]), durationHours: pick([2, 3]) }
    case 'JORNADA_LABORAL':
      return { startHour: 8, durationHours: 8 }
    case 'REUNION':
      return { startHour: pick([9, 11, 15]), durationHours: 1 }
    case 'CAPACITACION':
      return { startHour: pick([10, 14]), durationHours: 2 }
    case 'CITA_MEDICA':
      return { startHour: pick([9, 12, 17]), durationHours: 1 }
    default:
      return { startHour: pick([9, 13, 18]), durationHours: 2 }
  }
}

function buildAttendanceStatus(type) {
  if (type === 'CHECK_OUT') return maybe(0.12) ? 'EARLY_EXIT' : 'EXIT'
  if (maybe(0.12)) return 'LATE'
  return 'PRESENT'
}

async function ensureAdmin(passwordHash) {
  return prisma.user.upsert({
    where: { email: 'admin@test.com' },
    update: {
      username: 'admin_test',
      firstName: 'Admin',
      lastName: 'Test',
      name: 'Admin Test',
      passwordHash,
      role: 'ADMIN',
      nationalId: '12345678',
      phone: '+59899123456',
      birthdate: new Date('1985-01-15T00:00:00.000Z'),
      emailVerifiedAt: new Date(),
      isApproved: true,
      approvedAt: new Date(),
      isActive: true,
      failedLoginAttempts: 0,
      lockUntil: null,
    },
    create: {
      email: 'admin@test.com',
      username: 'admin_test',
      firstName: 'Admin',
      lastName: 'Test',
      name: 'Admin Test',
      passwordHash,
      role: 'ADMIN',
      nationalId: '12345678',
      phone: '+59899123456',
      birthdate: new Date('1985-01-15T00:00:00.000Z'),
      emailVerifiedAt: new Date(),
      isApproved: true,
      approvedAt: new Date(),
      isActive: true,
    },
  })
}

async function createUsers(role, count, passwordHash, existingCount) {
  const users = []
  for (let i = 0; i < count; i += 1) {
    const firstName = faker.person.firstName()
    const lastName = faker.person.lastName()
    const slug = `${firstName}.${lastName}`.toLowerCase().replace(/[^a-z]/g, '')
    const seq = existingCount + i + 1
    const email = `${slug}.${seq}@demo.local`
    const username = `${slug}${seq}`.slice(0, 28)
    const user = await prisma.user.create({
      data: {
        email,
        username,
        firstName,
        lastName,
        name: `${firstName} ${lastName}`,
        nationalId: ciFor(seq),
        phone: `+5989${String(1000000 + seq).padStart(7, '0')}`,
        birthdate: faker.date.birthdate({ min: 24, max: 60, mode: 'age' }),
        passwordHash,
        role,
        emailVerifiedAt: new Date(),
        isApproved: true,
        approvedAt: new Date(),
        isActive: true,
      },
    })
    users.push(user)
  }
  return users
}

async function createMedicalLeaves(users, adminId) {
  const leaves = []
  const selected = faker.helpers.shuffle(users).slice(0, MEDICAL_LEAVE_COUNT)
  for (const [index, user] of selected.entries()) {
    const startDate = startOfDay(faker.date.recent({ days: 25 }))
    const endDate = new Date(startDate)
    endDate.setDate(endDate.getDate() + pick([1, 2, 3, 4]))
    leaves.push({
      userId: user.id,
      type: pick(['MEDICAL_LEAVE', 'WORK_LEAVE', 'OTHER']),
      status: index < Math.floor(MEDICAL_LEAVE_COUNT * 0.7) ? 'APPROVED' : pick(['PENDING', 'REJECTED']),
      startDate,
      endDate,
      reason: faker.lorem.sentence(),
      doctorName: `${faker.person.firstName()} ${faker.person.lastName()}`,
      doctorPhone: faker.phone.number('+5989#######'),
      approvedBy: adminId,
      approvedAt: new Date(),
      notes: faker.lorem.sentence(),
    })
  }
  if (leaves.length > 0) {
    await prisma.medicalLeave.createMany({ data: leaves })
  }
}

async function main() {
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id })

  console.log('Limpiando datos demo anteriores...')
  await prisma.attendance.deleteMany({})
  await prisma.medicalLeave.deleteMany({})
  await prisma.event.deleteMany({})
  await prisma.refreshToken.deleteMany({})
  await prisma.emailVerification.deleteMany({})
  await prisma.passwordReset.deleteMany({})
  await prisma.user.deleteMany({
    where: {
      NOT: { email: 'admin@test.com' },
    },
  })

  const admin = await ensureAdmin(passwordHash)

  console.log('Creando usuarios...')
  const staffUsers = await createUsers('STAFF', STAFF_COUNT, passwordHash, 0)
  const teacherUsers = await createUsers('TEACHER', TEACHER_COUNT, passwordHash, STAFF_COUNT)
  const allUsers = [...staffUsers, ...teacherUsers]

  console.log('Creando licencias...')
  await createMedicalLeaves(allUsers, admin.id)

  console.log('Creando eventos y asistencias...')
  const events = []
  const attendances = []
  const today = startOfDay(new Date())

  for (const user of allUsers) {
    for (let offset = DAYS_BACK; offset >= 0; offset -= 1) {
      const date = new Date(today)
      date.setDate(today.getDate() - offset)

      if (date.getDay() === 0) continue
      if (user.role === 'TEACHER' && date.getDay() === 6 && !maybe(0.35)) continue
      if (maybe(0.12)) continue

      const type = roleEventType(user.role)
      const { startHour, durationHours } = eventHours(type)
      const startDate = atTime(date, startHour, pick([0, 15, 30]))
      const endDate = atTime(startDate, startDate.getHours() + durationHours, startDate.getMinutes())
      const status = endDate < new Date()
        ? 'COMPLETED'
        : startDate > new Date()
          ? 'SCHEDULED'
          : 'IN_PROGRESS'

      events.push({
        title: `${type.replace(/_/g, ' ')} - ${user.firstName}`,
        description: faker.lorem.sentence(),
        type,
        status,
        startDate,
        endDate,
        startTime: startDate,
        endTime: endDate,
        location: pick(['Sede Centro', 'Aula 101', 'Laboratorio', 'Sala Norte', 'Remoto']),
        userId: admin.id,
        assignedUserId: user.id,
        recurrenceType: 'NONE',
        isRecurring: false,
        daysOfWeek: [],
      })
    }
  }

  await prisma.event.createMany({ data: events })

  const savedEvents = await prisma.event.findMany({
    where: { userId: admin.id },
    select: { id: true, assignedUserId: true, startDate: true, startTime: true, endTime: true, status: true },
  })

  const approvedLeaves = await prisma.medicalLeave.findMany({
    where: { status: 'APPROVED' },
    select: { userId: true, startDate: true, endDate: true },
  })

  const onLeave = (userId, date) => approvedLeaves.some((leave) =>
    leave.userId === userId &&
    startOfDay(leave.startDate).getTime() <= date.getTime() &&
    startOfDay(leave.endDate).getTime() >= date.getTime()
  )

  for (const event of savedEvents) {
    if (!event.assignedUserId) continue
    const eventDay = startOfDay(event.startDate)

    if (onLeave(event.assignedUserId, eventDay)) {
      attendances.push({
        userId: event.assignedUserId,
        eventId: event.id,
        type: 'CHECK_IN',
        status: 'ABSENT_JUSTIFIED',
        date: eventDay,
        time: event.startTime || event.startDate,
        notes: 'Ausencia justificada por licencia medica',
      })
      continue
    }

    if (maybe(0.15)) {
      attendances.push({
        userId: event.assignedUserId,
        eventId: event.id,
        type: 'CHECK_IN',
        status: 'ABSENT_NOT_JUSTIFIED',
        date: eventDay,
        time: event.startTime || event.startDate,
        notes: 'Ausencia sin justificar',
      })
      continue
    }

    const checkInStatus = buildAttendanceStatus('CHECK_IN')
    const checkInTime = new Date(event.startTime || event.startDate)
    checkInTime.setMinutes(checkInTime.getMinutes() + (checkInStatus === 'LATE' ? pick([7, 12, 18]) : pick([-3, 0, 2])))

    attendances.push({
      userId: event.assignedUserId,
      eventId: event.id,
      type: 'CHECK_IN',
      status: checkInStatus,
      date: eventDay,
      time: checkInTime,
      notes: checkInStatus === 'LATE' ? 'Ingreso tardio' : 'Ingreso registrado',
    })

    if (maybe(0.9)) {
      const checkOutStatus = buildAttendanceStatus('CHECK_OUT')
      const checkOutTime = new Date(event.endTime || event.startDate)
      checkOutTime.setMinutes(checkOutTime.getMinutes() + (checkOutStatus === 'EARLY_EXIT' ? -pick([10, 20, 30]) : pick([-2, 0, 4])))

      attendances.push({
        userId: event.assignedUserId,
        eventId: event.id,
        type: 'CHECK_OUT',
        status: checkOutStatus,
        date: eventDay,
        time: checkOutTime,
        notes: checkOutStatus === 'EARLY_EXIT' ? 'Salida anticipada' : 'Salida registrada',
      })
    }
  }

  await prisma.attendance.createMany({ data: attendances })

  const [userCount, eventCount, attendanceCount, leaveCount] = await Promise.all([
    prisma.user.count(),
    prisma.event.count(),
    prisma.attendance.count(),
    prisma.medicalLeave.count(),
  ])

  console.log('Seed completado')
  console.log(`Usuarios: ${userCount}`)
  console.log(`Eventos: ${eventCount}`)
  console.log(`Asistencias: ${attendanceCount}`)
  console.log(`Licencias: ${leaveCount}`)
  console.log(`Password demo usuarios: ${PASSWORD}`)
}

main()
  .catch((error) => {
    console.error('Error generando datos demo:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
