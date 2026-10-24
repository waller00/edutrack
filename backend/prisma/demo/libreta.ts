/**
 * Parte de los datasets de demo que corresponde a la **libreta digital** y al **pase de lista**.
 *
 * El seed de demo nació antes de la libreta: dejaba el ciclo con horario, asistencia del personal,
 * licencias y suplencias, pero sin una sola nota. En una demo eso se nota: las pantallas del módulo
 * que más cambió quedan vacías.
 *
 * Esto agrega, sobre lo que ya creó el seed:
 *  - la parametrización académica del ciclo (períodos de la planilla, escalas, tipos de actividad);
 *  - una libreta por asignatura y grupo, derivada de los eventos de clase;
 *  - evaluaciones con sus notas sueltas en cada tramo ya empezado;
 *  - C, R y juicio en cada reunión de boletín ya cerrada, con el período cerrado;
 *  - pase de lista en días reales de clase, con presentes, tardes y faltas.
 *
 * **`hasta` es la fecha de corte** y es lo que distingue un ciclo cerrado de uno en curso. Con
 * `null` se carga el ciclo completo (el 2025 de la demo, que ya terminó). Con una fecha, la libreta
 * queda como la de un liceo ese día: los boletines que ya pasaron cerrados, el tramo en curso con
 * sus evaluaciones cargadas, y nada escrito en el futuro.
 *
 * Es determinista: la misma semilla produce siempre los mismos números, así la demo se puede
 * repetir y los totales que se muestran en pantalla no cambian de una corrida a otra.
 */
import type { PrismaClient } from '@prisma/client'
import { uruguayWallToUtc } from '../../src/config/app-timezone.js'
import { provisionGradeBooks } from '../../src/services/gradebook/provision.js'
import { acceptsAssessments, assessmentPeriodsFor, isReportCardPeriod } from '../../src/services/gradebook/period-closure.js'
import { loadRosterForScope } from '../../src/services/student-attendance/roster.js'
import { seedAcademicConfig } from '../seed-academic-config.js'
import { toYmd } from './comun.js'

/** Generador determinista (LCG). Sin esto, cada corrida mostraría otros promedios. */
function makeRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

type Rand = () => number

const pick = <T>(rand: Rand, values: readonly T[]): T => values[Math.floor(rand() * values.length)]!

/**
 * Nota en centésimos, cargada hacia el aprobado: una demo con media clase en rojo no se parece a
 * un liceo real. `max` es el tope de la escala del nivel (10 en EBI, 12 en EMS).
 */
function gradeHundredths(rand: Rand, max: number): number {
  const roll = rand()
  if (roll < 0.08) return (2 + Math.floor(rand() * 3)) * 100
  if (roll < 0.22) return 5 * 100
  if (roll < 0.65) return (6 + Math.floor(rand() * 2)) * 100
  return Math.min(max, 8 + Math.floor(rand() * 3)) * 100
}

const JUICIOS = [
  'Sostiene el trabajo en clase y entrega en fecha.',
  'Participa y consulta; necesita afianzar la parte escrita.',
  'Mejoró en el último tramo: se nota el estudio sostenido.',
  'Irregular con las entregas; cuando trabaja, los resultados acompañan.',
  'Buen nivel de comprensión; falta prolijidad en la presentación.',
] as const

/** Juicios de un período que todavía no cerró: describen cómo viene, no cómo cerró. */
const JUICIOS_EN_CURSO = [
  'Viene sosteniendo el trabajo; falta la última entrega del tramo.',
  'Mejoró respecto del período anterior.',
  'Irregular en la asistencia; cuando viene, trabaja bien.',
] as const

const CONDUCTA = [300, 300, 400, 400, 200] as const

type Periodo = {
  id: string
  code: string
  name: string
  kind: 'DIAGNOSTICO' | 'TRAMO' | 'ENTREGA'
  sortOrder: number
  isMeeting: boolean
  requiresGeneralGrade: boolean
  requiresConceptualJudgement: boolean
  startsOn: Date | null
  endsOn: Date | null
  closesOn: Date | null
}

type Libreta = {
  id: string
  teacherUserId: string | null
  courseOfferingId: string
  orientationId: string | null
  courseOrientationId: string | null
  schoolYearId: string
  subjectId: string
  level: 'EBI' | 'EMS'
}

type Alumno = { studentId: string; studentEnrollmentId: string; firstName: string; lastName: string; documentId: string | null }

/** Día en que el período deja de admitir cambios: el cierre de la planilla, o su fin. */
function cierreDe(periodo: Periodo): Date | null {
  return periodo.closesOn ?? periodo.endsOn
}

/**
 * Cuántas evaluaciones lleva un tramo: dos en un bimestre, tres o cuatro en un semestre de EMS.
 * Un semestre con dos escritos en marzo no se parece a nada.
 */
function evaluacionesDelTramo(periodo: Periodo): number {
  const dias = diasDelPeriodo(periodo)
  return Math.max(2, Math.min(4, Math.round(dias / 45)))
}

function diasDelPeriodo(periodo: Periodo): number {
  const start = periodo.startsOn
  const end = periodo.endsOn
  if (!start || !end) return 60
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000))
}

/** Fechas de las evaluaciones de un tramo, repartidas dentro de su ventana. */
function fechasDeEvaluacion(periodo: Periodo, cuantas: number): Date[] {
  const start = periodo.startsOn ?? new Date(Date.UTC(2025, 2, 10, 12))
  const span = diasDelPeriodo(periodo)
  return Array.from({ length: cuantas }, (_, i) => {
    const dia = Math.min(span - 1, Math.round((span * (i + 1)) / (cuantas + 1)))
    return new Date(start.getTime() + dia * 86_400_000)
  })
}

async function seedAssessments(params: {
  db: PrismaClient
  libreta: Libreta
  tramos: Periodo[]
  roster: Alumno[]
  scaleId: string
  maxValue: number
  activityTypeIds: string[]
  rand: Rand
  hasta: Date | null
}) {
  const { db, libreta, tramos, roster, scaleId, maxValue, activityTypeIds, rand, hasta } = params
  let evaluaciones = 0
  let notas = 0
  for (const tramo of tramos) {
    const fechas = fechasDeEvaluacion(tramo, evaluacionesDelTramo(tramo))
    for (const [i, date] of fechas.entries()) {
      // Nada escrito en el futuro: en el tramo en curso sólo están las evaluaciones ya tomadas.
      if (hasta && date > hasta) continue
      const assessment = await db.assessment.create({
        data: {
          gradeBookId: libreta.id,
          periodId: tramo.id,
          date,
          title: i % 2 === 0 ? `Escrito — ${tramo.name}` : `Oral — ${tramo.name}`,
          activityTypeId: activityTypeIds[i % activityTypeIds.length] ?? null,
          gradingScaleId: scaleId,
          createdByUserId: libreta.teacherUserId,
        },
        select: { id: true },
      })
      await db.assessmentGrade.createMany({
        data: roster.map((alumno) => ({
          assessmentId: assessment.id,
          studentId: alumno.studentId,
          studentEnrollmentId: alumno.studentEnrollmentId,
          studentLastName: alumno.lastName,
          studentFirstName: alumno.firstName,
          studentDocumentId: alumno.documentId,
          valueHundredths: gradeHundredths(rand, maxValue),
          gradedByUserId: libreta.teacherUserId,
        })),
      })
      evaluaciones += 1
      notas += roster.length
    }
  }
  return { evaluaciones, notas }
}

/**
 * C, R y juicio de cada reunión de boletín ya pasada, con el período cerrado.
 *
 * R sale de C con una corrección chica: es lo que pasa en la reunión, donde el colectivo ajusta
 * algún caso. La nota oficial del período es R (`officialPeriodValue`), así que sin ella el
 * boletín y la matriz saldrían vacíos.
 */
async function seedClosures(params: {
  db: PrismaClient
  libreta: Libreta
  reuniones: Periodo[]
  roster: Alumno[]
  maxValue: number
  rand: Rand
}) {
  const { db, libreta, reuniones, roster, maxValue, rand } = params
  let cierres = 0
  for (const reunion of reuniones) {
    const state = await db.gradeBookPeriod.create({
      data: {
        gradeBookId: libreta.id,
        periodId: reunion.id,
        status: 'CLOSED',
        closedByUserId: libreta.teacherUserId,
        closedAt: cierreDe(reunion) ?? new Date(Date.UTC(2025, 11, 1, 12)),
      },
      select: { id: true },
    })
    await db.periodGrade.createMany({
      data: roster.map((alumno) => {
        const c = gradeHundredths(rand, maxValue)
        const ajuste = rand() < 0.15 ? 100 : 0
        return {
          gradeBookPeriodId: state.id,
          studentId: alumno.studentId,
          studentLastName: alumno.lastName,
          studentFirstName: alumno.firstName,
          studentDocumentId: alumno.documentId,
          valueHundredths: c,
          meetingValueHundredths: Math.min(maxValue * 100, c + ajuste),
          conceptualJudgement: pick(rand, JUICIOS),
          conductValueHundredths: pick(rand, CONDUCTA),
          updatedByUserId: libreta.teacherUserId,
        }
      }),
    })
    cierres += roster.length
  }
  return cierres
}

/**
 * La reunión que todavía no pasó: el docente ya puso C a buena parte del grupo, pero R no existe
 * (la pone la reunión) y el período sigue abierto. Es el estado en el que el docente entra a
 * trabajar, y el que deja ver que la libreta está viva.
 */
async function seedPeriodoEnCurso(params: {
  db: PrismaClient
  libreta: Libreta
  reunion: Periodo
  roster: Alumno[]
  maxValue: number
  rand: Rand
}) {
  const { db, libreta, reunion, roster, maxValue, rand } = params
  const state = await db.gradeBookPeriod.create({
    data: { gradeBookId: libreta.id, periodId: reunion.id, status: 'OPEN' },
    select: { id: true },
  })
  // Sólo parte del grupo tiene C: el resto es lo que al docente le falta cargar.
  const conNota = roster.filter(() => rand() < 0.7)
  if (conNota.length === 0) return 0
  await db.periodGrade.createMany({
    data: conNota.map((alumno) => ({
      gradeBookPeriodId: state.id,
      studentId: alumno.studentId,
      studentLastName: alumno.lastName,
      studentFirstName: alumno.firstName,
      studentDocumentId: alumno.documentId,
      valueHundredths: gradeHundredths(rand, maxValue),
      meetingValueHundredths: null,
      conceptualJudgement: rand() < 0.5 ? pick(rand, JUICIOS_EN_CURSO) : null,
      conductValueHundredths: pick(rand, CONDUCTA),
      updatedByUserId: libreta.teacherUserId,
    })),
  })
  return conNota.length
}

/** Semanas recientes en las que el pase de lista está completo, no muestreado. */
const SEMANAS_AL_DIA = 6

/**
 * Días de clase reales de un evento con lista pasada.
 *
 * Dos tramos, porque un liceo tampoco tiene el año entero cargado parejo:
 *  - las últimas `SEMANAS_AL_DIA` semanas hasta la fecha de corte van **completas**, que es lo que
 *    hace que la pantalla de listas sin pasar muestre un puñado y no el ciclo entero;
 *  - antes de eso, `cuantas` listas repartidas, para que las faltas del año no queden todas en
 *    marzo ni haya que escribir cuarenta mil marcas.
 */
function diasDeClase(
  event: { startDate: Date | null; endDate: Date | null; daysOfWeek: number[] },
  cuantas: number,
  hasta: Date | null,
  bloqueados: Set<string>,
): string[] {
  const start = event.startDate ?? new Date(Date.UTC(2025, 2, 3, 12))
  const finEvento = event.endDate ?? new Date(Date.UTC(2025, 11, 5, 12))
  const end = hasta && hasta < finEvento ? hasta : finEvento
  const dias = new Set(event.daysOfWeek.length > 0 ? event.daysOfWeek : [1])
  const desdeCompletas = hasta ? new Date(hasta.getTime() - SEMANAS_AL_DIA * 7 * 86_400_000) : null

  const candidatos: string[] = []
  const completas: string[] = []
  const cursor = new Date(start.getTime())
  while (cursor <= end) {
    if (dias.has(cursor.getUTCDay())) {
      const ymd = cursor.toISOString().slice(0, 10)
      if (!bloqueados.has(ymd)) {
        if (desdeCompletas && cursor >= desdeCompletas) completas.push(ymd)
        else candidatos.push(ymd)
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  return [...muestra(candidatos, cuantas), ...completas]
}

/** `cuantas` fechas repartidas de la primera a la última; si hay menos, todas. */
function muestra(candidatos: string[], cuantas: number): string[] {
  if (candidatos.length <= cuantas) return candidatos
  if (cuantas <= 1) return candidatos.slice(-1)
  const paso = (candidatos.length - 1) / (cuantas - 1)
  return Array.from({ length: cuantas }, (_, i) => candidatos[Math.round(i * paso)])
}

async function seedRollCall(params: {
  db: PrismaClient
  libreta: Libreta
  roster: Alumno[]
  rand: Rand
  clasesPorLibreta: number
  eventosUsados: Set<string>
  hasta: Date | null
  bloqueados: Set<string>
}) {
  const { db, libreta, roster, rand, clasesPorLibreta, eventosUsados, hasta, bloqueados } = params
  // La clase se busca por el scope completo: dos libretas de la misma asignatura en orientaciones
  // distintas son dos clases distintas, y una sesión de pase de lista es única por
  // (evento, día). Sin la orientación, las dos libretas tomarían el mismo evento.
  //
  // La precedencia es la de `resolveMoodleAcademicScope`: con `courseOrientationId` la libreta
  // guarda `orientationId` en null aunque el evento lo tenga cargado, así que filtrar por los dos
  // campos a la vez no encontraría nunca la clase de una orientación.
  const porOrientacion = libreta.courseOrientationId
    ? { courseOrientationId: libreta.courseOrientationId }
    : { courseOrientationId: null, orientationId: libreta.orientationId }
  const event = await db.event.findFirst({
    where: {
      schoolYearId: libreta.schoolYearId,
      courseOfferingId: libreta.courseOfferingId,
      subjectId: libreta.subjectId,
      ...porOrientacion,
      type: 'CLASE',
    },
    select: { id: true, revisionOf: true, startDate: true, endDate: true, daysOfWeek: true, startTime: true, endTime: true },
  })
  if (!event || eventosUsados.has(event.id)) return 0
  eventosUsados.add(event.id)

  let marcas = 0
  for (const ymd of diasDeClase(event, clasesPorLibreta, hasta, bloqueados)) {
    const horaInicio = event.startTime ?? new Date(Date.UTC(2025, 0, 1, 11))
    const horaFin = event.endTime ?? new Date(Date.UTC(2025, 0, 1, 12))
    const session = await db.studentAttendanceSession.create({
      data: {
        eventId: event.id,
        eventFamilyId: event.revisionOf ?? event.id,
        occurrenceYmd: ymd,
        // Mismo instante que escribe `resolveSubstitutionOccurrence`: si difiere, el suplente
        // recibe un 403 silencioso al intentar pasar lista.
        occurrenceDate: uruguayWallToUtc(ymd, 0, 0),
        startAt: uruguayWallToUtc(ymd, horaInicio.getUTCHours(), horaInicio.getUTCMinutes()),
        endAt: uruguayWallToUtc(ymd, horaFin.getUTCHours(), horaFin.getUTCMinutes()),
        schoolYearId: libreta.schoolYearId,
        courseOfferingId: libreta.courseOfferingId,
        orientationId: libreta.orientationId,
        courseOrientationId: libreta.courseOrientationId,
        subjectId: libreta.subjectId,
        status: 'TAKEN',
        source: 'MANUAL',
        takenByUserId: libreta.teacherUserId,
        takenAt: uruguayWallToUtc(ymd, 12, 0),
      },
      select: { id: true },
    })
    await db.studentAttendanceEntry.createMany({
      data: roster.map((alumno) => {
        const roll = rand()
        let status: 'PRESENT' | 'LATE' | 'ABSENT' | 'ABSENT_JUSTIFIED' = 'PRESENT'
        if (roll > 0.94) status = 'ABSENT'
        else if (roll > 0.9) status = 'ABSENT_JUSTIFIED'
        else if (roll > 0.84) status = 'LATE'
        return {
          sessionId: session.id,
          studentId: alumno.studentId,
          studentEnrollmentId: alumno.studentEnrollmentId,
          status,
          studentLastName: alumno.lastName,
          studentFirstName: alumno.firstName,
          studentDocumentId: alumno.documentId,
          markedByUserId: libreta.teacherUserId,
          note: status === 'ABSENT_JUSTIFIED' ? 'Certificado presentado en adscripción.' : null,
        }
      }),
    })
    marcas += roster.length
  }
  return marcas
}

async function loadPeriods(db: PrismaClient, schoolYearId: string, level: 'EBI' | 'EMS'): Promise<Periodo[]> {
  return (await db.academicPeriod.findMany({
    where: { schoolYearId, level, isActive: true },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true, code: true, name: true, kind: true, sortOrder: true, isMeeting: true,
      requiresGeneralGrade: true, requiresConceptualJudgement: true, startsOn: true, endsOn: true,
      closesOn: true,
    },
  })) as Periodo[]
}

export type DemoLibretaSummary = {
  libretas: number
  evaluaciones: number
  notas: number
  cierres: number
  enCurso: number
  marcasDeAsistencia: number
}

/**
 * Deja el ciclo sin datos de libreta antes de recrearlos.
 *
 * El borrado del seed de demo no los toca —las libretas cuelgan del ciclo, que sobrevive—, así que
 * sin esto una segunda corrida duplicaría evaluaciones y cierres.
 */
async function clearLibretaData(db: PrismaClient, schoolYearId: string) {
  const books = await db.gradeBook.findMany({ where: { schoolYearId }, select: { id: true } })
  const ids = books.map((b) => b.id)
  if (ids.length > 0) {
    await db.assessment.deleteMany({ where: { gradeBookId: { in: ids } } })
    await db.gradeBookPeriod.deleteMany({ where: { gradeBookId: { in: ids } } })
  }
  await db.studentAttendanceSession.deleteMany({ where: { schoolYearId } })
}

export async function seedDemoLibreta(
  db: PrismaClient,
  options: {
    schoolYearId: string
    clasesPorLibreta?: number
    /** Fecha de corte. `null` (default) carga el ciclo completo, como un ciclo ya cerrado. */
    hasta?: Date | null
  },
): Promise<DemoLibretaSummary> {
  const { schoolYearId, clasesPorLibreta = 6, hasta = null } = options
  await clearLibretaData(db, schoolYearId)

  // Períodos de la planilla, escalas y tipos de actividad del ciclo.
  await seedAcademicConfig(db)
  // Las libretas se derivan del horario: no hay tabla de asignación docente.
  const provision = await provisionGradeBooks(schoolYearId, db)

  const scales = await db.gradingScale.findMany({
    where: { code: { in: ['NUMERICA_1_10', 'NUMERICA_1_12'] } },
    select: { id: true, code: true, maxValueHundredths: true },
  })
  const types = await db.activityType.findMany({
    where: { scope: 'GLOBAL', code: { in: ['ESCRITO', 'ORAL'] } },
    select: { id: true, code: true },
  })
  const activityTypeIds = ['ESCRITO', 'ORAL']
    .map((code) => types.find((t) => t.code === code)?.id)
    .filter((id): id is string => Boolean(id))

  const books = await db.gradeBook.findMany({
    where: { schoolYearId },
    // Orden estable: la semilla de cada libreta sale de su posición, así dos corridas sobre el
    // mismo ciclo muestran las mismas notas.
    orderBy: { scopeKey: 'asc' },
    select: {
      id: true, teacherUserId: true, courseOfferingId: true, orientationId: true,
      courseOrientationId: true, schoolYearId: true, subjectId: true,
      courseOffering: { select: { course: { select: { level: true } } } },
    },
  })

  const periodosPorNivel = new Map<'EBI' | 'EMS', Periodo[]>([
    ['EBI', await loadPeriods(db, schoolYearId, 'EBI')],
    ['EMS', await loadPeriods(db, schoolYearId, 'EMS')],
  ])

  // El pase de lista de un feriado no existe: la ocurrencia no sería una clase real.
  const bloqueados = new Set((await db.nonWorkingDay.findMany({ select: { date: true } })).map((row) => toYmd(row.date)))

  const summary: DemoLibretaSummary = {
    libretas: provision.created + provision.updated,
    evaluaciones: 0,
    notas: 0,
    cierres: 0,
    enCurso: 0,
    marcasDeAsistencia: 0,
  }

  let semilla = 7
  const eventosUsados = new Set<string>()
  for (const book of books) {
    const level = (book.courseOffering?.course?.level ?? 'EBI') as 'EBI' | 'EMS'
    const libreta: Libreta = { ...book, level }
    const roster = (await loadRosterForScope(
      {
        schoolYearId,
        courseOfferingId: libreta.courseOfferingId,
        orientationId: libreta.orientationId,
        courseOrientationId: libreta.courseOrientationId,
      },
      db,
    )) as Alumno[]
    if (roster.length === 0) continue

    const periodos = periodosPorNivel.get(level) ?? []
    const reuniones = periodos.filter(isReportCardPeriod)
    const yaEmpezo = (p: Periodo) => !hasta || !p.startsOn || p.startsOn <= hasta
    const yaCerro = (p: Periodo) => {
      if (!hasta) return true
      const cierre = cierreDe(p)
      return cierre ? cierre <= hasta : false
    }
    const cerradas = reuniones.filter(yaCerro)
    // Una sola reunión en curso: la primera que empezó y todavía no cerró.
    const enCurso = reuniones.find((reunion) => !yaCerro(reunion) && yaEmpezo(reunion)) ?? null

    // Los tramos cuyas evaluaciones informa la planilla, limitados a los que ya empezaron: en el
    // tramo en curso el docente ya tomó escritos aunque la entrega que los informa no haya llegado.
    const tramosDeLaPlanilla = new Set(reuniones.flatMap((reunion) => assessmentPeriodsFor(reunion, periodos)))
    const tramos = periodos.filter((p) => tramosDeLaPlanilla.has(p.id) && acceptsAssessments(p.kind) && yaEmpezo(p))

    const scale = scales.find((s) => s.code === (level === 'EMS' ? 'NUMERICA_1_12' : 'NUMERICA_1_10'))
    if (!scale || tramos.length === 0) continue
    const maxValue = Math.round((scale.maxValueHundredths ?? 1000) / 100)

    semilla += 101
    const rand = makeRandom(semilla)

    const evaluado = await seedAssessments({
      db, libreta, tramos, roster, scaleId: scale.id, maxValue, activityTypeIds, rand, hasta,
    })
    summary.evaluaciones += evaluado.evaluaciones
    summary.notas += evaluado.notas
    summary.cierres += await seedClosures({ db, libreta, reuniones: cerradas, roster, maxValue, rand })
    if (enCurso) {
      summary.enCurso += await seedPeriodoEnCurso({ db, libreta, reunion: enCurso, roster, maxValue, rand })
    }
    summary.marcasDeAsistencia += await seedRollCall({
      db, libreta, roster, rand, clasesPorLibreta, eventosUsados, hasta, bloqueados,
    })
  }

  return summary
}
