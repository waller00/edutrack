/**
 * Dataset de DEMO — Ciclo 2025 CERRADO, sin 2026 creado.
 *
 * Pensado para mostrar EduTrack en una demo y luego iniciar el ciclo 2026 en vivo
 * con el asistente (promover/repetir/egresar + copiar asignaturas del ciclo origen).
 *
 * Caracteristicas:
 * - Unico ciclo lectivo: 2025, estado CLOSED. No se crea 2026 (queda para el wizard).
 * - Escala media: ~6 cursos, ~7 asignaturas c/u, varios docentes, ~100 estudiantes, staff pocos.
 * - Asistencias COHERENTES: todo presente (titular o suplente) tiene SU PAR entrada + salida.
 *   Nunca marcas huerfanas (entrada sin salida ni viceversa).
 * - Ausencias = estado DERIVADO (no se crean filas): el dia sin marca lo deduce el motor.
 *   Las licencias generan ausencia justificada derivada; las suplencias, "suplida" derivada.
 * - Marcas biometricas (punches ZKTeco) por cada par entrada/salida.
 *
 *   npx tsx prisma/seed-demo-2025.ts
 *   npm run seed:demo
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import type { Event, User } from '@prisma/client'
import { seedAcademicCatalog } from './seed-academic-catalog.js'
import { runBootstrap } from './seed-bootstrap.js'
import { seedTeachers } from './seed-teachers.js'
import { getAppTimezone } from '../src/config/app-timezone.js'
import { generateUniqueUsername } from '../src/services/usernames.js'
import {
  CLASS_SLOTS,
  assertTeacherSpecialties,
  buildValidCi,
  crearPlanificadorDeHorario,
  intBetween,
  pick,
  ratio,
  sha256,
  stableHash,
  toYmd,
  wall,
  ymdToDate,
} from './demo/comun.js'
import { sembrarAsistenciaDelPersonal } from './demo/asistencia-personal.js'
import { seedDemoLibreta } from './demo/libreta.js'

const prisma = new PrismaClient()

const YEAR = 2025
const DATASET_SCHOOL_YEARS = [YEAR] as const
const SCHOOL_YEAR_DATES: Record<number, { start: string; end: string; attendanceUntil: string }> = {
  2025: { start: '2025-03-03', end: '2025-12-05', attendanceUntil: '2025-12-05' },
}

const COURSE_OFFERS: Record<number, Record<string, boolean>> = {
  2025: { '7-EBI': true, '8-EBI': true, '9-EBI': true, '1-EMS': true, '2-EMS': true, '3-EMS': true },
}

const ORIENTATION_OFFERS: Record<number, Record<string, string[]>> = {
  2025: {
    '2-EMS': ['CIENCIA-TECNOLOGIA', 'CSOCIALES-HUMANIDADES', 'CREATIVO-ARTISTICO'],
    '3-EMS': ['CIENCIAS-VIDA', 'CIENCIA-TECNOLOGIA', 'CSOCIALES-HUMANIDADES', 'CREATIVO-ARTISTICO'],
  },
}

const SUBJECTS_BY_COURSE: Record<string, string[]> = {
  '7-EBI': ['Idioma Español', 'Matemática', 'Inglés', 'Biología', 'Historia', 'Ciencias Físico-Química', 'Educación Física y Recreación'],
  '8-EBI': ['Idioma Español', 'Matemática', 'Inglés', 'Geografía', 'Historia', 'Ciencias de la Computación', 'Formación para la Ciudadanía'],
  '9-EBI': ['Literatura', 'Matemática', 'Inglés', 'Física', 'Química', 'Biología', 'Formación para la Ciudadanía'],
  '1-EMS': ['Literatura', 'Matemática', 'Inglés', 'Física', 'Química', 'Filosofía', 'Historia'],
  '2-EMS': ['Literatura', 'Matemática', 'Inglés', 'Filosofía', 'Formación para la Ciudadanía', 'Biología', 'Física'],
  '3-EMS': ['Inglés', 'Literatura', 'Metodología de la Investigación', 'Filosofía y Crítica de los Saberes'],
}

// Asignaturas por orientación usadas para generar clases (deben existir en el
// catálogo y ser enseñables por alguna especialidad docente).
const ORIENTATION_SUBJECTS: Record<string, string[]> = {
  'CIENCIAS-VIDA': ['Química', 'Física', 'Biología Humana', 'Biología Vegetal', 'Matemática CV'],
  'CIENCIA-TECNOLOGIA': ['Matemática CTQ', 'Química', 'Física', 'Matemática CT'],
  'CSOCIALES-HUMANIDADES': ['Historia', 'Sociología', 'Geografía', 'Economía y Educación Financiera'],
  'CREATIVO-ARTISTICO': ['Historia del Arte', 'Música', 'Danza', 'Teatro'],
}

const STUDENT_FIRST_NAMES = [
  'Agustina', 'Benjamín', 'Camila', 'Dante', 'Emilia', 'Facundo', 'Guadalupe', 'Hernán', 'Isabella', 'Joaquín',
  'Kiara', 'Lautaro', 'Martina', 'Nahuel', 'Olivia', 'Pedro', 'Renata', 'Santino', 'Thiago', 'Valentina',
  'Abril', 'Bruno', 'Catalina', 'Diego', 'Emma', 'Francisco', 'Germán', 'Helena', 'Ignacio', 'Julieta',
]

const STUDENT_LAST_NAMES = [
  'Acosta', 'Barrios', 'Cabrera', 'Duarte', 'Estevez', 'Ferreira', 'Giménez', 'Hernández', 'Ibarra', 'Lemos',
  'Méndez', 'Núñez', 'Olivera', 'Pintos', 'Quiroga', 'Ramos', 'Suárez', 'Techera', 'Varela', 'Zunino',
]

const STAFF_INITIAL_PASSWORD = 'funcionario123'


const VALID_ORIENTATION_CODES = ['CIENCIAS-VIDA', 'CIENCIA-TECNOLOGIA', 'CSOCIALES-HUMANIDADES', 'CREATIVO-ARTISTICO']

async function normalizeSchoolYear() {
  console.log('[demo] Dejando unico ciclo 2025 (CLOSED) y eliminando otros ciclos...')
  // Idempotencia: elimina orientaciones que ya no estan en el catalogo (cascada a sus vinculos).
  await prisma.orientation.deleteMany({ where: { code: { notIn: VALID_ORIENTATION_CODES } } })
  await (prisma as any).subjectCourseAssignment.deleteMany({ where: { schoolYear: { code: { notIn: [...DATASET_SCHOOL_YEARS] } } } })
  await (prisma as any).courseOrientation.deleteMany({ where: { schoolYear: { code: { notIn: [...DATASET_SCHOOL_YEARS] } } } })
  await prisma.courseOffering.deleteMany({ where: { schoolYear: { code: { notIn: [...DATASET_SCHOOL_YEARS] } } } })
  await prisma.schoolYear.deleteMany({ where: { code: { notIn: [...DATASET_SCHOOL_YEARS] } } })

  const dates = SCHOOL_YEAR_DATES[YEAR]
  await prisma.schoolYear.upsert({
    where: { code: YEAR },
    create: { code: YEAR, label: `Ciclo lectivo ${YEAR}`, status: 'CLOSED', startsOn: ymdToDate(dates.start), endsOn: ymdToDate(dates.end) },
    update: { label: `Ciclo lectivo ${YEAR}`, status: 'CLOSED', startsOn: ymdToDate(dates.start), endsOn: ymdToDate(dates.end) },
  })
}

async function clearOperationalData() {
  console.log('[demo] Limpiando datos operativos previos...')
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

async function ensureOfferings() {
  const schoolYear = await prisma.schoolYear.findUniqueOrThrow({ where: { code: YEAR }, select: { id: true } })
  const courses = await prisma.course.findMany({ select: { id: true, code: true } })
  const orientations = await prisma.orientation.findMany({ select: { id: true, code: true } })
  const orientationByCode = new Map(orientations.map((row) => [row.code, row.id]))
  const offers = COURSE_OFFERS[YEAR]

  // Idempotencia: reconstruye los vinculos curso-orientacion del ciclo desde cero
  // (evita arrastrar orientaciones ofertadas en corridas anteriores).
  await (prisma as any).courseOrientation.deleteMany({ where: { schoolYear: { code: YEAR } } })

  for (const course of courses) {
    if (!course.code) continue
    const offered = offers[course.code] ?? false
    await prisma.courseOffering.upsert({
      where: { courseId_schoolYearId: { courseId: course.id, schoolYearId: schoolYear.id } },
      create: { courseId: course.id, schoolYearId: schoolYear.id, isActive: offered, isOffered: offered, visibleInFilters: offered, notes: offered ? `Oferta ${YEAR}` : `No ofertado en ${YEAR}` },
      update: { isActive: offered, isOffered: offered, visibleInFilters: offered, notes: offered ? `Oferta ${YEAR}` : `No ofertado en ${YEAR}` },
    })
    for (const orientationCode of ORIENTATION_OFFERS[YEAR]?.[course.code] ?? []) {
      const orientationId = orientationByCode.get(orientationCode)
      if (!orientationId) continue
      await (prisma as any).courseOrientation.upsert({
        where: { courseId_orientationId_schoolYearId: { courseId: course.id, orientationId, schoolYearId: schoolYear.id } },
        create: { courseId: course.id, orientationId, schoolYearId: schoolYear.id, isActive: true, isOffered: true, visibleInFilters: true, notes: `Orientacion ofertada ${YEAR}` },
        update: { isActive: true, isOffered: true, visibleInFilters: true, notes: `Orientacion ofertada ${YEAR}` },
      })
    }
  }
}

async function seedNonWorkingDays() {
  const schoolYear = await prisma.schoolYear.findUniqueOrThrow({ where: { code: YEAR }, select: { id: true } })
  const rows = [
    ['2025-04-14', 'Semana de Turismo', 'Receso institucional'],
    ['2025-04-15', 'Semana de Turismo', 'Receso institucional'],
    ['2025-05-01', 'Dia de los Trabajadores', 'Feriado nacional'],
    ['2025-07-18', 'Jura de la Constitucion', 'Feriado nacional'],
    ['2025-08-25', 'Declaratoria de la Independencia', 'Feriado nacional'],
  ] as const
  await prisma.nonWorkingDay.createMany({
    data: rows.map(([date, reason, notes]) => ({
      date: ymdToDate(date),
      type: reason.includes('Dia') || reason.includes('Jura') || reason.includes('Declaratoria') ? 'HOLIDAY' : 'NON_WORKING_DAY',
      reason,
      notes,
      schoolYearId: schoolYear.id,
    })),
    skipDuplicates: true,
  })
}

async function seedBiometricDevice(users: Array<Pick<User, 'id'>>) {
  // Config real del dispositivo F22 (testing) como default, para que al re-sembrar el
  // lector quede enlazado por su SN real (admsSerial) sin reconfigurar a mano. El entorno
  // (.env del server) sigue pudiendo sobreescribir cada valor.
  // IMPORTANTE: el secreto NO se hardcodea (repo público en GitHub). Debe venir de
  // BIOMETRIC_DEVICE_SECRET en el .env del server; sin esa var, el fallback es solo demo
  // y el F22 real no autenticará hasta cargar el secreto. allowedIps vacío = cualquier IP.
  const device = await prisma.biometricDevice.create({
    data: {
      code: process.env.BIOMETRIC_DEVICE_CODE || 'F22-TEST-01',
      admsSerial: process.env.BIOMETRIC_ADMS_SERIAL || 'SRN5260500102',
      name: process.env.BIOMETRIC_DEVICE_NAME || 'ZKTeco F22 Testing',
      secretHash: sha256(process.env.BIOMETRIC_DEVICE_SECRET || 'liceo-f22-demo-secret'),
      timezone: process.env.BIOMETRIC_DEVICE_TZ || getAppTimezone(),
      isActive: true,
      allowedIps: [],
      lastSeenAt: wall('2025-12-05', 18, 22),
    },
  })
  const mappings = new Map<string, { id: string; deviceUserId: string }>()
  for (const [index, user] of users.entries()) {
    const mapping = await prisma.biometricUserMapping.create({
      data: { deviceId: device.id, userId: user.id, deviceUserId: String(2001 + index), isActive: true },
      select: { id: true, userId: true, deviceUserId: true },
    })
    mappings.set(user.id, { id: mapping.id, deviceUserId: mapping.deviceUserId })
  }
  return { device, mappings }
}

async function seedStudents() {
  const schoolYear = await prisma.schoolYear.findUniqueOrThrow({ where: { code: YEAR }, select: { id: true } })
  const offerings = await prisma.courseOffering.findMany({ include: { course: { select: { code: true } } } })
  const offeringId = new Map(offerings.map((row) => [row.course.code, row.id]))

  // Orientaciones ofertadas por curso en el ciclo: para asignar una a cada estudiante de los
  // cursos que tienen orientación (2-EMS, 3-EMS). Sin esto, ningún alumno pertenece a ninguna
  // orientación y el filtro por orientación no devuelve a nadie.
  const courseCodeByCourseId = new Map(offerings.map((row) => [row.courseId, row.course.code]))
  const courseOrientationRows = (await (prisma as any).courseOrientation.findMany({
    where: { schoolYear: { code: YEAR } },
    select: { id: true, courseId: true, orientationId: true },
  })) as Array<{ id: string; courseId: string; orientationId: string }>
  const orientationsByCourseCode = new Map<string, Array<{ courseOrientationId: string; orientationId: string }>>()
  for (const row of courseOrientationRows) {
    const code = courseCodeByCourseId.get(row.courseId)
    if (!code) continue
    const list = orientationsByCourseCode.get(code) ?? []
    list.push({ courseOrientationId: row.id, orientationId: row.orientationId })
    orientationsByCourseCode.set(code, list)
  }

  type Status = 'ACTIVE' | 'WITHDRAWN' | 'GRADUATED' | 'TRANSFERRED'
  const plans: Array<{ count: number; courseCode: string; status: Status; note: string }> = [
    { count: 20, courseCode: '7-EBI', status: 'ACTIVE', note: 'Grupo 7mo, matricula activa' },
    { count: 18, courseCode: '8-EBI', status: 'ACTIVE', note: 'Grupo 8vo, matricula activa' },
    { count: 15, courseCode: '9-EBI', status: 'ACTIVE', note: 'Grupo 9no, matricula activa' },
    { count: 15, courseCode: '1-EMS', status: 'ACTIVE', note: 'Primero EMS, matricula activa' },
    { count: 3, courseCode: '1-EMS', status: 'WITHDRAWN', note: 'Retiro durante el ciclo' },
    { count: 15, courseCode: '2-EMS', status: 'ACTIVE', note: 'Segundo EMS con orientacion' },
    { count: 2, courseCode: '2-EMS', status: 'TRANSFERRED', note: 'Traslado a otra institucion' },
    // Tercero EMS (último curso) queda ACTIVO: el egreso NO se pre-carga. Recién egresan cuando
    // se inicia el siguiente ciclo desde el asistente (que para el último curso sugiere "Egresa"
    // automáticamente, con la opción de marcarlos "Repite"). Antes de eso no tiene sentido el egreso.
    { count: 14, courseCode: '3-EMS', status: 'ACTIVE', note: 'Tercero EMS (ultimo curso), matricula activa' },
  ]

  let index = 0
  let created = 0
  for (const plan of plans) {
    for (let i = 0; i < plan.count; i += 1) {
      const firstName = STUDENT_FIRST_NAMES[index % STUDENT_FIRST_NAMES.length]
      // El primer apellido avanza recién cuando se agota la vuelta de nombres: así el par
      // (nombre, apellido) no se repite hasta los 600 alumnos. Tomando los dos con `index % n`,
      // el nombre completo volvía a salir cada 60 y la lista quedaba con todos los nombres dobles.
      const lastName = `${STUDENT_LAST_NAMES[Math.floor(index / STUDENT_FIRST_NAMES.length) % STUDENT_LAST_NAMES.length]} ${STUDENT_LAST_NAMES[(index * 7 + 3) % STUDENT_LAST_NAMES.length]}`
      const documentId = buildValidCi(3_100_000 + index * 37)
      // Mismo formato `nombre.apellido` que usa el alta real de estudiantes: es la cuenta con la
      // que el alumno entra a Moodle (ver scripts/provision-demo-moodle-students.ts).
      const username = await generateUniqueUsername(firstName, lastName, async (candidate) => {
        const exist = await prisma.student.findUnique({ where: { username: candidate }, select: { id: true } })
        return Boolean(exist)
      })
      const student = await prisma.student.create({
        data: {
          firstName,
          lastName,
          documentId,
          username,
          contactPhone: `+5989${intBetween(`phone-a-${index}`, 1000000, 9999999)}`,
          tutorPhone: `+5989${intBetween(`phone-b-${index}`, 1000000, 9999999)}`,
          email: `${username}@estudiantes.liceo.test`,
          // Bienvenida ya "enviada": ademas de ser el estado realista para la demo, bloquea el
          // envio real de mails a estos dominios inexistentes si el outbox procesa al alumno.
          moodleWelcomeSentAt: wall(`${YEAR}-02-11`, 9, index % 50),
          address: `${pick(['Rivera', 'Artigas', 'Lavalleja', 'Sarandi', 'Rincon', 'Treinta y Tres'], `street-${index}`)} ${intBetween(`door-${index}`, 1000, 4999)}`,
          healthCardExpiresAt: wall(`2026-${String(3 + (index % 7)).padStart(2, '0')}-15`, 12, 0),
          internalNotes: `${plan.note}. Dato de demo.`,
          createdAt: wall(`${YEAR}-02-10`, 10, index % 50),
        },
      })

      const withdrawnAt =
        plan.status === 'WITHDRAWN'
          ? wall(`${YEAR}-06-${String(5 + (i % 12)).padStart(2, '0')}`, 12, 0)
          : plan.status === 'TRANSFERRED'
            ? wall(`${YEAR}-04-${String(10 + (i % 6)).padStart(2, '0')}`, 12, 0)
            : null
      // Reparte a los estudiantes entre las orientaciones del curso (si tiene).
      const courseOrients = orientationsByCourseCode.get(plan.courseCode) ?? []
      const chosenOrientation = courseOrients.length ? courseOrients[i % courseOrients.length] : null
      await prisma.studentEnrollment.create({
        data: {
          studentId: student.id,
          schoolYearId: schoolYear.id,
          courseOfferingId: offeringId.get(plan.courseCode)!,
          orientationId: chosenOrientation?.orientationId ?? null,
          courseOrientationId: chosenOrientation?.courseOrientationId ?? null,
          enrollmentStatus: plan.status,
          withdrawnAt,
          withdrawalAcademicYear: withdrawnAt ? YEAR : null,
          notes:
            plan.status === 'GRADUATED' ? 'Egreso registrado al cierre del ciclo.'
            : plan.status === 'TRANSFERRED' ? 'Traslado a otra institucion.'
            : plan.status === 'WITHDRAWN' ? 'Retiro administrativo con seguimiento.'
            : 'Matricula activa y seguimiento normal.',
          createdAt: wall(`${YEAR}-02-${String(12 + (i % 12)).padStart(2, '0')}`, 9, 0),
        },
      })

      const annualPaid = ratio(`annual-${student.id}`) > 0.12
      await prisma.studentTuitionYear.create({
        data: {
          studentId: student.id,
          schoolYearId: schoolYear.id,
          year: YEAR,
          paid: annualPaid,
          paidAt: annualPaid ? wall(`${YEAR}-03-${String(8 + (index % 10)).padStart(2, '0')}`, 11, 0) : null,
          amountCents: 315000,
          notes: annualPaid ? 'Cuota anual regularizada.' : 'Saldo anual pendiente o plan de pago.',
        },
      })

      for (let month = 3; month <= 12; month += 1) {
        const leftBeforeMonth = withdrawnAt ? Number(toYmd(withdrawnAt).slice(5, 7)) < month : false
        const paid = !leftBeforeMonth && ratio(`month-${student.id}-${month}`) > 0.14
        await prisma.studentTuitionMonth.create({
          data: {
            studentId: student.id,
            schoolYearId: schoolYear.id,
            year: YEAR,
            month,
            paid,
            paidAt: paid ? wall(`${YEAR}-${String(month).padStart(2, '0')}-${String(6 + ((index + month) % 15)).padStart(2, '0')}`, 13, month % 50) : null,
            amountCents: 138000,
            notes: paid ? 'Pago mensual acreditado.' : 'Pendiente o bonificacion en revision.',
          },
        })
      }
      index += 1
      created += 1
    }
  }
  console.log(`[demo] Estudiantes creados: ${created}`)
}

async function seedMedicalLeaves(teachers: Array<Pick<User, 'id'>>) {
  const selected = teachers.slice(1, 7)
  const ranges = [
    ['2025-04-21', '2025-04-25', 'Licencia médica presentada'],
    ['2025-06-09', '2025-06-11', 'Licencia médica presentada'],
    ['2025-08-11', '2025-08-13', 'Licencia médica presentada'],
    ['2025-09-15', '2025-09-19', 'Licencia médica presentada'],
    ['2025-10-06', '2025-10-10', 'Licencia médica presentada'],
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
        approvedAt: wall(start, 15, 30),
        notes: 'Licencia de demo; no almacena certificado ni diagnóstico.',
      },
    })
  }
}

async function seedEvents(admin: User, teachers: User[], staffUsers: User[]) {
  const schoolYear = await prisma.schoolYear.findUniqueOrThrow({ where: { code: YEAR }, select: { id: true } })
  const offerings = await prisma.courseOffering.findMany({
    where: { isOffered: true, visibleInFilters: true, schoolYear: { code: YEAR } },
    include: { course: true },
  })
  const subjects = await prisma.subject.findMany({ select: { id: true, name: true } })
  const subjectByName = new Map(subjects.map((row) => [row.name, row.id]))
  const orientations = await prisma.orientation.findMany({ select: { id: true, code: true, name: true } })
  const orientationByCode = new Map(orientations.map((row) => [row.code ?? '', row]))
  const courseOrientations = await (prisma as any).courseOrientation.findMany({
    where: { isOffered: true, schoolYearId: schoolYear.id },
    select: { id: true, courseId: true, orientationId: true },
  })
  const courseOrientationId = new Map(courseOrientations.map((row: any) => [`${row.courseId}:${row.orientationId}`, row.id]))
  assertTeacherSpecialties(teachers)

  const planificador = crearPlanificadorDeHorario(teachers)
  const createdEvents: Event[] = []
  const dates = SCHOOL_YEAR_DATES[YEAR]

  async function createRecurringClass(p: {
    courseOffering: (typeof offerings)[number]
    subjectName: string
    subjectIndex: number
    orientation?: { id: string; code: string | null; name: string }
  }) {
    const subjectId = subjectByName.get(p.subjectName)
    if (!subjectId) return
    const grupo = `${p.courseOffering.id}:${p.orientation?.id ?? 'GENERAL'}`
    const franja = planificador.reservarFranja({ grupo, ordenCurso: p.courseOffering.course.sortOrder, indiceAsignatura: p.subjectIndex })
    if (!franja) throw new Error(`[demo] No se encontro franja libre para grupo ${grupo}`)
    const { franja: slotIndex, dias: days } = franja
    const slot = CLASS_SLOTS[slotIndex]
    const teacher = planificador.elegirDocente({ asignatura: p.subjectName, dias: days, franja: slotIndex })
    if (!teacher) throw new Error(`[demo] No hay docente compatible y libre para "${p.subjectName}", franja ${slotIndex + 1}.`)
    const orientationLabel = p.orientation ? ` - ${p.orientation.name}` : ''
    const courseOrientation = p.orientation && courseOrientationId.get(`${p.courseOffering.courseId}:${p.orientation.id}`)
    const event = await prisma.event.create({
      data: {
        title: `${p.subjectName} - ${p.courseOffering.course.name}${orientationLabel} Grupo A`,
        description: `Clase recurrente de ${p.subjectName} para ${p.courseOffering.course.name}.`,
        type: 'CLASE',
        status: 'COMPLETED',
        startDate: ymdToDate(dates.start),
        endDate: ymdToDate(dates.end),
        startTime: wall(dates.start, slot.start[0], slot.start[1]),
        endTime: wall(dates.start, slot.end[0], slot.end[1]),
        location: `Aula ${p.courseOffering.course.sortOrder}${String(slotIndex + 1).padStart(2, '0')}`,
        userId: admin.id,
        assignedUserId: teacher.id,
        schoolYearId: schoolYear.id,
        courseOfferingId: p.courseOffering.id,
        orientationId: p.orientation?.id ?? null,
        courseOrientationId: (courseOrientation as string) ?? null,
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
    const baseSubjects = SUBJECTS_BY_COURSE[offering.course.code ?? ''] ?? []
    for (let i = 0; i < baseSubjects.length; i += 1) {
      await createRecurringClass({ courseOffering: offering, subjectName: baseSubjects[i], subjectIndex: i })
    }
    const orientationCodes = ORIENTATION_OFFERS[YEAR]?.[offering.course.code ?? ''] ?? []
    for (const orientationCode of orientationCodes.slice(0, 2)) {
      const orientation = orientationByCode.get(orientationCode)
      if (!orientation) continue
      const list = ORIENTATION_SUBJECTS[orientationCode] ?? []
      for (let i = 0; i < Math.min(3, list.length); i += 1) {
        await createRecurringClass({
          courseOffering: offering,
          subjectName: list[i],
          subjectIndex: baseSubjects.length + i + (stableHash(orientationCode) % 3),
          orientation,
        })
      }
    }
  }

  await prisma.event.create({
    data: {
      title: `Coordinacion docente semanal ${YEAR}`,
      description: 'Espacio de coordinacion pedagogica y seguimiento de grupos.',
      type: 'REUNION',
      status: 'COMPLETED',
      startDate: ymdToDate(dates.start),
      endDate: ymdToDate(dates.end),
      startTime: wall(dates.start, 14, 0),
      endTime: wall(dates.start, 15, 30),
      location: 'Sala docente',
      userId: admin.id,
      assignedUserId: teachers[0].id,
      schoolYearId: schoolYear.id,
      recurrenceType: 'WEEKLY',
      recurrenceEnd: ymdToDate(dates.end),
      isRecurring: true,
      daysOfWeek: [3],
    },
  })

  for (const staff of staffUsers) {
    await prisma.event.create({
      data: {
        title: `Jornada laboral - ${staff.name ?? staff.username ?? staff.email}`,
        description: 'Turno administrativo de lunes a viernes, 08:00 a 16:00.',
        type: 'JORNADA_LABORAL',
        status: 'COMPLETED',
        startDate: ymdToDate(dates.start),
        endDate: ymdToDate(dates.end),
        startTime: wall(dates.start, 8, 0),
        endTime: wall(dates.start, 16, 0),
        location: 'Administracion',
        userId: admin.id,
        assignedUserId: staff.id,
        schoolYearId: schoolYear.id,
        recurrenceType: 'DAILY',
        recurrenceEnd: ymdToDate(dates.end),
        isRecurring: true,
        daysOfWeek: [1, 2, 3, 4, 5],
      },
    })
  }

  console.log(`[demo] Eventos recurrentes creados: ${createdEvents.length + 1 + staffUsers.length}`)
  return createdEvents
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
        userAgent: 'EduTrack seed demo 2025',
        source: 'SEED',
        entityType: 'Event',
        entityId: event.id,
        metadata: { title: event.title, dataset: 'demo-2025' },
      },
    })
  }
  await prisma.auditLog.create({
    data: {
      occurredAt: wall('2025-11-28', 17, 15),
      action: 'SYSTEM_SETTINGS_UPDATED',
      actorUserId: admin.id,
      actorIp: '10.10.0.12',
      userAgent: 'EduTrack seed demo 2025',
      source: 'SEED',
      entityType: 'SystemSettings',
      entityId: 'default',
      metadata: { attendanceLateToleranceMinutes: 5, attendanceEarlyExitToleranceMinutes: 5 },
    },
  })
}

async function ensureDemoStaffUsers() {
  const staffRole = await prisma.orgRole.findUnique({ where: { code: 'STAFF' } })
  if (!staffRole) return []
  const rows = [
    ['maria.adscriptora', 'María', 'Santos', 'Adscripta turno matutino'],
    ['pablo.bedel', 'Pablo', 'Molina', 'Bedelia y gestion de asistencias'],
  ] as const
  const users: User[] = []
  for (let i = 0; i < rows.length; i += 1) {
    const [username, firstName, lastName, note] = rows[i]
    const user = await prisma.user.upsert({
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
        roleId: staffRole.id,
        emailVerifiedAt: new Date(),
        isApproved: true,
        approvedAt: new Date(),
        isActive: true,
        failedLoginAttempts: 0,
        lockUntil: null,
      },
      update: { firstName, lastName, name: `${firstName} ${lastName}`, roleId: staffRole.id, isApproved: true, isActive: true },
    })
    users.push(user)
    try {
      const { createKeycloakUser } = await import('../src/auth/keycloak.js')
      await createKeycloakUser({ email: user.email, username, firstName, lastName, password: STAFF_INITIAL_PASSWORD, role: 'STAFF', emailVerified: true })
    } catch (error) {
      console.warn(`[demo] Keycloak staff opcional (${username}):`, error)
    }
    console.log(`[demo] Usuario STAFF listo: ${username} (${note})`)
  }
  return users
}

/**
 * Cuenta técnica de performance/CI, igual que en producción: STAFF, activa, aprobada y con el
 * email verificado, pero sin nombre/teléfono/CI y sin usuario en Keycloak (es un fixture, no una
 * cuenta de login real). username = 'edutrack.local' tal cual está en prod.
 */
async function ensureCiPerformanceUser() {
  const staffRole = await prisma.orgRole.findUnique({ where: { code: 'STAFF' } })
  if (!staffRole) return
  await prisma.user.upsert({
    where: { email: 'ci.performance@edutrack.local' },
    create: {
      email: 'ci.performance@edutrack.local',
      username: 'edutrack.local',
      roleId: staffRole.id,
      isActive: true,
      isApproved: true,
      emailVerifiedAt: new Date(),
    },
    update: { roleId: staffRole.id, isActive: true, isApproved: true, emailVerifiedAt: new Date() },
  })
  console.log('[demo] Usuario CI/performance listo: ci.performance@edutrack.local (STAFF)')
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL no esta definida')

  console.log('[demo] Base estructural: bootstrap + catalogo + docentes...')
  await runBootstrap()
  await seedAcademicCatalog({ years: [YEAR] })
  await seedTeachers()
  const staffUsers = await ensureDemoStaffUsers()
  await ensureCiPerformanceUser()
  const teachers = await prisma.user.findMany({
    where: { orgRole: { code: 'TEACHER' }, isActive: true, teacherProfile: { is: { isActive: true } } },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  })
  assertTeacherSpecialties(teachers)

  await clearOperationalData()
  await normalizeSchoolYear()
  await ensureOfferings()
  await seedNonWorkingDays()

  const admin = await prisma.user.findFirstOrThrow({ where: { orgRole: { code: 'ADMIN' } } })
  const biometric = await seedBiometricDevice([admin, ...teachers, ...staffUsers])

  await seedStudents()
  await seedMedicalLeaves(teachers)
  await seedEvents(admin, teachers, staffUsers)
  const dates = SCHOOL_YEAR_DATES[YEAR]
  const asistencia = await sembrarAsistenciaDelPersonal({
    db: prisma,
    schoolYearId: (await prisma.schoolYear.findUniqueOrThrow({ where: { code: YEAR }, select: { id: true } })).id,
    desde: dates.start,
    hasta: dates.attendanceUntil,
    docentes: teachers,
    device: biometric.device,
    mappings: biometric.mappings,
    dataset: 'seed-demo-2025',
  })
  console.log(`[demo] Asistencias presentes (pares entrada+salida): ${asistencia.presentes}`)
  console.log(`[demo] Ausencias guardadas (justificada/no justificada/suplida): ${asistencia.ausencias}`)
  console.log(`[demo] Marcaciones biometricas creadas: ${asistencia.punches}`)
  console.log(`[demo] Suplencias creadas: ${asistencia.suplencias}`)

  // Libreta y pase de lista: sin esto, el módulo que más cambió queda vacío en la demo.
  console.log('[demo] Libreta digital y pase de lista del ciclo...')
  const schoolYearRow = await prisma.schoolYear.findUniqueOrThrow({ where: { code: YEAR }, select: { id: true } })
  const libreta = await seedDemoLibreta(prisma, { schoolYearId: schoolYearRow.id })

  await seedAudit(admin)

  await prisma.systemSettings.update({
    where: { id: 'default' },
    data: {
      attendanceNoShowGraceMinutes: 15,
      attendanceLateToleranceMinutes: 5,
      attendanceEarlyExitToleranceMinutes: 5,
      attendanceClassBridgeGapMinutes: 60,
      attendanceMonitorEnabled: true,
      // Sincronizacion Moodle prendida (incluyendo alumnos) para que, una vez aprovisionadas las
      // cuentas, el tick del server mantenga las matriculas al dia. No-op si falta MOODLE_BASE_URL.
      moodleSyncEnabled: true,
      moodleSyncStudents: true,
    },
  })

  const counts = await Promise.all([
    prisma.schoolYear.count(),
    prisma.student.count(),
    prisma.studentEnrollment.count(),
    prisma.event.count(),
    prisma.attendance.count(),
    prisma.substitution.count(),
    prisma.medicalLeave.count(),
    prisma.biometricPunch.count(),
  ])
  console.log('')
  console.log('[demo] Dataset de demo 2025 completado.')
  console.log(`[demo] Ciclos lectivos: ${counts[0]} (solo 2025 CLOSED; 2026 NO creado, queda para el wizard)`)
  console.log(`[demo] Estudiantes: ${counts[1]} | Matriculas: ${counts[2]}`)
  console.log(`[demo] Eventos: ${counts[3]} | Asistencias (pares de presentes): ${counts[4]} | Suplencias: ${counts[5]}`)
  console.log(`[demo] Licencias: ${counts[6]} | Punches biometricos: ${counts[7]}`)
  console.log(
    `[demo] Libretas: ${libreta.libretas} | Evaluaciones: ${libreta.evaluaciones} | Notas: ${libreta.notas}`,
  )
  console.log(
    `[demo] Cierres con C y R: ${libreta.cierres} | Marcas de pase de lista: ${libreta.marcasDeAsistencia}`,
  )
  console.log(`[demo] Clave staff seed: ${STAFF_INITIAL_PASSWORD}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
