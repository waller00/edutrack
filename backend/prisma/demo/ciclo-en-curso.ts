/**
 * Dataset de un **ciclo lectivo en curso**: el liceo funcionando, con datos hasta una fecha de
 * corte (normalmente hoy) y nada escrito después.
 *
 * El dataset de demo que ya existía dejaba el 2025 cerrado y el ciclo siguiente sin abrir, para
 * mostrar el asistente de apertura en vivo. Pero una vez abierto el ciclo nuevo, el sistema queda
 * vacío: horario sin cargar, libretas sin notas, asistencia sin marcas. Esto llena ese ciclo como
 * si el liceo lo hubiera venido usando desde marzo:
 *
 *  - matrícula heredada del ciclo anterior (promovidos, repetidores y egresados) más el ingreso
 *    nuevo de 7.º, con el resultado académico del año anterior cargado;
 *  - horario semanal armado desde el **plan de asignaturas del propio ciclo**
 *    (`SubjectCourseAssignment`), no desde una lista fija: es el plan que la institución cargó;
 *  - asistencia del personal, licencias y suplencias hasta la fecha de corte;
 *  - libreta: boletines cerrados hasta la fecha, tramo en curso con evaluaciones cargadas, y pase
 *    de lista repartido en el año;
 *  - cuotas del año hasta el mes de corte.
 *
 * Es **idempotente y acotado al ciclo**: borra y recrea lo operativo de ese ciclo y no toca los
 * ciclos cerrados ni los usuarios. Volver a correrlo da el mismo resultado.
 */
import type { PrismaClient, User } from '@prisma/client'
import { DateTime } from 'luxon'
import { getAppTimezone } from '../../src/config/app-timezone.js'
import { generateUniqueUsername } from '../../src/services/usernames.js'
import {
  CLASS_SLOTS,
  buildValidCi,
  crearPlanificadorDeHorario,
  intBetween,
  pick,
  ratio,
  toYmd,
  wall,
  ymdToDate,
} from './comun.js'
import { sembrarAsistenciaDelPersonal } from './asistencia-personal.js'
import { seedDemoLibreta, type DemoLibretaSummary } from './libreta.js'

/**
 * Designaciones que el dataset respeta tal cual, por `username` de docente y
 * `curso|asignatura`. Son las que alguien ya usó para mostrar el sistema: si el generador se las
 * reasignara a otro docente, el que entra a la demo con su cuenta se queda sin libreta.
 */
const DESIGNACIONES_FIJAS: Record<string, string> = {
  '8-EBI|Biología': 'jorge.marrero',
}

/** Nombres del ingreso nuevo: distintos de los del ciclo anterior, para no repetir personas. */
const NOMBRES_INGRESO = [
  'Alma', 'Bautista', 'Candela', 'Ciro', 'Delfina', 'Elías', 'Flor', 'Gael', 'Iara', 'Jazmín',
  'Lorenzo', 'Luna', 'Mateo', 'Mía', 'Nicolás', 'Paz', 'Rafael', 'Sofía', 'Tomás', 'Zoe',
] as const

const APELLIDOS_INGRESO = [
  'Alonso', 'Bentancor', 'Carbajal', 'Delgado', 'Etchegaray', 'Fagúndez', 'Gadea', 'Hornos',
  'Irisarri', 'Larrosa', 'Machado', 'Nievas', 'Ordoñez', 'Pazos', 'Riveiro', 'Silveira',
] as const

const ESCUELAS_DE_ORIGEN = [
  'Escuela N.º 12 Artigas',
  'Escuela N.º 45 Juan Zorrilla',
  'Escuela N.º 7 República Argentina',
  'Colegio y Liceo San José',
  'Escuela N.º 108 Brasil',
] as const

export type ResumenCicloEnCurso = {
  ciclo: number
  desde: string
  hasta: string
  ofertas: number
  promovidos: number
  repetidores: number
  egresados: number
  ingresos: number
  matriculasVigentes: number
  eventos: number
  presentes: number
  ausencias: number
  punches: number
  suplencias: number
  licencias: number
  cuotas: number
  libreta: DemoLibretaSummary
}

/** Primer lunes del mes: el día en que empiezan las clases. */
function primerLunes(year: number, month: number): string {
  let day = DateTime.fromObject({ year, month, day: 1 }, { zone: getAppTimezone() })
  while (day.weekday !== 1) day = day.plus({ days: 1 })
  return day.toFormat('yyyy-MM-dd')
}

/** Feriados y recesos del año que caen dentro del ciclo. */
function diasNoLaborables(year: number): Array<{ ymd: string; tipo: 'HOLIDAY' | 'NON_WORKING_DAY'; motivo: string; nota: string }> {
  // La Semana de Turismo se mueve con la Pascua; se calcula para no hardcodear un año.
  const pascua = domingoDePascua(year)
  const semanaDeTurismo = Array.from({ length: 5 }, (_, i) => pascua.minus({ days: 6 - i }).toFormat('yyyy-MM-dd'))
  return [
    ...semanaDeTurismo.map((ymd) => ({ ymd, tipo: 'NON_WORKING_DAY' as const, motivo: 'Semana de Turismo', nota: 'Receso institucional' })),
    { ymd: `${year}-05-01`, tipo: 'HOLIDAY' as const, motivo: 'Día de los Trabajadores', nota: 'Feriado nacional' },
    { ymd: `${year}-06-19`, tipo: 'HOLIDAY' as const, motivo: 'Natalicio de Artigas', nota: 'Feriado nacional' },
    { ymd: `${year}-07-18`, tipo: 'HOLIDAY' as const, motivo: 'Jura de la Constitución', nota: 'Feriado nacional' },
    { ymd: `${year}-08-25`, tipo: 'HOLIDAY' as const, motivo: 'Declaratoria de la Independencia', nota: 'Feriado nacional' },
    { ymd: `${year}-10-12`, tipo: 'NON_WORKING_DAY' as const, motivo: 'Día de la Diversidad Cultural', nota: 'Feriado no laborable' },
    { ymd: `${year}-11-02`, tipo: 'NON_WORKING_DAY' as const, motivo: 'Día de los Difuntos', nota: 'Feriado no laborable' },
  ]
}

/** Algoritmo de Gauss: el domingo de Pascua del año, de donde sale la Semana de Turismo. */
function domingoDePascua(year: number): DateTime {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return DateTime.fromObject({ year, month, day }, { zone: getAppTimezone() })
}

export async function seedCicloEnCurso(
  db: PrismaClient,
  options: {
    /** Código del ciclo a llenar (p. ej. 2026). */
    ciclo: number
    /** Día civil de corte: no se escribe nada después de esta fecha. */
    hasta: string
    /** Inicio de clases; por defecto el primer lunes de marzo. */
    desde?: string
    /** Fin previsto del ciclo; por defecto el primer viernes de diciembre. */
    fin?: string
    /** Tamaño del grupo de 7.º que ingresa este año. */
    ingreso?: number
    clasesPorLibreta?: number
  },
): Promise<ResumenCicloEnCurso> {
  const { ciclo, hasta, ingreso = 20, clasesPorLibreta = 8 } = options
  const desde = options.desde ?? primerLunes(ciclo, 3)
  const fin = options.fin ?? DateTime.fromISO(primerLunes(ciclo, 12), { zone: getAppTimezone() }).plus({ days: 4 }).toFormat('yyyy-MM-dd')
  if (hasta < desde) throw new Error(`[en-curso] La fecha de corte ${hasta} es anterior al inicio del ciclo ${desde}.`)

  // ---------------------------------------------------------------- ciclo y oferta
  const anterior = await db.schoolYear.findFirst({
    where: { code: { lt: ciclo } },
    orderBy: { code: 'desc' },
    select: { id: true, code: true },
  })

  const schoolYear = await db.schoolYear.upsert({
    where: { code: ciclo },
    create: {
      code: ciclo,
      label: `Ciclo lectivo ${ciclo}`,
      status: 'ACTIVE',
      startsOn: ymdToDate(desde),
      endsOn: ymdToDate(fin),
    },
    update: { status: 'ACTIVE', startsOn: ymdToDate(desde), endsOn: ymdToDate(fin) },
    select: { id: true, code: true },
  })
  console.log(`[en-curso] Ciclo ${ciclo} ACTIVE del ${desde} al ${fin}; corte de datos: ${hasta}.`)

  const cursos = await db.course.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, code: true, name: true, level: true, sortOrder: true },
  })

  // Oferta del ciclo: la del ciclo anterior, para no inventar cursos que el liceo no dicta.
  const ofertaAnterior = anterior
    ? await db.courseOffering.findMany({ where: { schoolYearId: anterior.id }, select: { courseId: true, isOffered: true } })
    : []
  const seOfrece = new Map(ofertaAnterior.map((row) => [row.courseId, row.isOffered]))
  let ofertas = 0
  for (const curso of cursos) {
    const offered = ofertaAnterior.length > 0 ? (seOfrece.get(curso.id) ?? false) : true
    await db.courseOffering.upsert({
      where: { courseId_schoolYearId: { courseId: curso.id, schoolYearId: schoolYear.id } },
      create: {
        courseId: curso.id,
        schoolYearId: schoolYear.id,
        isActive: offered,
        isOffered: offered,
        visibleInFilters: offered,
        notes: offered ? `Oferta ${ciclo}` : `No ofertado en ${ciclo}`,
      },
      // La oferta puede haberla tocado Dirección: sólo se completa la que falta.
      update: {},
    })
    if (offered) ofertas += 1
  }

  // Orientaciones ofertadas y plan de asignaturas: se copian del ciclo anterior si faltan.
  if (anterior) {
    const orientacionesAnteriores = await db.courseOrientation.findMany({
      where: { schoolYearId: anterior.id },
      select: { courseId: true, orientationId: true, isActive: true, isOffered: true, visibleInFilters: true },
    })
    for (const row of orientacionesAnteriores) {
      await db.courseOrientation.upsert({
        where: {
          courseId_orientationId_schoolYearId: {
            courseId: row.courseId,
            orientationId: row.orientationId,
            schoolYearId: schoolYear.id,
          },
        },
        create: { ...row, schoolYearId: schoolYear.id, notes: `Orientación ofertada ${ciclo}` },
        update: {},
      })
    }

    const planDelCiclo = await db.subjectCourseAssignment.count({ where: { schoolYearId: schoolYear.id } })
    if (planDelCiclo === 0) {
      const planAnterior = await db.subjectCourseAssignment.findMany({
        where: { schoolYearId: anterior.id },
        select: {
          subjectId: true, level: true, courseId: true, orientationId: true, associationType: true,
          isActive: true, isOffered: true, visibleInFilters: true, sortOrder: true,
        },
      })
      await db.subjectCourseAssignment.createMany({
        data: planAnterior.map((row) => ({ ...row, schoolYearId: schoolYear.id, notes: `Plan heredado del ciclo ${anterior.code}` })),
      })
      console.log(`[en-curso] Plan de asignaturas heredado del ${anterior.code}: ${planAnterior.length} asociaciones.`)
    }
  }

  const ofertasDelCiclo = await db.courseOffering.findMany({
    where: { schoolYearId: schoolYear.id },
    select: { id: true, courseId: true, isOffered: true, visibleInFilters: true, course: { select: { code: true, name: true, level: true, sortOrder: true } } },
  })
  const ofertaPorCurso = new Map(ofertasDelCiclo.map((row) => [row.courseId, row]))

  const orientacionesDelCiclo = await db.courseOrientation.findMany({
    where: { schoolYearId: schoolYear.id, isOffered: true },
    select: { id: true, courseId: true, orientationId: true, orientation: { select: { code: true, name: true } } },
  })
  const orientacionesPorCurso = new Map<string, typeof orientacionesDelCiclo>()
  for (const row of orientacionesDelCiclo) {
    orientacionesPorCurso.set(row.courseId, [...(orientacionesPorCurso.get(row.courseId) ?? []), row])
  }

  // ---------------------------------------------------------------- matrícula
  const matricula = await asegurarMatricula({
    db, schoolYear, anterior, cursos, ofertaPorCurso, orientacionesPorCurso, ingreso, ciclo, desde, hasta,
  })

  // ---------------------------------------------------------------- limpieza de lo operativo
  await limpiarOperativo(db, schoolYear.id, desde, fin)

  // ---------------------------------------------------------------- días no laborables
  for (const dia of diasNoLaborables(ciclo)) {
    await db.nonWorkingDay.upsert({
      where: { date: ymdToDate(dia.ymd) },
      create: { date: ymdToDate(dia.ymd), type: dia.tipo, reason: dia.motivo, notes: dia.nota, schoolYearId: schoolYear.id },
      update: { type: dia.tipo, reason: dia.motivo, notes: dia.nota, schoolYearId: schoolYear.id },
    })
  }

  // ---------------------------------------------------------------- horario
  // Alcanza el rol: `Event.assignedUserId` no mira `TeacherProfile`, y de hecho ninguna pantalla lo
  // mira — es un registro que sólo escribe el seed de docentes. Exigirlo dejaba sin horas (y sin
  // libreta) a los docentes dados de alta desde la aplicación.
  const docentes = await db.user.findMany({
    where: { orgRole: { code: 'TEACHER' }, isActive: true },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  })
  if (docentes.length === 0) throw new Error('[en-curso] No hay docentes activos: sembrá primero el dataset base.')
  const admin = await db.user.findFirstOrThrow({ where: { orgRole: { code: 'ADMIN' } } })
  const staff = await db.user.findMany({
    where: { orgRole: { code: 'STAFF' }, isActive: true, name: { not: null } },
    orderBy: { username: 'asc' },
  })

  const eventos = await sembrarHorario({
    db, schoolYear, desde, fin, docentes, admin, staff, ofertasDelCiclo, orientacionesPorCurso,
  })

  // ---------------------------------------------------------------- licencias y asistencia
  const licencias = await sembrarLicencias(db, docentes, ciclo, desde, hasta)

  const { device, mappings } = await asegurarLectorBiometrico(db, [admin, ...docentes, ...staff])
  const asistencia = await sembrarAsistenciaDelPersonal({
    db, schoolYearId: schoolYear.id, desde, hasta, docentes, device, mappings, dataset: `demo-en-curso-${ciclo}`,
  })

  // ---------------------------------------------------------------- libreta y pase de lista
  console.log('[en-curso] Libreta digital y pase de lista...')
  const libreta = await seedDemoLibreta(db, {
    schoolYearId: schoolYear.id,
    hasta: ymdToDate(hasta),
    clasesPorLibreta,
  })

  // ---------------------------------------------------------------- cuotas
  const cuotas = await sembrarCuotas(db, schoolYear.id, ciclo, hasta)

  await sembrarAuditoria(db, admin.id, ciclo)

  return {
    ciclo,
    desde,
    hasta,
    ofertas,
    ...matricula,
    eventos,
    presentes: asistencia.presentes,
    ausencias: asistencia.ausencias,
    punches: asistencia.punches,
    suplencias: asistencia.suplencias,
    licencias,
    cuotas,
    libreta,
  }
}

// ============================================================================ matrícula

async function asegurarMatricula(p: {
  db: PrismaClient
  schoolYear: { id: string; code: number }
  anterior: { id: string; code: number } | null
  cursos: Array<{ id: string; code: string | null; sortOrder: number }>
  ofertaPorCurso: Map<string, { id: string; isOffered: boolean }>
  orientacionesPorCurso: Map<string, Array<{ id: string; orientationId: string }>>
  ingreso: number
  ciclo: number
  desde: string
  hasta: string
}) {
  const { db, schoolYear, anterior, cursos, ofertaPorCurso, orientacionesPorCurso, ingreso, ciclo, hasta } = p
  const siguienteCurso = new Map(cursos.map((curso, i) => [curso.id, cursos[i + 1] ?? null]))
  let promovidos = 0
  let repetidores = 0
  let egresados = 0
  let ingresos = 0

  if (anterior) {
    const previas = await db.studentEnrollment.findMany({
      where: { schoolYearId: anterior.id, enrollmentStatus: 'ACTIVE' },
      select: {
        id: true, studentId: true, academicResult: true,
        courseOffering: { select: { courseId: true } },
      },
    })
    const yaMatriculados = new Set(
      (await db.studentEnrollment.findMany({ where: { schoolYearId: schoolYear.id }, select: { studentId: true } })).map(
        (row) => row.studentId,
      ),
    )

    let indice = 0
    for (const previa of previas) {
      const destino = siguienteCurso.get(previa.courseOffering.courseId) ?? null
      const sorteo = ratio(`resultado-${previa.id}`)
      // Último curso: egresa. No hay curso siguiente al que promoverlo.
      if (!destino) {
        await db.studentEnrollment.update({
          where: { id: previa.id },
          data: {
            enrollmentStatus: 'GRADUATED',
            academicResult: previa.academicResult ?? 'PROMOTED',
            notes: 'Egreso registrado al cierre del ciclo.',
          },
        })
        egresados += 1
        continue
      }

      const repite = sorteo < 0.05
      const resultado = repite ? 'REPEATED' : sorteo < 0.2 ? 'PROMOTED_WITH_PENDING' : 'PROMOTED'
      if (!previa.academicResult) {
        await db.studentEnrollment.update({ where: { id: previa.id }, data: { academicResult: resultado } })
      }
      if (yaMatriculados.has(previa.studentId)) {
        // La matrícula del ciclo ya existe (la creó el asistente de apertura): no se toca.
        promovidos += 1
        continue
      }

      const cursoDestino = repite ? previa.courseOffering.courseId : destino.id
      const oferta = ofertaPorCurso.get(cursoDestino)
      if (!oferta?.isOffered) continue
      const orientaciones = orientacionesPorCurso.get(cursoDestino) ?? []
      const elegida = orientaciones.length > 0 ? orientaciones[indice % orientaciones.length] : null
      await db.studentEnrollment.create({
        data: {
          studentId: previa.studentId,
          schoolYearId: schoolYear.id,
          courseOfferingId: oferta.id,
          orientationId: elegida?.orientationId ?? null,
          courseOrientationId: elegida?.id ?? null,
          enrollmentStatus: 'ACTIVE',
          notes: repite ? 'Recursa el curso.' : 'Matrícula activa y seguimiento normal.',
        },
      })
      if (repite) repetidores += 1
      else promovidos += 1
      indice += 1
    }
  }

  // Ingreso de 7.º: el primer curso no recibe promovidos de ningún lado.
  const primerCurso = cursos[0]
  const ofertaPrimero = primerCurso ? ofertaPorCurso.get(primerCurso.id) : null
  if (ofertaPrimero?.isOffered) {
    const actuales = await db.studentEnrollment.count({ where: { courseOfferingId: ofertaPrimero.id } })
    const faltan = Math.max(0, ingreso - actuales)
    for (let i = 0; i < faltan; i += 1) {
      const semilla = `${ciclo}-${i}`
      const firstName = NOMBRES_INGRESO[i % NOMBRES_INGRESO.length]
      const lastName = `${APELLIDOS_INGRESO[Math.floor(i / NOMBRES_INGRESO.length) % APELLIDOS_INGRESO.length]} ${APELLIDOS_INGRESO[(i * 7 + 3) % APELLIDOS_INGRESO.length]}`
      const username = await generateUniqueUsername(firstName, lastName, async (candidate) => {
        const exist = await db.student.findUnique({ where: { username: candidate }, select: { id: true } })
        return Boolean(exist)
      })
      const student = await db.student.create({
        data: {
          firstName,
          lastName,
          documentId: buildValidCi(5_200_000 + i * 41 + ciclo),
          username,
          email: `${username}@estudiantes.liceo.test`,
          contactPhone: `+5989${intBetween(`tel-a-${semilla}`, 1000000, 9999999)}`,
          tutorPhone: `+5989${intBetween(`tel-b-${semilla}`, 1000000, 9999999)}`,
          // 12 años al ingresar a 7.º, que es la edad reglamentaria.
          birthDate: wall(`${ciclo - 12}-${String(1 + (i % 12)).padStart(2, '0')}-${String(2 + (i % 26)).padStart(2, '0')}`, 12, 0),
          admittedFrom: pick(ESCUELAS_DE_ORIGEN, `escuela-${semilla}`),
          address: `${pick(['Rivera', 'Artigas', 'Lavalleja', 'Sarandi', 'Rincon', 'Treinta y Tres'], `calle-${semilla}`)} ${intBetween(`puerta-${semilla}`, 1000, 4999)}`,
          healthCardExpiresAt: wall(`${ciclo + 1}-${String(1 + (i % 12)).padStart(2, '0')}-15`, 12, 0),
          moodleWelcomeSentAt: wall(`${ciclo}-02-12`, 9, i % 50),
          internalNotes: `Ingreso ${ciclo} a 7.º. Dato de demo.`,
          createdAt: wall(`${ciclo}-02-${String(9 + (i % 10)).padStart(2, '0')}`, 10, i % 50),
        },
      })
      await db.studentEnrollment.create({
        data: {
          studentId: student.id,
          schoolYearId: schoolYear.id,
          courseOfferingId: ofertaPrimero.id,
          enrollmentStatus: 'ACTIVE',
          notes: 'Ingreso del año; matrícula activa.',
          createdAt: wall(`${ciclo}-02-${String(10 + (i % 10)).padStart(2, '0')}`, 9, 0),
        },
      })
      ingresos += 1
    }
  }

  // Un par de bajas durante el año: el liceo real las tiene y las pantallas las distinguen.
  const vigentes = await db.studentEnrollment.findMany({
    where: { schoolYearId: schoolYear.id, enrollmentStatus: 'ACTIVE' },
    select: { id: true },
    orderBy: { id: 'asc' },
  })
  for (const matriculaVigente of vigentes) {
    if (ratio(`baja-${matriculaVigente.id}`) >= 0.025) continue
    const mesDeBaja = intBetween(`mes-baja-${matriculaVigente.id}`, 4, Math.max(4, Number(hasta.slice(5, 7)) - 1))
    await db.studentEnrollment.update({
      where: { id: matriculaVigente.id },
      data: {
        enrollmentStatus: 'WITHDRAWN',
        withdrawnAt: wall(`${ciclo}-${String(mesDeBaja).padStart(2, '0')}-${String(intBetween(`dia-baja-${matriculaVigente.id}`, 3, 26)).padStart(2, '0')}`, 12, 0),
        withdrawalAcademicYear: ciclo,
        notes: 'Retiro administrativo con seguimiento.',
      },
    })
  }

  const matriculasVigentes = await db.studentEnrollment.count({
    where: { schoolYearId: schoolYear.id, enrollmentStatus: 'ACTIVE' },
  })
  console.log(
    `[en-curso] Matrícula: ${promovidos} promovidos, ${repetidores} recursando, ${ingresos} ingresos nuevos, ` +
      `${egresados} egresados del ciclo anterior. Vigentes: ${matriculasVigentes}.`,
  )
  return { promovidos, repetidores, egresados, ingresos, matriculasVigentes }
}

// ============================================================================ limpieza

/**
 * Borra lo operativo del ciclo para poder volver a sembrarlo. Acotado por `schoolYearId`: los
 * ciclos cerrados y sus libretas no se tocan.
 */
async function limpiarOperativo(db: PrismaClient, schoolYearId: string, desde: string, fin: string) {
  console.log('[en-curso] Limpiando lo operativo del ciclo...')
  await db.attendanceJustification.deleteMany({ where: { attendance: { schoolYearId } } })
  await db.attendanceIncident.deleteMany({ where: { attendance: { schoolYearId } } })
  // Punches del ciclo: los que cuelgan de una marca y los que llegaron sueltos en la ventana.
  await db.biometricPunch.deleteMany({
    where: {
      OR: [
        { attendance: { schoolYearId } },
        { occurredAt: { gte: ymdToDate(desde), lte: ymdToDate(fin) } },
      ],
    },
  })
  await db.attendance.deleteMany({ where: { schoolYearId } })
  await db.substitution.deleteMany({ where: { event: { schoolYearId } } })
  await db.medicalLeave.deleteMany({ where: { startDate: { gte: ymdToDate(desde), lte: ymdToDate(fin) } } })
  await db.studentAttendanceSession.deleteMany({ where: { schoolYearId } })
  // Las excepciones de ocurrencia apuntan a su serie; sin desenlazarlas el borrado cae en cascada
  // en un orden que depende del motor.
  await db.event.updateMany({ where: { schoolYearId }, data: { parentEventId: null } })
  await db.event.deleteMany({ where: { schoolYearId } })
}

// ============================================================================ horario

async function sembrarHorario(p: {
  db: PrismaClient
  schoolYear: { id: string; code: number }
  desde: string
  fin: string
  docentes: User[]
  admin: User
  staff: User[]
  ofertasDelCiclo: Array<{
    id: string
    courseId: string
    isOffered: boolean
    course: { code: string | null; name: string; level: string | null; sortOrder: number }
  }>
  orientacionesPorCurso: Map<string, Array<{ id: string; orientationId: string; orientation: { code: string | null; name: string } }>>
}) {
  const { db, schoolYear, desde, fin, docentes, admin, staff, ofertasDelCiclo, orientacionesPorCurso } = p
  const planificador = crearPlanificadorDeHorario(docentes)
  const docentePorUsername = new Map(docentes.filter((d) => d.username).map((d) => [d.username as string, d.id]))

  // El horario sale del plan del propio ciclo: es lo que la institución declaró que se dicta.
  const plan = await db.subjectCourseAssignment.findMany({
    where: { schoolYearId: schoolYear.id, isActive: true, isOffered: true, courseId: { not: null } },
    orderBy: { sortOrder: 'asc' },
    select: { subjectId: true, courseId: true, orientationId: true, subject: { select: { name: true } } },
  })

  let creados = 0
  const sinDocente: string[] = []
  const sinFranja: string[] = []

  for (const oferta of ofertasDelCiclo) {
    if (!oferta.isOffered) continue
    const delCurso = plan.filter((row) => row.courseId === oferta.courseId)
    const orientaciones = orientacionesPorCurso.get(oferta.courseId) ?? []

    // Tronco común (sin orientación) y, aparte, las asignaturas propias de cada orientación.
    const grupos: Array<{ clave: string; orientacion: (typeof orientaciones)[number] | null; asignaturas: typeof delCurso }> = [
      { clave: 'GENERAL', orientacion: null, asignaturas: delCurso.filter((row) => !row.orientationId) },
      ...orientaciones.map((orientacion) => ({
        clave: orientacion.id,
        orientacion,
        asignaturas: delCurso.filter((row) => row.orientationId === orientacion.orientationId),
      })),
    ]

    for (const grupo of grupos) {
      for (const [indice, asignatura] of grupo.asignaturas.entries()) {
        const nombre = asignatura.subject.name
        const franja = planificador.reservarFranja({
          grupo: `${oferta.id}:${grupo.clave}`,
          ordenCurso: oferta.course.sortOrder,
          indiceAsignatura: indice,
        })
        if (!franja) {
          sinFranja.push(`${oferta.course.code} · ${nombre}`)
          continue
        }
        const fijo = docentePorUsername.get(DESIGNACIONES_FIJAS[`${oferta.course.code}|${nombre}`] ?? '')
        const docente = planificador.elegirDocente({ asignatura: nombre, dias: franja.dias, franja: franja.franja, fijo })
        if (!docente) {
          sinDocente.push(`${oferta.course.code} · ${nombre}`)
          continue
        }
        const slot = CLASS_SLOTS[franja.franja]
        const etiqueta = grupo.orientacion ? ` - ${grupo.orientacion.orientation.name}` : ''
        await db.event.create({
          data: {
            title: `${nombre} - ${oferta.course.name}${etiqueta} Grupo A`,
            description: `Clase recurrente de ${nombre} para ${oferta.course.name}.`,
            type: 'CLASE',
            // El ciclo está en curso: las clases siguen agendadas, no completadas.
            status: 'SCHEDULED',
            startDate: ymdToDate(desde),
            endDate: ymdToDate(fin),
            startTime: wall(desde, slot.start[0], slot.start[1]),
            endTime: wall(desde, slot.end[0], slot.end[1]),
            location: `Aula ${oferta.course.sortOrder}${String(franja.franja + 1).padStart(2, '0')}`,
            userId: admin.id,
            assignedUserId: docente.id,
            schoolYearId: schoolYear.id,
            courseOfferingId: oferta.id,
            orientationId: grupo.orientacion?.orientationId ?? null,
            courseOrientationId: grupo.orientacion?.id ?? null,
            subjectId: asignatura.subjectId,
            recurrenceType: 'WEEKLY',
            recurrenceEnd: ymdToDate(fin),
            isRecurring: true,
            daysOfWeek: franja.dias,
          },
        })
        creados += 1
      }
    }
  }

  await db.event.create({
    data: {
      title: `Coordinación docente semanal ${schoolYear.code}`,
      description: 'Espacio de coordinación pedagógica y seguimiento de grupos.',
      type: 'REUNION',
      status: 'SCHEDULED',
      startDate: ymdToDate(desde),
      endDate: ymdToDate(fin),
      startTime: wall(desde, 14, 0),
      endTime: wall(desde, 15, 30),
      location: 'Sala docente',
      userId: admin.id,
      assignedUserId: docentes[0].id,
      schoolYearId: schoolYear.id,
      recurrenceType: 'WEEKLY',
      recurrenceEnd: ymdToDate(fin),
      isRecurring: true,
      daysOfWeek: [3],
    },
  })

  for (const funcionario of staff) {
    await db.event.create({
      data: {
        title: `Jornada laboral - ${funcionario.name ?? funcionario.username ?? funcionario.email}`,
        description: 'Turno administrativo de lunes a viernes, 08:00 a 16:00.',
        type: 'JORNADA_LABORAL',
        status: 'SCHEDULED',
        startDate: ymdToDate(desde),
        endDate: ymdToDate(fin),
        startTime: wall(desde, 8, 0),
        endTime: wall(desde, 16, 0),
        location: 'Administración',
        userId: admin.id,
        assignedUserId: funcionario.id,
        schoolYearId: schoolYear.id,
        recurrenceType: 'DAILY',
        recurrenceEnd: ymdToDate(fin),
        isRecurring: true,
        daysOfWeek: [1, 2, 3, 4, 5],
      },
    })
  }

  const total = creados + 1 + staff.length
  console.log(`[en-curso] Eventos recurrentes creados: ${total} (${creados} clases).`)
  if (sinFranja.length > 0) console.warn(`[en-curso] Sin franja libre (quedaron fuera del horario): ${sinFranja.join(', ')}`)
  if (sinDocente.length > 0) console.warn(`[en-curso] Sin docente compatible libre: ${sinDocente.join(', ')}`)
  return total
}

// ============================================================================ licencias y lector

async function sembrarLicencias(db: PrismaClient, docentes: User[], ciclo: number, desde: string, hasta: string) {
  // Una licencia por mes cursado, repartidas entre docentes distintos.
  const mesHasta = Number(hasta.slice(5, 7))
  const mesDesde = Number(desde.slice(5, 7))
  let creadas = 0
  for (let mes = mesDesde + 1; mes <= mesHasta; mes += 2) {
    const docente = docentes[(mes + ciclo) % docentes.length]
    const inicio = `${ciclo}-${String(mes).padStart(2, '0')}-${String(intBetween(`lic-${ciclo}-${mes}`, 4, 20)).padStart(2, '0')}`
    const dias = intBetween(`lic-dias-${ciclo}-${mes}`, 2, 5)
    const finLicencia = DateTime.fromISO(inicio, { zone: getAppTimezone() }).plus({ days: dias }).toFormat('yyyy-MM-dd')
    if (inicio > hasta) continue
    await db.medicalLeave.create({
      data: {
        userId: docente.id,
        type: 'MEDICAL_LEAVE',
        // `ACTIVE` dice que la licencia es válida, no que esté corriendo hoy: una licencia de mayo
        // sigue siendo la que justifica esas ausencias. `INACTIVE` es la que alguien dio de baja.
        status: 'ACTIVE',
        startDate: ymdToDate(inicio),
        endDate: ymdToDate(finLicencia),
        reason: 'Licencia médica presentada',
        approvedAt: wall(inicio, 15, 30),
        notes: 'Licencia de demo; no almacena certificado ni diagnóstico.',
      },
    })
    creadas += 1
  }
  console.log(`[en-curso] Licencias médicas: ${creadas}.`)
  return creadas
}

/** Reusa el lector ya configurado y completa los mapeos que falten; nunca crea un segundo lector. */
async function asegurarLectorBiometrico(db: PrismaClient, usuarios: Array<Pick<User, 'id'>>) {
  const device =
    (await db.biometricDevice.findFirst({ where: { isActive: true }, select: { id: true } })) ??
    (await db.biometricDevice.create({
      data: {
        code: process.env.BIOMETRIC_DEVICE_CODE || 'F22-TEST-01',
        admsSerial: process.env.BIOMETRIC_ADMS_SERIAL || 'SRN5260500102',
        name: process.env.BIOMETRIC_DEVICE_NAME || 'ZKTeco F22 Testing',
        // El secreto real vive en el .env del server; acá sólo un placeholder de demo.
        secretHash: process.env.BIOMETRIC_DEVICE_SECRET ?? 'demo',
        isActive: true,
        allowedIps: [],
      },
      select: { id: true },
    }))

  const existentes = await db.biometricUserMapping.findMany({
    where: { deviceId: device.id },
    select: { id: true, userId: true, deviceUserId: true },
  })
  const mappings = new Map(existentes.map((row) => [row.userId, { id: row.id, deviceUserId: row.deviceUserId }]))
  let siguiente = existentes.reduce((max, row) => Math.max(max, Number(row.deviceUserId) || 0), 2000) + 1
  for (const usuario of usuarios) {
    if (mappings.has(usuario.id)) continue
    const mapping = await db.biometricUserMapping.create({
      data: { deviceId: device.id, userId: usuario.id, deviceUserId: String(siguiente), isActive: true },
      select: { id: true, deviceUserId: true },
    })
    mappings.set(usuario.id, { id: mapping.id, deviceUserId: mapping.deviceUserId })
    siguiente += 1
  }
  return { device, mappings }
}

// ============================================================================ cuotas y auditoría

async function sembrarCuotas(db: PrismaClient, schoolYearId: string, ciclo: number, hasta: string) {
  const matriculas = await db.studentEnrollment.findMany({
    where: { schoolYearId, enrollmentStatus: { in: ['ACTIVE', 'WITHDRAWN'] } },
    select: { studentId: true, withdrawnAt: true },
  })
  const mesCorte = Number(hasta.slice(5, 7))
  let filas = 0
  for (const matricula of matriculas) {
    const anualPaga = ratio(`anual-${ciclo}-${matricula.studentId}`) > 0.14
    await db.studentTuitionYear.upsert({
      where: { studentId_year: { studentId: matricula.studentId, year: ciclo } },
      create: {
        studentId: matricula.studentId,
        schoolYearId,
        year: ciclo,
        paid: anualPaga,
        paidAt: anualPaga ? wall(`${ciclo}-03-${String(intBetween(`anual-dia-${matricula.studentId}`, 5, 25)).padStart(2, '0')}`, 11, 0) : null,
        amountCents: 325000,
        notes: anualPaga ? 'Cuota anual regularizada.' : 'Saldo anual pendiente o plan de pago.',
      },
      update: {},
    })
    filas += 1

    const mesDeBaja = matricula.withdrawnAt ? Number(toYmd(matricula.withdrawnAt).slice(5, 7)) : null
    for (let mes = 3; mes <= mesCorte; mes += 1) {
      const seFue = mesDeBaja !== null && mes > mesDeBaja
      // El mes corriente recién arrancó: se cobra más adelante.
      const paga = !seFue && mes < mesCorte && ratio(`mes-${ciclo}-${matricula.studentId}-${mes}`) > 0.16
      await db.studentTuitionMonth.upsert({
        where: { studentId_year_month: { studentId: matricula.studentId, year: ciclo, month: mes } },
        create: {
          studentId: matricula.studentId,
          schoolYearId,
          year: ciclo,
          month: mes,
          paid: paga,
          paidAt: paga ? wall(`${ciclo}-${String(mes).padStart(2, '0')}-${String(intBetween(`pago-${matricula.studentId}-${mes}`, 4, 24)).padStart(2, '0')}`, 13, mes % 50) : null,
          amountCents: 145000,
          notes: seFue ? 'Sin obligación: matrícula dada de baja.' : paga ? 'Pago mensual acreditado.' : 'Pendiente o bonificación en revisión.',
        },
        update: {},
      })
      filas += 1
    }
  }
  console.log(`[en-curso] Cuotas cargadas (anual + meses hasta ${mesCorte}): ${filas} filas.`)
  return filas
}

async function sembrarAuditoria(db: PrismaClient, adminId: string, ciclo: number) {
  const recientes = await db.event.findMany({
    where: { schoolYear: { code: ciclo } },
    orderBy: { createdAt: 'desc' },
    take: 8,
    select: { id: true, title: true, createdAt: true },
  })
  for (const evento of recientes) {
    await db.auditLog.create({
      data: {
        occurredAt: evento.createdAt,
        action: 'EVENT_CREATED',
        actorUserId: adminId,
        actorIp: '10.10.0.12',
        userAgent: `EduTrack seed demo ${ciclo}`,
        source: 'SEED',
        entityType: 'Event',
        entityId: evento.id,
        metadata: { title: evento.title, dataset: `demo-en-curso-${ciclo}` },
      },
    })
  }
}
