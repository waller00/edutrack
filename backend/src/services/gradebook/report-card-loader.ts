import type { AcademicLevel } from '@prisma/client'
import { prisma } from '../../db/prisma.js'
import { loadAbsenceTotals } from '../student-attendance/absence-totals.js'
import { gradeBooksForGroup } from './institutional.js'
import {
  buildReportCard,
  currentMeetingJudgement,
  reportCardColumnLabel,
  reportCardSubject,
  reportCardWindow,
  type ReportCard,
} from './report-card.js'

/**
 * Boletines de un grupo en un período: el de un estudiante o los de todos.
 *
 * Los dos caminos arman el boletín igual —mismas asignaturas, mismo cierre, mismo juicio de reunión
 * y mismas faltas—; cambia sólo a quiénes se incluye. El grupo es explícito y los estudiantes
 * también: el boletín de un año pasado, o de alguien que ya no está matriculado, no puede salir
 * del roster de hoy.
 */

export type ReportCardGroup = {
  schoolYearId: string
  courseOfferingId: string
  courseOrientationId: string | null
  orientationId: string | null
}

export type ReportCardStudent = {
  id: string
  firstName: string
  lastName: string
}

export type ReportCardPeriod = {
  id: string
  name: string
  level: AcademicLevel
  kind: string
  sortOrder: number
  startsOn: Date | null
  endsOn: Date | null
  judgementLabel: string | null
}

type GroupHeader = { courseName: string; level: string | null; orientationName: string | null; schoolYearLabel: string }

async function loadGroupHeader(group: ReportCardGroup): Promise<GroupHeader> {
  const [offering, courseOrientation, orientation] = await Promise.all([
    prisma.courseOffering.findUnique({
      where: { id: group.courseOfferingId },
      select: { course: { select: { name: true, level: true } }, schoolYear: { select: { label: true } } },
    }),
    group.courseOrientationId
      ? prisma.courseOrientation.findUnique({
          where: { id: group.courseOrientationId },
          select: { orientation: { select: { name: true } } },
        })
      : null,
    !group.courseOrientationId && group.orientationId
      ? prisma.orientation.findUnique({ where: { id: group.orientationId }, select: { name: true } })
      : null,
  ])
  return {
    courseName: offering?.course?.name ?? '',
    level: offering?.course?.level ?? null,
    orientationName: courseOrientation?.orientation?.name ?? orientation?.name ?? null,
    schoolYearLabel: offering?.schoolYear?.label ?? '',
  }
}

/** Las libretas que cursa el grupo —las de su orientación más las de tronco común—, en orden. */
async function loadGroupBooks(group: ReportCardGroup) {
  const books = await prisma.gradeBook.findMany({
    where: { courseOfferingId: group.courseOfferingId },
    include: { subject: { select: { name: true, sortOrder: true } } },
  })
  return gradeBooksForGroup(books, group).sort(
    (a, b) => (a.subject?.sortOrder ?? 0) - (b.subject?.sortOrder ?? 0) || (a.subject?.name ?? '').localeCompare(b.subject?.name ?? '', 'es'),
  )
}

/** Los períodos del nivel, para saber qué tramos (y qué días) informa la reunión. */
async function loadWindow(schoolYearId: string, period: ReportCardPeriod) {
  const periods = await prisma.academicPeriod.findMany({
    where: { schoolYearId, level: period.level, isActive: true },
    select: { id: true, kind: true, sortOrder: true, startsOn: true, endsOn: true },
  })
  return reportCardWindow(period, periods)
}

export async function loadReportCards(params: {
  group: ReportCardGroup
  period: ReportCardPeriod
  students: readonly ReportCardStudent[]
}): Promise<ReportCard[]> {
  const { group, period, students } = params
  const [header, books, window] = await Promise.all([
    loadGroupHeader(group),
    loadGroupBooks(group),
    loadWindow(group.schoolYearId, period),
  ])
  const ids = students.map((s) => s.id)

  const [states, meetings, absences] = await Promise.all([
    prisma.gradeBookPeriod.findMany({
      where: { periodId: period.id, gradeBookId: { in: books.map((b) => b.id) } },
      select: { gradeBookId: true, status: true, grades: { where: { studentId: { in: ids } } } },
    }),
    // Las del alumno y las del grupo (su orientación): sin una propia, vale la del grupo.
    prisma.teacherMeetingRecord.findMany({
      where: {
        courseOfferingId: group.courseOfferingId,
        periodId: period.id,
        OR: [{ studentId: { in: ids } }, { studentId: null, courseOrientationId: group.courseOrientationId }],
      },
      select: { studentId: true, decision: true, createdAt: true },
    }),
    // Acumuladas en el año: el límite del reglamento es por grado (30 fictas), no por período.
    loadAbsenceTotals(ids, group.schoolYearId, header.level, window?.toYmd ?? null),
  ])

  const stateByBook = new Map(states.map((state) => [state.gradeBookId, state]))
  const columnLabel = reportCardColumnLabel(window, period.name)

  return students.map((student) => {
    const attendance = absences.get(student.id)
    return buildReportCard({
      student: { firstName: student.firstName, lastName: student.lastName },
      group: { courseName: header.courseName, orientationName: header.orientationName, schoolYearLabel: header.schoolYearLabel },
      period: { name: period.name, columnLabel, judgementLabel: period.judgementLabel },
      subjects: books.map((book) => reportCardSubject(book.subject?.name ?? '—', stateByBook.get(book.id), student.id)),
      meetingJudgement: currentMeetingJudgement(meetings, student.id),
      attendance: {
        absenceHundredths: attendance?.absenceHundredths ?? 0,
        ...(attendance?.counts ?? { justified: 0, unjustified: 0, lates: 0 }),
        untilYmd: window?.toYmd ?? null,
      },
    })
  })
}
