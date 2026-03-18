import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import argon2 from 'argon2'

const prisma = new PrismaClient()

const FIXTURE_PASSWORD = 'admin123'
const EMAIL_DOMAIN = 'edutrack.local'

function fixtureId(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

function startOfDay(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function withTime(date, hour, minute = 0) {
  const d = new Date(date)
  d.setHours(hour, minute, 0, 0)
  return d
}

function addDays(date, days) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function buildValidCi(baseNumber) {
  const base7 = String(baseNumber).padStart(7, '0')
  const weights = [2, 9, 8, 7, 6, 3, 4]
  const sum = base7.split('').reduce((acc, digit, index) => acc + Number(digit) * weights[index], 0)
  const checkDigit = (10 - (sum % 10)) % 10
  return `${base7}${checkDigit}`
}

function createFixtureUsers(passwordHash) {
  return [
    {
      id: fixtureId(1),
      email: `admin@${EMAIL_DOMAIN}`,
      username: 'admin',
      firstName: 'Joaquin',
      lastName: 'Waller',
      name: 'Joaquin Waller',
      role: 'ADMIN',
      nationalId: buildValidCi(1234567),
      phone: '+59899111222',
      birthdate: new Date('1988-05-14T00:00:00.000Z'),
      passwordHash,
      emailVerifiedAt: new Date(),
      isApproved: true,
      approvedAt: new Date(),
      isActive: true,
      failedLoginAttempts: 0,
      lockUntil: null,
    },
    {
      id: fixtureId(2),
      email: `laura.perez@${EMAIL_DOMAIN}`,
      username: 'laura.perez',
      firstName: 'Laura',
      lastName: 'Perez',
      name: 'Laura Perez',
      role: 'TEACHER',
      nationalId: buildValidCi(2234567),
      phone: '+59899100001',
      birthdate: new Date('1991-03-22T00:00:00.000Z'),
      passwordHash,
      emailVerifiedAt: new Date(),
      isApproved: true,
      approvedAt: new Date(),
      isActive: true,
      failedLoginAttempts: 0,
      lockUntil: null,
    },
    {
      id: fixtureId(3),
      email: `diego.sosa@${EMAIL_DOMAIN}`,
      username: 'diego.sosa',
      firstName: 'Diego',
      lastName: 'Sosa',
      name: 'Diego Sosa',
      role: 'TEACHER',
      nationalId: buildValidCi(2234568),
      phone: '+59899100002',
      birthdate: new Date('1987-11-09T00:00:00.000Z'),
      passwordHash,
      emailVerifiedAt: new Date(),
      isApproved: true,
      approvedAt: new Date(),
      isActive: true,
      failedLoginAttempts: 0,
      lockUntil: null,
    },
    {
      id: fixtureId(4),
      email: `camila.rodriguez@${EMAIL_DOMAIN}`,
      username: 'camila.rodriguez',
      firstName: 'Camila',
      lastName: 'Rodriguez',
      name: 'Camila Rodriguez',
      role: 'TEACHER',
      nationalId: buildValidCi(2234569),
      phone: '+59899100003',
      birthdate: new Date('1994-07-12T00:00:00.000Z'),
      passwordHash,
      emailVerifiedAt: new Date(),
      isApproved: true,
      approvedAt: new Date(),
      isActive: true,
      failedLoginAttempts: 0,
      lockUntil: null,
    },
    {
      id: fixtureId(5),
      email: `martin.silva@${EMAIL_DOMAIN}`,
      username: 'martin.silva',
      firstName: 'Martin',
      lastName: 'Silva',
      name: 'Martin Silva',
      role: 'TEACHER',
      nationalId: buildValidCi(2234570),
      phone: '+59899100004',
      birthdate: new Date('1989-01-18T00:00:00.000Z'),
      passwordHash,
      emailVerifiedAt: new Date(),
      isApproved: true,
      approvedAt: new Date(),
      isActive: true,
      failedLoginAttempts: 0,
      lockUntil: null,
    },
    {
      id: fixtureId(6),
      email: `valentina.gomez@${EMAIL_DOMAIN}`,
      username: 'valentina.gomez',
      firstName: 'Valentina',
      lastName: 'Gomez',
      name: 'Valentina Gomez',
      role: 'STAFF',
      nationalId: buildValidCi(3234567),
      phone: '+59899200001',
      birthdate: new Date('1992-08-03T00:00:00.000Z'),
      passwordHash,
      emailVerifiedAt: new Date(),
      isApproved: true,
      approvedAt: new Date(),
      isActive: true,
      failedLoginAttempts: 0,
      lockUntil: null,
    },
    {
      id: fixtureId(7),
      email: `nicolas.fernandez@${EMAIL_DOMAIN}`,
      username: 'nicolas.fernandez',
      firstName: 'Nicolas',
      lastName: 'Fernandez',
      name: 'Nicolas Fernandez',
      role: 'STAFF',
      nationalId: buildValidCi(3234568),
      phone: '+59899200002',
      birthdate: new Date('1986-12-01T00:00:00.000Z'),
      passwordHash,
      emailVerifiedAt: new Date(),
      isApproved: true,
      approvedAt: new Date(),
      isActive: true,
      failedLoginAttempts: 0,
      lockUntil: null,
    },
    {
      id: fixtureId(8),
      email: `paula.ramos@${EMAIL_DOMAIN}`,
      username: 'paula.ramos',
      firstName: 'Paula',
      lastName: 'Ramos',
      name: 'Paula Ramos',
      role: 'STAFF',
      nationalId: buildValidCi(3234569),
      phone: '+59899200003',
      birthdate: new Date('1990-04-25T00:00:00.000Z'),
      passwordHash,
      emailVerifiedAt: new Date(),
      isApproved: true,
      approvedAt: new Date(),
      isActive: true,
      failedLoginAttempts: 0,
      lockUntil: null,
    },
    {
      id: fixtureId(9),
      email: `sofia.mendez@${EMAIL_DOMAIN}`,
      username: 'sofia.mendez',
      firstName: 'Sofia',
      lastName: 'Mendez',
      name: 'Sofia Mendez',
      role: 'STAFF',
      nationalId: buildValidCi(3234570),
      phone: '+59899200004',
      birthdate: new Date('1995-06-17T00:00:00.000Z'),
      passwordHash,
      emailVerifiedAt: new Date(),
      isApproved: true,
      approvedAt: new Date(),
      isActive: true,
      failedLoginAttempts: 0,
      lockUntil: null,
    },
    {
      id: fixtureId(10),
      email: `rodrigo.alvarez@${EMAIL_DOMAIN}`,
      username: 'rodrigo.alvarez',
      firstName: 'Rodrigo',
      lastName: 'Alvarez',
      name: 'Rodrigo Alvarez',
      role: 'STAFF',
      nationalId: buildValidCi(3234571),
      phone: '+59899200005',
      birthdate: new Date('1984-09-30T00:00:00.000Z'),
      passwordHash,
      emailVerifiedAt: new Date(),
      isApproved: true,
      approvedAt: new Date(),
      isActive: true,
      failedLoginAttempts: 0,
      lockUntil: null,
    },
  ]
}

function createFixtureLeaves(now) {
  const today = startOfDay(now)
  return [
    {
      id: fixtureId(301),
      userId: fixtureId(7),
      type: 'MEDICAL_LEAVE',
      status: 'APPROVED',
      startDate: addDays(today, -1),
      endDate: addDays(today, 1),
      reason: 'Reposo indicado por infección respiratoria.',
      doctorName: 'Dra. Mariana Costa',
      doctorPhone: '+59829001122',
      certificate: 'certificados/nicolas-fernandez-licencia.pdf',
      approvedBy: fixtureId(1),
      approvedAt: addDays(today, -2),
      notes: 'Aprobada por administración con certificado presentado.',
    },
    {
      id: fixtureId(302),
      userId: fixtureId(4),
      type: 'OTHER',
      status: 'PENDING',
      startDate: addDays(today, 2),
      endDate: addDays(today, 3),
      reason: 'Solicitud de licencia especial por trámite personal.',
      doctorName: null,
      doctorPhone: null,
      certificate: null,
      approvedBy: null,
      approvedAt: null,
      notes: 'Pendiente de revisión.',
    },
    {
      id: fixtureId(303),
      userId: fixtureId(6),
      type: 'WORK_LEAVE',
      status: 'REJECTED',
      startDate: addDays(today, -8),
      endDate: addDays(today, -7),
      reason: 'Ausencia por asunto personal sin respaldo.',
      doctorName: null,
      doctorPhone: null,
      certificate: null,
      approvedBy: fixtureId(1),
      approvedAt: addDays(today, -9),
      notes: 'Rechazada por falta de documentación.',
    },
    {
      id: fixtureId(304),
      userId: fixtureId(5),
      type: 'MEDICAL_LEAVE',
      status: 'APPROVED',
      startDate: addDays(today, -18),
      endDate: addDays(today, -16),
      reason: 'Controles médicos y reposo breve.',
      doctorName: 'Dr. Pablo Barreto',
      doctorPhone: '+59829112233',
      certificate: 'certificados/martin-silva-control.pdf',
      approvedBy: fixtureId(1),
      approvedAt: addDays(today, -19),
      notes: 'Licencia histórica para probar filtros.',
    },
  ]
}

function createFixtureEvents(now) {
  const today = startOfDay(now)
  return [
    {
      id: fixtureId(101),
      title: 'Matemática 5°A',
      description: 'Clase regular de matemática con evaluación corta.',
      type: 'CLASE',
      status: 'COMPLETED',
      startDate: addDays(today, -2),
      endDate: addDays(today, -2),
      startTime: withTime(addDays(today, -2), 8, 0),
      endTime: withTime(addDays(today, -2), 9, 30),
      location: 'Aula 201',
      userId: fixtureId(1),
      assignedUserId: fixtureId(2),
      recurrenceType: 'NONE',
      isRecurring: false,
      daysOfWeek: [],
    },
    {
      id: fixtureId(102),
      title: 'Historia 2°B',
      description: 'Clase con ingreso tardío registrado.',
      type: 'CLASE',
      status: 'COMPLETED',
      startDate: addDays(today, -1),
      endDate: addDays(today, -1),
      startTime: withTime(addDays(today, -1), 10, 0),
      endTime: withTime(addDays(today, -1), 11, 30),
      location: 'Aula 105',
      userId: fixtureId(1),
      assignedUserId: fixtureId(3),
      recurrenceType: 'NONE',
      isRecurring: false,
      daysOfWeek: [],
    },
    {
      id: fixtureId(103),
      title: 'Lengua 3°C',
      description: 'Clase sin asistencia para probar ausencias injustificadas.',
      type: 'CLASE',
      status: 'COMPLETED',
      startDate: addDays(today, -3),
      endDate: addDays(today, -3),
      startTime: withTime(addDays(today, -3), 14, 0),
      endTime: withTime(addDays(today, -3), 15, 30),
      location: 'Aula 301',
      userId: fixtureId(1),
      assignedUserId: fixtureId(4),
      recurrenceType: 'NONE',
      isRecurring: false,
      daysOfWeek: [],
    },
    {
      id: fixtureId(104),
      title: 'Tutoría individual 1°A',
      description: 'Clase con salida anticipada justificada.',
      type: 'CLASE',
      status: 'COMPLETED',
      startDate: addDays(today, -4),
      endDate: addDays(today, -4),
      startTime: withTime(addDays(today, -4), 16, 0),
      endTime: withTime(addDays(today, -4), 18, 0),
      location: 'Sala de tutorías',
      userId: fixtureId(1),
      assignedUserId: fixtureId(5),
      recurrenceType: 'NONE',
      isRecurring: false,
      daysOfWeek: [],
    },
    {
      id: fixtureId(105),
      title: 'Atención a familias',
      description: 'Bloque administrativo de atención presencial.',
      type: 'JORNADA_LABORAL',
      status: 'COMPLETED',
      startDate: addDays(today, -2),
      endDate: addDays(today, -2),
      startTime: withTime(addDays(today, -2), 8, 30),
      endTime: withTime(addDays(today, -2), 16, 30),
      location: 'Recepción',
      userId: fixtureId(1),
      assignedUserId: fixtureId(6),
      recurrenceType: 'NONE',
      isRecurring: false,
      daysOfWeek: [],
    },
    {
      id: fixtureId(106),
      title: 'Mesa de entradas',
      description: 'Turno administrativo durante licencia médica.',
      type: 'JORNADA_LABORAL',
      status: 'COMPLETED',
      startDate: today,
      endDate: today,
      startTime: withTime(today, 9, 0),
      endTime: withTime(today, 17, 0),
      location: 'Administración',
      userId: fixtureId(1),
      assignedUserId: fixtureId(7),
      recurrenceType: 'NONE',
      isRecurring: false,
      daysOfWeek: [],
    },
    {
      id: fixtureId(107),
      title: 'Reunión con dirección',
      description: 'Reunión de coordinación con múltiples actores.',
      type: 'REUNION',
      status: 'COMPLETED',
      startDate: addDays(today, -5),
      endDate: addDays(today, -5),
      startTime: withTime(addDays(today, -5), 11, 0),
      endTime: withTime(addDays(today, -5), 12, 0),
      location: 'Sala de reuniones',
      userId: fixtureId(1),
      assignedUserId: fixtureId(8),
      recurrenceType: 'NONE',
      isRecurring: false,
      daysOfWeek: [],
    },
    {
      id: fixtureId(108),
      title: 'Capacitación de plataforma',
      description: 'Capacitación interna con registro completo.',
      type: 'CAPACITACION',
      status: 'COMPLETED',
      startDate: addDays(today, -6),
      endDate: addDays(today, -6),
      startTime: withTime(addDays(today, -6), 15, 0),
      endTime: withTime(addDays(today, -6), 17, 0),
      location: 'Laboratorio de informática',
      userId: fixtureId(1),
      assignedUserId: fixtureId(9),
      recurrenceType: 'NONE',
      isRecurring: false,
      daysOfWeek: [],
    },
    {
      id: fixtureId(109),
      title: 'Control de inventario',
      description: 'Tarea administrativa no realizada.',
      type: 'JORNADA_LABORAL',
      status: 'EXPIRED',
      startDate: addDays(today, -7),
      endDate: addDays(today, -7),
      startTime: withTime(addDays(today, -7), 8, 0),
      endTime: withTime(addDays(today, -7), 12, 0),
      location: 'Depósito',
      userId: fixtureId(1),
      assignedUserId: fixtureId(10),
      recurrenceType: 'NONE',
      isRecurring: false,
      daysOfWeek: [],
    },
    {
      id: fixtureId(110),
      title: 'Reunión de coordinación general',
      description: 'Evento visible como en progreso en el dashboard.',
      type: 'REUNION',
      status: 'IN_PROGRESS',
      startDate: now,
      endDate: now,
      startTime: addDays(now, 0),
      endTime: new Date(now.getTime() + 60 * 60 * 1000),
      location: 'Sala Norte',
      userId: fixtureId(1),
      assignedUserId: fixtureId(6),
      recurrenceType: 'NONE',
      isRecurring: false,
      daysOfWeek: [],
    },
    {
      id: fixtureId(111),
      title: 'Clase de apoyo 6°B',
      description: 'Evento programado para mañana.',
      type: 'CLASE',
      status: 'SCHEDULED',
      startDate: addDays(today, 1),
      endDate: addDays(today, 1),
      startTime: withTime(addDays(today, 1), 8, 30),
      endTime: withTime(addDays(today, 1), 10, 0),
      location: 'Aula 204',
      userId: fixtureId(1),
      assignedUserId: fixtureId(2),
      recurrenceType: 'NONE',
      isRecurring: false,
      daysOfWeek: [],
    },
    {
      id: fixtureId(112),
      title: 'Capacitación de convivencia',
      description: 'Actividad programada para personal docente.',
      type: 'CAPACITACION',
      status: 'SCHEDULED',
      startDate: addDays(today, 2),
      endDate: addDays(today, 2),
      startTime: withTime(addDays(today, 2), 14, 0),
      endTime: withTime(addDays(today, 2), 16, 0),
      location: 'Salón de actos',
      userId: fixtureId(1),
      assignedUserId: fixtureId(5),
      recurrenceType: 'NONE',
      isRecurring: false,
      daysOfWeek: [],
    },
    {
      id: fixtureId(113),
      title: 'Jornada administrativa de cierre mensual',
      description: 'Turno futuro para personal no docente.',
      type: 'JORNADA_LABORAL',
      status: 'SCHEDULED',
      startDate: addDays(today, 3),
      endDate: addDays(today, 3),
      startTime: withTime(addDays(today, 3), 9, 0),
      endTime: withTime(addDays(today, 3), 17, 0),
      location: 'Oficina central',
      userId: fixtureId(1),
      assignedUserId: fixtureId(8),
      recurrenceType: 'NONE',
      isRecurring: false,
      daysOfWeek: [],
    },
    {
      id: fixtureId(114),
      title: 'Salida didáctica suspendida',
      description: 'Evento cancelado por mal clima.',
      type: 'EVENTO',
      status: 'CANCELLED',
      startDate: addDays(today, 4),
      endDate: addDays(today, 4),
      startTime: withTime(addDays(today, 4), 9, 0),
      endTime: withTime(addDays(today, 4), 13, 0),
      location: 'Terminal de ómnibus',
      userId: fixtureId(1),
      assignedUserId: fixtureId(3),
      recurrenceType: 'NONE',
      isRecurring: false,
      daysOfWeek: [],
    },
    {
      id: fixtureId(115),
      title: 'Comité de seguimiento',
      description: 'Evento del administrador para revisar reportes.',
      type: 'REUNION',
      status: 'SCHEDULED',
      startDate: addDays(today, 1),
      endDate: addDays(today, 1),
      startTime: withTime(addDays(today, 1), 12, 0),
      endTime: withTime(addDays(today, 1), 13, 0),
      location: 'Despacho dirección',
      userId: fixtureId(1),
      assignedUserId: fixtureId(1),
      recurrenceType: 'NONE',
      isRecurring: false,
      daysOfWeek: [],
    },
  ]
}

function createFixtureAttendances(now) {
  const today = startOfDay(now)
  return [
    {
      id: fixtureId(201),
      userId: fixtureId(2),
      eventId: fixtureId(101),
      type: 'CHECK_IN',
      status: 'PRESENT',
      date: addDays(today, -2),
      time: withTime(addDays(today, -2), 7, 58),
      notes: 'Ingreso puntual.',
    },
    {
      id: fixtureId(202),
      userId: fixtureId(2),
      eventId: fixtureId(101),
      type: 'CHECK_OUT',
      status: 'EXIT',
      date: addDays(today, -2),
      time: withTime(addDays(today, -2), 9, 32),
      notes: 'Salida registrada correctamente.',
    },
    {
      id: fixtureId(203),
      userId: fixtureId(3),
      eventId: fixtureId(102),
      type: 'CHECK_IN',
      status: 'LATE',
      date: addDays(today, -1),
      time: withTime(addDays(today, -1), 10, 12),
      notes: 'Retraso por problema de transporte.',
    },
    {
      id: fixtureId(204),
      userId: fixtureId(3),
      eventId: fixtureId(102),
      type: 'CHECK_OUT',
      status: 'EXIT',
      date: addDays(today, -1),
      time: withTime(addDays(today, -1), 11, 31),
      notes: 'Salida registrada luego de la clase.',
    },
    {
      id: fixtureId(205),
      userId: fixtureId(4),
      eventId: fixtureId(103),
      type: 'CHECK_IN',
      status: 'ABSENT_NOT_JUSTIFIED',
      date: addDays(today, -3),
      time: withTime(addDays(today, -3), 14, 0),
      notes: 'No se presentó ni justificó la ausencia.',
    },
    {
      id: fixtureId(206),
      userId: fixtureId(5),
      eventId: fixtureId(104),
      type: 'CHECK_IN',
      status: 'PRESENT',
      date: addDays(today, -4),
      time: withTime(addDays(today, -4), 15, 57),
      notes: 'Ingreso puntual a tutoría.',
    },
    {
      id: fixtureId(207),
      userId: fixtureId(5),
      eventId: fixtureId(104),
      type: 'CHECK_OUT',
      status: 'EARLY_EXIT',
      date: addDays(today, -4),
      time: withTime(addDays(today, -4), 17, 35),
      notes: 'Salida anticipada por control médico.',
    },
    {
      id: fixtureId(208),
      userId: fixtureId(6),
      eventId: fixtureId(105),
      type: 'CHECK_IN',
      status: 'PRESENT',
      date: addDays(today, -2),
      time: withTime(addDays(today, -2), 8, 27),
      notes: 'Ingreso registrado en recepción.',
    },
    {
      id: fixtureId(209),
      userId: fixtureId(6),
      eventId: fixtureId(105),
      type: 'CHECK_OUT',
      status: 'EXIT',
      date: addDays(today, -2),
      time: withTime(addDays(today, -2), 16, 33),
      notes: 'Cierre de turno sin novedades.',
    },
    {
      id: fixtureId(210),
      userId: fixtureId(7),
      eventId: fixtureId(106),
      type: 'CHECK_IN',
      status: 'ABSENT_JUSTIFIED',
      date: today,
      time: withTime(today, 9, 0),
      notes: 'Ausencia justificada por licencia médica aprobada.',
    },
    {
      id: fixtureId(211),
      userId: fixtureId(8),
      eventId: fixtureId(107),
      type: 'CHECK_IN',
      status: 'PRESENT',
      date: addDays(today, -5),
      time: withTime(addDays(today, -5), 10, 57),
      notes: 'Ingreso a reunión con dirección.',
    },
    {
      id: fixtureId(212),
      userId: fixtureId(8),
      eventId: fixtureId(107),
      type: 'CHECK_OUT',
      status: 'EXIT',
      date: addDays(today, -5),
      time: withTime(addDays(today, -5), 12, 1),
      notes: 'Acta cerrada y firmada.',
    },
    {
      id: fixtureId(213),
      userId: fixtureId(9),
      eventId: fixtureId(108),
      type: 'CHECK_IN',
      status: 'LATE',
      date: addDays(today, -6),
      time: withTime(addDays(today, -6), 15, 9),
      notes: 'Llegó tarde por atención a familias.',
    },
    {
      id: fixtureId(214),
      userId: fixtureId(9),
      eventId: fixtureId(108),
      type: 'CHECK_OUT',
      status: 'EXIT',
      date: addDays(today, -6),
      time: withTime(addDays(today, -6), 17, 4),
      notes: 'Capacitación completada.',
    },
    {
      id: fixtureId(215),
      userId: fixtureId(10),
      eventId: fixtureId(109),
      type: 'CHECK_IN',
      status: 'ABSENT_NOT_JUSTIFIED',
      date: addDays(today, -7),
      time: withTime(addDays(today, -7), 8, 0),
      notes: 'No asistió al control de inventario.',
    },
  ]
}

function getHistoricalEventTypeForRole(role, index) {
  if (role === 'TEACHER') {
    return ['CLASE', 'CAPACITACION', 'EVENTO', 'CLASE'][index % 4]
  }
  return ['JORNADA_LABORAL', 'REUNION', 'CAPACITACION', 'EVENTO'][index % 4]
}

function getHistoricalAttendancePattern(index) {
  return [
    { checkIn: 'PRESENT', checkOut: 'EXIT', note: 'Jornada completada sin novedades.' },
    { checkIn: 'LATE', checkOut: 'EXIT', note: 'Ingreso tardío con recuperación del tiempo.' },
    { checkIn: 'PRESENT', checkOut: 'EARLY_EXIT', note: 'Salida anticipada por coordinación externa.' },
    { checkIn: 'ABSENT_NOT_JUSTIFIED', checkOut: null, note: 'Ausencia registrada sin justificación.' },
  ][index % 4]
}

function createHistoricalData(users, now) {
  const adminId = fixtureId(1)
  const historyOffsets = [-30, -75, -140, -400]
  const events = []
  const attendances = []
  let sequence = 500

  users
    .filter((user) => user.role !== 'ADMIN')
    .forEach((user) => {
      historyOffsets.forEach((offset, index) => {
        const eventDate = startOfDay(addDays(now, offset))
        const type = getHistoricalEventTypeForRole(user.role, index)
        const pattern = getHistoricalAttendancePattern(index)
        const startHour = user.role === 'TEACHER' ? 8 + (index % 3) * 2 : 9 + (index % 2) * 3
        const startTime = withTime(eventDate, startHour, index % 2 === 0 ? 0 : 30)
        const endTime = withTime(eventDate, startHour + (type === 'JORNADA_LABORAL' ? 8 : 2), index % 2 === 0 ? 0 : 30)
        const eventId = fixtureId(sequence)

        events.push({
          id: eventId,
          title: `${type.replace(/_/g, ' ')} histórica - ${user.firstName}`,
          description: `Registro histórico para ${user.name}.`,
          type,
          status: 'COMPLETED',
          startDate: eventDate,
          endDate: eventDate,
          startTime,
          endTime,
          location: user.role === 'TEACHER' ? 'Aula histórica' : 'Oficina histórica',
          userId: adminId,
          assignedUserId: user.id,
          recurrenceType: 'NONE',
          isRecurring: false,
          daysOfWeek: [],
        })

        attendances.push({
          id: fixtureId(sequence + 1000),
          userId: user.id,
          eventId,
          type: 'CHECK_IN',
          status: pattern.checkIn,
          date: eventDate,
          time: pattern.checkIn === 'LATE' ? withTime(eventDate, startHour, 12) : startTime,
          notes: pattern.note,
        })

        if (pattern.checkOut) {
          attendances.push({
            id: fixtureId(sequence + 2000),
            userId: user.id,
            eventId,
            type: 'CHECK_OUT',
            status: pattern.checkOut,
            date: eventDate,
            time: pattern.checkOut === 'EARLY_EXIT' ? withTime(eventDate, endTime.getHours() - 1, endTime.getMinutes()) : endTime,
            notes: pattern.note,
          })
        }

        sequence += 1
      })
    })

  return { events, attendances }
}

async function cleanupLegacyFixtures() {
  const legacyUsers = await prisma.user.findMany({
    where: {
      OR: [
        { email: { endsWith: '@demo.local' } },
        { email: { endsWith: '@edutrack.local' } },
        { email: { in: ['admin@test.com', 'joaquin@test.com', 'maria@test.com', 'carlos@test.com', 'ana@test.com'] } },
      ],
    },
    select: { id: true },
  })

  const userIds = legacyUsers.map((user) => user.id)
  if (userIds.length === 0) return

  await prisma.attendance.deleteMany({
    where: {
      OR: [
        { userId: { in: userIds } },
        { event: { userId: { in: userIds } } },
        { event: { assignedUserId: { in: userIds } } },
      ],
    },
  })
  await prisma.medicalLeave.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.event.deleteMany({
    where: {
      OR: [
        { userId: { in: userIds } },
        { assignedUserId: { in: userIds } },
      ],
    },
  })
  await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.emailVerification.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.passwordReset.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
}

async function upsertUsers(users) {
  for (const user of users) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: user,
      create: user,
    })
  }
}

async function upsertMedicalLeaves(leaves) {
  for (const leave of leaves) {
    await prisma.medicalLeave.upsert({
      where: { id: leave.id },
      update: leave,
      create: leave,
    })
  }
}

async function upsertEvents(events) {
  for (const event of events) {
    await prisma.event.upsert({
      where: { id: event.id },
      update: event,
      create: event,
    })
  }
}

async function upsertAttendances(attendances) {
  for (const attendance of attendances) {
    await prisma.attendance.upsert({
      where: { id: attendance.id },
      update: attendance,
      create: attendance,
    })
  }
}

async function main() {
  const now = new Date()
  const passwordHash = await argon2.hash(FIXTURE_PASSWORD, { type: argon2.argon2id })

  console.log('Limpiando fixtures previos...')
  await cleanupLegacyFixtures()

  const users = createFixtureUsers(passwordHash)
  const leaves = createFixtureLeaves(now)
  const historicalData = createHistoricalData(users, now)
  const events = [...createFixtureEvents(now), ...historicalData.events]
  const attendances = [...createFixtureAttendances(now), ...historicalData.attendances]

  console.log('Creando usuarios persistentes...')
  await upsertUsers(users)

  console.log('Creando licencias...')
  await upsertMedicalLeaves(leaves)

  console.log('Creando eventos...')
  await upsertEvents(events)

  console.log('Creando asistencias...')
  await upsertAttendances(attendances)

  const [userCount, teacherCount, staffCount, eventCount, attendanceCount, leaveCount] = await Promise.all([
    prisma.user.count({ where: { email: { endsWith: '@edutrack.local' } } }),
    prisma.user.count({ where: { email: { endsWith: '@edutrack.local' }, role: 'TEACHER' } }),
    prisma.user.count({ where: { email: { endsWith: '@edutrack.local' }, role: 'STAFF' } }),
    prisma.event.count({ where: { userId: fixtureId(1) } }),
    prisma.attendance.count({ where: { userId: { in: users.map((user) => user.id) } } }),
    prisma.medicalLeave.count({ where: { userId: { in: users.map((user) => user.id) } } }),
  ])

  console.log('')
  console.log('Seed persistente completado')
  console.log(`Usuarios fixture: ${userCount} (teachers: ${teacherCount}, staff: ${staffCount}, admin: 1)`)
  console.log(`Eventos fixture: ${eventCount}`)
  console.log(`Asistencias fixture: ${attendanceCount}`)
  console.log(`Licencias fixture: ${leaveCount}`)
  console.log('')
  console.log('Credenciales para testing:')
  console.log(`- ADMIN: admin@${EMAIL_DOMAIN} | admin | ${FIXTURE_PASSWORD}`)
  console.log(`- TUTOR: laura.perez@${EMAIL_DOMAIN} | laura.perez | ${FIXTURE_PASSWORD}`)
  console.log(`- TUTOR: diego.sosa@${EMAIL_DOMAIN} | diego.sosa | ${FIXTURE_PASSWORD}`)
  console.log(`- STAFF: valentina.gomez@${EMAIL_DOMAIN} | valentina.gomez | ${FIXTURE_PASSWORD}`)
  console.log(`- STAFF: nicolas.fernandez@${EMAIL_DOMAIN} | nicolas.fernandez | ${FIXTURE_PASSWORD}`)
}

main()
  .catch((error) => {
    console.error('Error ejecutando seed persistente:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
