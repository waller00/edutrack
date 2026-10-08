import { prisma } from '../../db/prisma.js'
import { loadAbsenceTotals } from '../student-attendance/absence-totals.js'
import { describeCell, gradeBooksForGroup } from './institutional.js'
import { officialPeriodValue } from './period-closure.js'
import { conductLabel, conductScale, periodScaleFor } from './period-scale.js'
import { buildReportCard, type ReportCard, type ReportCardSubject } from './report-card.js'

/**
 * Boletines de un grupo en un período: el de un estudiante o los de todos.
 *
 * Los dos caminos arman el boletín igual —mismas asignaturas, misma nota oficial (R), misma
 * conducta y faltas—; cambia sólo a quiénes se incluye. El grupo es explícito y los estudiantes
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
  documentId: string | null
  birthDate: Date | null
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
    include: { subject: { select: { name: true, sortOrder: true } }, teacher: { select: { name: true } } },
  })
  return gradeBooksForGroup(books, group).sort(
    (a, b) => (a.subject?.sortOrder ?? 0) - (b.subject?.sortOrder ?? 0) || (a.subject?.name ?? '').localeCompare(b.subject?.name ?? '', 'es'),
  )
}

export async function loadReportCards(params: {
  group: ReportCardGroup
  period: { id: string; name: string }
  students: readonly ReportCardStudent[]
}): Promise<{ cards: ReportCard[]; decimals: number }> {
  const { group, period, students } = params
  const [header, books] = await Promise.all([loadGroupHeader(group), loadGroupBooks(group)])
  const ids = students.map((s) => s.id)

  const [states, scale, conduct, conductRecords, absences] = await Promise.all([
    prisma.gradeBookPeriod.findMany({
      where: { periodId: period.id, gradeBookId: { in: books.map((b) => b.id) } },
      include: { grades: { where: { studentId: { in: ids } } } },
    }),
    periodScaleFor(header.level),
    conductScale(),
    prisma.studentConductRecord.findMany({
      where: { periodId: period.id, studentId: { in: ids } },
      select: { studentId: true, valueHundredths: true },
    }),
    loadAbsenceTotals(ids, group.schoolYearId, header.level),
  ])

  const levels = scale?.levels ?? []
  const conductLevels = conduct?.levels ?? []
  const stateByBook = new Map(states.map((state) => [state.gradeBookId, state]))
  const conductByStudent = new Map(conductRecords.map((row) => [row.studentId, row.valueHundredths]))

  const subjectsFor = (studentId: string): ReportCardSubject[] =>
    books.map((book) => {
      const grade = stateByBook.get(book.id)?.grades.find((g) => g.studentId === studentId)
      // Al boletín va siempre R: sin reunión, la materia figura pendiente.
      const value = officialPeriodValue(grade)
      return {
        subjectName: book.subject?.name ?? '—',
        teacherName: book.teacher?.name ?? null,
        valueHundredths: value,
        descriptor: describeCell(value, levels as never)?.label ?? null,
        conceptualJudgement: grade?.conceptualJudgement ?? null,
        conductValueHundredths: grade?.conductValueHundredths ?? null,
        conductLabel: conductLabel(grade?.conductValueHundredths, conductLevels),
      }
    })

  const cards = students.map((student) => {
    const institutionalConduct = conductByStudent.get(student.id) ?? null
    const attendance = absences.get(student.id)
    return buildReportCard({
      student: {
        firstName: student.firstName,
        lastName: student.lastName,
        documentId: student.documentId,
        birthDate: student.birthDate,
      },
      group: { courseName: header.courseName, orientationName: header.orientationName, schoolYearLabel: header.schoolYearLabel },
      period: { name: period.name },
      subjects: subjectsFor(student.id),
      conductValueHundredths: institutionalConduct,
      conductLabel: conductLabel(institutionalConduct, conductLevels),
      attendance: { absenceHundredths: attendance?.absenceHundredths ?? 0, justifiedCount: attendance?.justified ?? 0 },
    })
  })

  return { cards, decimals: scale?.decimals ?? 1 }
}
