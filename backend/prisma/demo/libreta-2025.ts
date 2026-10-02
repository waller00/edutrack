/**
 * Parte del dataset de demo que corresponde a la **libreta digital** y al **pase de lista**.
 *
 * El seed de demo nació antes de la libreta: dejaba el ciclo 2025 con horario, asistencia del
 * personal, licencias y suplencias, pero sin una sola nota. En una demo que muestra los históricos
 * de 2025 eso se nota: las pantallas del módulo que más cambió quedan vacías.
 *
 * Esto agrega, sobre lo que ya creó el seed:
 *  - la parametrización académica del ciclo (períodos de la planilla, escalas, tipos de actividad);
 *  - una libreta por asignatura y grupo, derivada de los eventos de clase;
 *  - evaluaciones con sus notas sueltas en cada tramo;
 *  - C, R y juicio en cada reunión de boletín, con el período cerrado (2025 es un ciclo cerrado);
 *  - pase de lista en días reales de clase, con presentes, tardes y faltas.
 *
 * Es determinista: la misma semilla produce siempre los mismos números, así la demo se puede
 * repetir y los totales que se muestran en pantalla no cambian de una corrida a otra.
 */
import type { PrismaClient } from '@prisma/client'
import { uruguayWallToUtc } from '../../src/config/app-timezone.js'
import { provisionGradeBooks } from '../../src/services/gradebook/provision.js'
import { assessmentPeriodsFor, isReportCardPeriod } from '../../src/services/gradebook/period-closure.js'
import { loadRosterForScope } from '../../src/services/student-attendance/roster.js'
import { seedAcademicConfig } from '../seed-academic-config.js'

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

/** Día civil dentro de la ventana del período; si no tiene ventana, el medio del ciclo. */
function dateInPeriod(periodo: Periodo, offset: number): Date {
  const start = periodo.startsOn ?? new Date(Date.UTC(2025, 2, 10, 12))
  const end = periodo.endsOn ?? new Date(Date.UTC(2025, 10, 30, 12))
  const span = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000))
  const day = Math.min(span - 1, 5 + offset * 9)
  return new Date(start.getTime() + day * 86_400_000)
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
}) {
  const { db, libreta, tramos, roster, scaleId, maxValue, activityTypeIds, rand } = params
  let notas = 0
  for (const tramo of tramos) {
    for (let i = 0; i < 2; i += 1) {
      const date = dateInPeriod(tramo, i)
      const assessment = await db.assessment.create({
        data: {
          gradeBookId: libreta.id,
          periodId: tramo.id,
          date,
          title: i === 0 ? `Escrito — ${tramo.name}` : `Oral — ${tramo.name}`,
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
      notas += roster.length
    }
  }
  return notas
}

/**
 * C, R y juicio de cada reunión de boletín, con el período cerrado.
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
        closedAt: reunion.endsOn ?? new Date(Date.UTC(2025, 11, 1, 12)),
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

/** Ocurrencias reales de una clase semanal, tomando los días de la semana que dicta. */
function occurrences(event: { startDate: Date | null; endDate: Date | null; daysOfWeek: number[] }, cuantas: number): string[] {
  const start = event.startDate ?? new Date(Date.UTC(2025, 2, 3, 12))
  const end = event.endDate ?? new Date(Date.UTC(2025, 11, 5, 12))
  const dias = new Set(event.daysOfWeek.length > 0 ? event.daysOfWeek : [1])
  const out: string[] = []
  const cursor = new Date(start.getTime())
  // Se recorre el ciclo de a una semana y se toman clases espaciadas, para que las faltas queden
  // repartidas en el año y no todas en marzo.
  let saltos = 0
  while (cursor <= end && out.length < cuantas) {
    if (dias.has(cursor.getUTCDay())) {
      saltos += 1
      if (saltos % 3 === 0) out.push(cursor.toISOString().slice(0, 10))
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

async function seedRollCall(params: {
  db: PrismaClient
  libreta: Libreta
  roster: Alumno[]
  rand: Rand
  clasesPorLibreta: number
  eventosUsados: Set<string>
}) {
  const { db, libreta, roster, rand, clasesPorLibreta, eventosUsados } = params
  // La clase se busca por el scope completo: dos libretas de la misma asignatura en orientaciones
  // distintas son dos clases distintas, y una sesión de pase de lista es única por
  // (evento, día). Sin la orientación, las dos libretas tomarían el mismo evento.
  const event = await db.event.findFirst({
    where: {
      schoolYearId: libreta.schoolYearId,
      courseOfferingId: libreta.courseOfferingId,
      subjectId: libreta.subjectId,
      courseOrientationId: libreta.courseOrientationId,
      orientationId: libreta.orientationId,
      type: 'CLASE',
    },
    select: { id: true, revisionOf: true, startDate: true, endDate: true, daysOfWeek: true, startTime: true, endTime: true },
  })
  if (!event || eventosUsados.has(event.id)) return 0
  eventosUsados.add(event.id)

  let marcas = 0
  for (const ymd of occurrences(event, clasesPorLibreta)) {
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
    },
  })) as Periodo[]
}

export type DemoLibretaSummary = {
  libretas: number
  evaluaciones: number
  notas: number
  cierres: number
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

export async function seedDemoLibreta2025(
  db: PrismaClient,
  options: { schoolYearId: string; clasesPorLibreta?: number },
): Promise<DemoLibretaSummary> {
  const { schoolYearId, clasesPorLibreta = 6 } = options
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

  const summary: DemoLibretaSummary = {
    libretas: provision.created + provision.updated,
    evaluaciones: 0,
    notas: 0,
    cierres: 0,
    marcasDeAsistencia: 0,
  }

  let semilla = 7
  const eventosUsados = new Set<string>()
  for (const book of books) {
    const level = (book.courseOffering?.course?.level ?? 'EBI') as 'EBI' | 'EMS'
    const libreta: Libreta = { ...book, level }
    const roster = (await loadRosterForScope({
      schoolYearId,
      courseOfferingId: libreta.courseOfferingId,
      orientationId: libreta.orientationId,
      courseOrientationId: libreta.courseOrientationId,
    })) as Alumno[]
    if (roster.length === 0) continue

    const periodos = periodosPorNivel.get(level) ?? []
    const reuniones = periodos.filter(isReportCardPeriod)
    const tramosIds = new Set(reuniones.flatMap((r) => assessmentPeriodsFor(r, periodos)))
    const tramos = periodos.filter((p) => tramosIds.has(p.id))
    const scale = scales.find((s) => s.code === (level === 'EMS' ? 'NUMERICA_1_12' : 'NUMERICA_1_10'))
    if (!scale || tramos.length === 0) continue
    const maxValue = Math.round((scale.maxValueHundredths ?? 1000) / 100)

    semilla += 101
    const rand = makeRandom(semilla)

    summary.notas += await seedAssessments({
      db, libreta, tramos, roster, scaleId: scale.id, maxValue, activityTypeIds, rand,
    })
    summary.evaluaciones += tramos.length * 2
    summary.cierres += await seedClosures({ db, libreta, reuniones, roster, maxValue, rand })
    summary.marcasDeAsistencia += await seedRollCall({
      db, libreta, roster, rand, clasesPorLibreta, eventosUsados,
    })
  }

  return summary
}
