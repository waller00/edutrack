import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import argon2 from 'argon2'

const prisma = new PrismaClient()
const PASSWORD = 'admin123'

function utcDate(y, m, d, h = 0, min = 0) {
  return new Date(Date.UTC(y, m - 1, d, h, min, 0, 0))
}

function addDays(date, days) {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

async function wipeDemoData() {
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

async function roleId(code, label, sortOrder) {
  const role = await prisma.orgRole.upsert({
    where: { code },
    update: { label, active: true, builtIn: true, sortOrder },
    create: { code, label, active: true, builtIn: true, sortOrder },
  })
  return role.id
}

async function createUser(roleIdValue, data) {
  return prisma.user.create({
    data: {
      ...data,
      roleId: roleIdValue,
      passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
      emailVerifiedAt: new Date(),
      isApproved: true,
      approvedAt: new Date(),
      isActive: true,
      failedLoginAttempts: 0,
      lockUntil: null,
      twoFactorEnabled: false,
    },
  })
}

async function main() {
  await wipeDemoData()

  const adminRoleId = await roleId('ADMIN', 'Administrador', 1)
  const teacherRoleId = await roleId('TEACHER', 'Docente', 2)
  const staffRoleId = await roleId('STAFF', 'Administrativo', 3)

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

  const [admin, coordinacion, adscripta, matematica, historia, ciencias] = await Promise.all([
    createUser(adminRoleId, {
      username: 'admin',
      email: 'admin@testing.edutrack.local',
      firstName: 'Administracion',
      lastName: 'Testing',
      name: 'Administracion Testing',
      phone: '+59899000001',
      nationalId: '10000007',
      birthdate: utcDate(1985, 3, 12),
    }),
    createUser(staffRoleId, {
      username: 'coordinacion',
      email: 'coordinacion@testing.edutrack.local',
      firstName: 'Clara',
      lastName: 'Mendez',
      name: 'Clara Mendez',
      phone: '+59899000002',
      nationalId: '10000015',
      birthdate: utcDate(1988, 7, 4),
    }),
    createUser(staffRoleId, {
      username: 'adscripta.turno',
      email: 'adscripta.turno@testing.edutrack.local',
      firstName: 'Sofia',
      lastName: 'Acosta',
      name: 'Sofia Acosta',
      phone: '+59899000003',
      nationalId: '10000023',
      birthdate: utcDate(1991, 9, 18),
    }),
    createUser(teacherRoleId, {
      username: 'doc.matematica',
      email: 'doc.matematica@testing.edutrack.local',
      firstName: 'Nicolas',
      lastName: 'Ferreira',
      name: 'Nicolas Ferreira',
      phone: '+59899000004',
      nationalId: '10000031',
      birthdate: utcDate(1987, 11, 22),
    }),
    createUser(teacherRoleId, {
      username: 'doc.historia',
      email: 'doc.historia@testing.edutrack.local',
      firstName: 'Mariana',
      lastName: 'Silveira',
      name: 'Mariana Silveira',
      phone: '+59899000005',
      nationalId: '10000040',
      birthdate: utcDate(1990, 1, 15),
    }),
    createUser(teacherRoleId, {
      username: 'doc.ciencias',
      email: 'doc.ciencias@testing.edutrack.local',
      firstName: 'Agustin',
      lastName: 'Pereira',
      name: 'Agustin Pereira',
      phone: '+59899000006',
      nationalId: '10000058',
      birthdate: utcDate(1989, 5, 9),
    }),
  ])

  const year2025 = await prisma.schoolYear.create({
    data: {
      code: 2025,
      label: 'Ciclo lectivo 2025',
      startsOn: utcDate(2025, 3, 3),
      endsOn: utcDate(2025, 12, 12),
      status: 'CLOSED',
    },
  })
  const year2026 = await prisma.schoolYear.create({
    data: {
      code: 2026,
      label: 'Ciclo lectivo 2026',
      startsOn: utcDate(2026, 3, 2),
      endsOn: utcDate(2026, 12, 11),
      status: 'ACTIVE',
    },
  })

  const courses = []
  for (const c of [
    ['1CB-A', '1o Ciclo Basico A', ['Matematica', 'Idioma Espanol', 'Ciencias Fisicas']],
    ['2CB-B', '2o Ciclo Basico B', ['Historia', 'Biologia', 'Ingles']],
    ['3CB-A', '3o Ciclo Basico A', ['Matematica', 'Historia', 'Fisica']],
    ['4BD-HUM', '4o Bachillerato Humanistico', ['Literatura', 'Historia', 'Filosofia']],
  ]) {
    const course = await prisma.course.create({
      data: {
        code: c[0],
        name: c[1],
        description: 'Curso catalogo nuevo: independiente del ciclo lectivo.',
        subjects: {
          create: c[2].map((name, index) => ({
            name,
            code: `${c[0]}-${index + 1}`,
            sortOrder: index + 1,
            isActive: true,
          })),
        },
      },
      include: { subjects: true },
    })
    courses.push(course)
  }

  const offerings = []
  for (const course of courses) {
    offerings.push(
      await prisma.courseOffering.create({
        data: {
          courseId: course.id,
          schoolYearId: year2026.id,
          isActive: true,
          notes: 'Oferta activa 2026 creada para testing del formato nuevo.',
        },
        include: { course: { include: { subjects: true } } },
      }),
    )
    await prisma.courseOffering.create({
      data: {
        courseId: course.id,
        schoolYearId: year2025.id,
        isActive: false,
        notes: 'Oferta historica cerrada 2025.',
      },
    })
  }

  const studentNames = [
    ['Lucia', 'Barrios'],
    ['Mateo', 'Cabrera'],
    ['Emilia', 'Rodriguez'],
    ['Joaquin', 'Sosa'],
    ['Martina', 'Vidal'],
    ['Santiago', 'Molina'],
    ['Valentina', 'Castro'],
    ['Facundo', 'Ramos'],
    ['Renata', 'Suarez'],
    ['Bruno', 'Pintos'],
    ['Camila', 'Torres'],
    ['Ignacio', 'Lema'],
  ]

  const students = []
  for (let i = 0; i < studentNames.length; i++) {
    const [firstName, lastName] = studentNames[i]
    const student = await prisma.student.create({
      data: {
        firstName,
        lastName,
        documentId: `5${String(300000 + i * 137).padStart(7, '0')}`,
        contactPhone: `094${String(480000 + i).slice(-6)}`,
        tutorPhone: `099${String(720000 + i).slice(-6)}`,
        contactEmail: `${firstName}.${lastName}`.toLowerCase() + '@familias.testing',
        address: `Direccion de prueba ${i + 1}`,
        healthCardExpiresAt: utcDate(2027, (i % 12) + 1, 20),
        liceoAccessNotes: i % 4 === 0 ? 'Tiene usuario familiar pendiente de confirmar.' : null,
        internalNotes: i % 5 === 0 ? 'Seguimiento administrativo de testing.' : null,
      },
    })
    const offering = offerings[i % offerings.length]
    const withdrawn = i === 4 || i === 9
    await prisma.studentEnrollment.create({
      data: {
        studentId: student.id,
        schoolYearId: year2026.id,
        courseOfferingId: offering.id,
        enrollmentStatus: withdrawn ? 'WITHDRAWN' : 'ACTIVE',
        withdrawnAt: withdrawn ? utcDate(2026, 5 + (i % 3), 15) : null,
        withdrawalAcademicYear: withdrawn ? 2026 : null,
        notes: withdrawn ? 'Baja cargada para probar reportes de abandono.' : 'Matricula activa 2026.',
      },
    })
    await prisma.studentTuitionYear.create({
      data: {
        studentId: student.id,
        year: 2026,
        paid: i % 3 !== 0,
        paidAt: i % 3 !== 0 ? utcDate(2026, 3, 10 + i) : null,
        amountCents: 180000,
        notes: i % 3 === 0 ? 'Anualidad pendiente.' : 'Anualidad registrada.',
      },
    })
    for (let month = 3; month <= 8; month++) {
      const paid = (i + month) % 4 !== 0
      await prisma.studentTuitionMonth.create({
        data: {
          studentId: student.id,
          year: 2026,
          month,
          paid,
          paidAt: paid ? utcDate(2026, month, 8) : null,
          amountCents: 15000,
          notes: paid ? 'Mensualidad paga.' : 'Mensualidad pendiente.',
        },
      })
    }
    students.push(student)
  }

  const teachers = [matematica, historia, ciencias]
  const baseMonday = utcDate(2026, 5, 18)
  for (let i = 0; i < offerings.length; i++) {
    const offering = offerings[i]
    const teacher = teachers[i % teachers.length]
    const subject = offering.course.subjects[0]
    const startDate = addDays(baseMonday, i)
    const startTime = utcDate(2026, 5, 18 + i, 12 + i, 30)
    const endTime = new Date(startTime.getTime() + 90 * 60 * 1000)
    const event = await prisma.event.create({
      data: {
        title: `${offering.course.code} - ${subject.name}`,
        description: 'Clase recurrente creada sobre CourseOffering del formato nuevo.',
        type: 'CLASE',
        status: 'SCHEDULED',
        startDate,
        endDate: startDate,
        startTime,
        endTime,
        location: `Aula ${101 + i}`,
        userId: admin.id,
        assignedUserId: teacher.id,
        schoolYearId: year2026.id,
        courseOfferingId: offering.id,
        subjectId: subject.id,
        recurrenceType: 'WEEKLY',
        recurrenceEnd: utcDate(2026, 11, 30),
        isRecurring: true,
        daysOfWeek: [startDate.getUTCDay()],
      },
    })
    await prisma.attendance.create({
      data: {
        userId: teacher.id,
        eventId: event.id,
        type: 'CHECK_IN',
        status: i === 1 ? 'LATE' : 'PRESENT',
        date: startDate,
        time: startTime,
        notes: 'Asistencia de testing formato nuevo.',
      },
    })
  }

  await prisma.event.create({
    data: {
      title: 'Reunion de coordinacion 2026',
      description: 'Evento administrativo nuevo.',
      type: 'REUNION',
      status: 'SCHEDULED',
      startDate: utcDate(2026, 5, 22),
      endDate: utcDate(2026, 5, 22),
      startTime: utcDate(2026, 5, 22, 14, 0),
      endTime: utcDate(2026, 5, 22, 15, 0),
      location: 'Direccion',
      userId: admin.id,
      assignedUserId: coordinacion.id,
      schoolYearId: year2026.id,
      recurrenceType: 'NONE',
      isRecurring: false,
      daysOfWeek: [],
    },
  })

  await prisma.medicalLeave.create({
    data: {
      userId: adscripta.id,
      type: 'MEDICAL_LEAVE',
      status: 'ACTIVE',
      startDate: utcDate(2026, 5, 20),
      endDate: utcDate(2026, 5, 22, 23, 59),
      reason: 'Licencia medica de testing.',
      doctorName: 'Dra. Test',
      approvedBy: admin.id,
      approvedAt: new Date(),
      notes: 'Registro nuevo para probar licencias.',
    },
  })

  console.log('Dataset nuevo creado.')
  console.log('Usuarios: admin/admin123, coordinacion/admin123, doc.matematica/admin123')
  console.log(`Ciclos: ${year2025.code} cerrado, ${year2026.code} activo`)
  console.log(`Cursos: ${courses.length}; ofertas 2026: ${offerings.length}; estudiantes: ${students.length}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
