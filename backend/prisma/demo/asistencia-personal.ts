/**
 * Asistencia del **personal** (no de los alumnos) para un ciclo de demo: pares entrada + salida,
 * marcas biométricas, ausencias y suplencias, recorriendo las ocurrencias reales de cada evento
 * recurrente del horario.
 *
 * Reglas que el dataset respeta porque el motor de asistencia las da por ciertas:
 *  - quien está presente tiene SU PAR entrada + salida; nunca una marca huérfana;
 *  - la ausencia es **estado derivado**: del lado de la base queda una sola fila de entrada con el
 *    estado que la explica (justificada, no justificada o suplida), sin salida ni punch;
 *  - una licencia médica vigente ese día gana sobre cualquier otra cosa;
 *  - el titular ausente con suplente queda `SUBSTITUTED` y el suplente trae su par completo.
 *
 * El pase de lista estudiantil es otra cosa y vive en `demo/libreta.ts`.
 */
import type { AttendanceStatus, PrismaClient } from '@prisma/client'
import type { User } from '@prisma/client'
import {
  eachYmd,
  intBetween,
  minutesToWall,
  pick,
  ratio,
  teacherCanTeachSubject,
  toYmd,
  wallMinutesFromStoredTime,
  weekday,
  ymdToDate,
} from './comun.js'

export type ResumenAsistencia = {
  presentes: number
  ausencias: number
  punches: number
  suplencias: number
}

type Mapeo = Map<string, { id: string; deviceUserId: string }>

export async function sembrarAsistenciaDelPersonal(params: {
  db: PrismaClient
  schoolYearId: string
  /** Primer día civil con marcas; normalmente el inicio del ciclo. */
  desde: string
  /** Último día civil con marcas: el cierre del ciclo, o hoy si el ciclo está en curso. */
  hasta: string
  docentes: User[]
  device: { id: string }
  mappings: Mapeo
  /** Queda en el `payload` del punch, para poder distinguir de dónde salió la marca. */
  dataset: string
}): Promise<ResumenAsistencia> {
  const { db, schoolYearId, desde, hasta, docentes, device, mappings, dataset } = params

  const events = await db.event.findMany({
    where: { schoolYearId, assignedUserId: { not: null }, isRecurring: true },
    include: { subject: { select: { name: true } } },
  })
  const nonWorkingDays = await db.nonWorkingDay.findMany({ select: { date: true } })
  const blocked = new Set(nonWorkingDays.map((row) => toYmd(row.date)))
  const leaves = await db.medicalLeave.findMany({ where: { status: 'ACTIVE' } })
  const teacherRows = await db.user.findMany({ where: { orgRole: { code: 'TEACHER' } }, select: { id: true } })
  const teacherIds = new Set(teacherRows.map((teacher) => teacher.id))
  const adminId = (await db.user.findFirst({ where: { orgRole: { code: 'ADMIN' } }, select: { id: true } }))?.id

  const resumen: ResumenAsistencia = { presentes: 0, ausencias: 0, punches: 0, suplencias: 0 }

  function hasLeave(userId: string, date: string) {
    const day = ymdToDate(date).getTime()
    return leaves.find(
      (leave) =>
        leave.userId === userId &&
        ymdToDate(toYmd(leave.startDate)).getTime() <= day &&
        ymdToDate(toYmd(leave.endDate)).getTime() >= day,
    )
  }

  async function createPunch(userId: string, attendanceId: string, type: 'CHECK_IN' | 'CHECK_OUT', occurredAt: Date) {
    const mapping = mappings.get(userId)
    if (!mapping) return
    // Evita colision del unico (deviceId, deviceUserId, occurredAt) cuando un docente
    // encadena salida/entrada de clases consecutivas en el mismo minuto.
    const existing = await db.biometricPunch.findFirst({
      where: { deviceId: device.id, deviceUserId: mapping.deviceUserId, occurredAt },
      select: { id: true },
    })
    if (existing) return
    await db.biometricPunch.create({
      data: {
        deviceId: device.id,
        mappingId: mapping.id,
        userId,
        attendanceId,
        externalId: `${mapping.deviceUserId}-${occurredAt.getTime()}-${type}`,
        deviceUserId: mapping.deviceUserId,
        occurredAt,
        receivedAt: new Date(occurredAt.getTime() + intBetween(`recv-${attendanceId}`, 10, 90) * 1000),
        punchType: type,
        processStatus: 'PROCESSED',
        payload: { source: dataset, type, deviceUserId: mapping.deviceUserId },
      },
    })
    resumen.punches += 1
  }

  /** Crea SIEMPRE un par completo entrada + salida para quien esta presente. */
  async function createPresencePair(
    userId: string,
    event: { id: string; schoolYearId: string | null },
    date: string,
    inMinutes: number,
    outMinutes: number,
    inStatus: AttendanceStatus,
    outStatus: AttendanceStatus,
    inNote: string,
    outNote: string,
  ) {
    const inTime = minutesToWall(date, inMinutes)
    const outTime = minutesToWall(date, outMinutes)
    const checkIn = await db.attendance.create({
      data: { userId, eventId: event.id, type: 'CHECK_IN', status: inStatus, date: ymdToDate(date), time: inTime, schoolYearId: event.schoolYearId, notes: inNote },
    })
    const checkOut = await db.attendance.create({
      data: { userId, eventId: event.id, type: 'CHECK_OUT', status: outStatus, date: ymdToDate(date), time: outTime, schoolYearId: event.schoolYearId, notes: outNote },
    })
    resumen.presentes += 2
    await createPunch(userId, checkIn.id, 'CHECK_IN', inTime)
    await createPunch(userId, checkOut.id, 'CHECK_OUT', outTime)
  }

  /** Marca de ausencia: UNA sola fila del lado entrada (sin salida ni punch, porque no vino). */
  async function createAbsenceMark(
    userId: string,
    event: { id: string; schoolYearId: string | null },
    date: string,
    inMinutes: number,
    status: AttendanceStatus,
    note: string,
  ) {
    await db.attendance.create({
      data: { userId, eventId: event.id, type: 'CHECK_IN', status, date: ymdToDate(date), time: minutesToWall(date, inMinutes), schoolYearId: event.schoolYearId, notes: note },
    })
    resumen.ausencias += 1
  }

  for (const event of events) {
    if (!event.assignedUserId || !event.startTime || !event.endTime || !event.recurrenceEnd) continue
    const startMinutes = wallMinutesFromStoredTime(event.startTime)
    const endMinutes = wallMinutesFromStoredTime(event.endTime)
    const days = event.daysOfWeek.length ? event.daysOfWeek : [weekday(toYmd(event.startDate))]
    // La ventana arranca cuando arranca el evento, salvo que el evento sea anterior al ciclo.
    const primerDia = toYmd(event.startDate) > desde ? toYmd(event.startDate) : desde
    if (primerDia > hasta) continue

    for (const date of eachYmd(primerDia, hasta)) {
      if (!days.includes(weekday(date)) || blocked.has(date)) continue
      const userId = event.assignedUserId
      // La clave del sorteo es el scope de la clase, no el id del evento: el dataset borra y
      // recrea los eventos, y con el id las ausencias cambiaban de día en cada corrida.
      const baseKey = `${event.courseOfferingId ?? event.type}-${event.subjectId ?? userId}-${date}`

      // Licencia -> ausencia justificada (fila visible, sin salida).
      if (hasLeave(userId, date)) {
        await createAbsenceMark(userId, event, date, startMinutes, 'ABSENT_JUSTIFIED', 'Ausencia justificada por licencia médica.')
        continue
      }

      // Ausencia docente. Con suplente -> Suplida (titular) + par del suplente; sin suplente -> Ausente.
      if (teacherIds.has(userId) && ratio(`${baseKey}-absent`) < 0.05) {
        const subjectName = event.subject?.name
        const substitute =
          ratio(`${baseKey}-cover`) > 0.5
            ? docentes.find(
                (teacher) =>
                  teacher.id !== userId &&
                  (!subjectName || teacherCanTeachSubject(teacher, subjectName)) &&
                  ratio(`${baseKey}-${teacher.id}-pick`) > 0.7,
              )
            : null
        if (substitute) {
          await db.substitution.create({
            data: {
              eventId: event.id,
              originalTeacherUserId: userId,
              substituteUserId: substitute.id,
              date: ymdToDate(date),
              startTime: minutesToWall(date, startMinutes),
              endTime: minutesToWall(date, endMinutes),
              reason: 'Suplencia por ausencia docente',
              notes: 'Cobertura generada para dataset de demo.',
              createdByUserId: adminId,
            },
          })
          resumen.suplencias += 1
          await createAbsenceMark(userId, event, date, startMinutes, 'SUBSTITUTED', 'Ausencia prevista cubierta por suplente.')
          await createPresencePair(substitute.id, event, date, startMinutes - 4, endMinutes + 2, 'PRESENT', 'EXIT', 'Entrada docente suplente.', 'Salida docente suplente.')
        } else {
          await createAbsenceMark(userId, event, date, startMinutes, 'ABSENT_NOT_JUSTIFIED', 'Inasistencia registrada para seguimiento.')
        }
        continue
      }

      // Presente: par completo entrada + salida (con tardanza / retiro anticipado ocasional).
      const lateMinutes = ratio(`${baseKey}-late`) < 0.11 ? intBetween(`${baseKey}-late-min`, 7, 22) : intBetween(`${baseKey}-early-in`, -8, 4)
      const earlyMinutes = ratio(`${baseKey}-early`) < 0.03 ? intBetween(`${baseKey}-early-min`, 8, 18) : -intBetween(`${baseKey}-late-out`, 0, 7)
      const inStatus: AttendanceStatus = lateMinutes > 5 ? 'LATE' : 'PRESENT'
      const outStatus: AttendanceStatus = earlyMinutes > 5 ? 'EARLY_EXIT' : 'EXIT'
      const inNote = inStatus === 'LATE' ? pick(['Retraso por transporte', 'Ingreso tarde avisado a adscripcion', 'Demora en clase previa'], `${baseKey}-late-note`) : 'Entrada normal.'
      const outNote = outStatus === 'EARLY_EXIT' ? pick(['Retiro por coordinacion', 'Salida autorizada por direccion', 'Traslado a otra actividad'], `${baseKey}-early-note`) : 'Salida normal.'
      await createPresencePair(userId, event, date, startMinutes + lateMinutes, endMinutes - earlyMinutes, inStatus, outStatus, inNote, outNote)
    }
  }

  return resumen
}
