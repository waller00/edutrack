export type AttendanceStudent = {
  studentId: string
  firstName: string
  lastName: string
  courseName: string
}

export type AbsenceStreak = AttendanceStudent & {
  from: string
  to: string
  days: number
  open: boolean
}
export type AbsenceThreshold = AttendanceStudent & { absenceHundredths: number; threshold: number }
export type AttendancePriority = AttendanceStudent & {
  absenceHundredths: number | null
  streakDays: number
  reasons: string[]
}

export function percentage(value: number, total: number): number | null {
  return total > 0 ? Math.round((value / total) * 1000) / 10 : null
}

export function matchesStudent(student: AttendanceStudent, search: string): boolean {
  const normalize = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
  const text = normalize(`${student.lastName} ${student.firstName} ${student.courseName}`)
  return normalize(search)
    .trim()
    .split(/\s+/)
    .every((word) => text.includes(word))
}

/** Una sola fila por estudiante aunque tenga varias rachas o ambos tipos de alerta. */
export function attendancePriorities(
  streaks: readonly AbsenceStreak[],
  thresholds: readonly AbsenceThreshold[],
): AttendancePriority[] {
  const students = new Map<string, AttendancePriority>()
  for (const row of thresholds) {
    students.set(row.studentId, {
      ...row,
      streakDays: 0,
      reasons: [row.absenceHundredths >= 2500 ? '25 faltas o más' : '18 a menos de 25 faltas'],
    })
  }
  for (const row of streaks.filter((streak) => streak.open)) {
    const current = students.get(row.studentId) ?? {
      ...row,
      absenceHundredths: null,
      streakDays: 0,
      reasons: [],
    }
    current.streakDays = Math.max(current.streakDays, row.days)
    if (!current.reasons.includes('Faltas seguidas activas'))
      current.reasons.push('Faltas seguidas activas')
    students.set(row.studentId, current)
  }
  return [...students.values()].sort(
    (a, b) =>
      b.reasons.length - a.reasons.length ||
      (b.absenceHundredths ?? 0) - (a.absenceHundredths ?? 0) ||
      b.streakDays - a.streakDays ||
      a.lastName.localeCompare(b.lastName, 'es'),
  )
}

/** Series exclusivas para los umbrales; las rachas son otra señal y pueden coincidir. */
export function attendanceByCourse(
  streaks: readonly AbsenceStreak[],
  thresholds: readonly AbsenceThreshold[],
) {
  const courses = [
    ...new Set([...streaks.map((s) => s.courseName), ...thresholds.map((s) => s.courseName)]),
  ]
  return courses
    .map((course) => ({
      course,
      active: new Set(
        streaks.filter((s) => s.courseName === course && s.open).map((s) => s.studentId),
      ).size,
      warning: new Set(
        thresholds
          .filter((s) => s.courseName === course && s.absenceHundredths < 2500)
          .map((s) => s.studentId),
      ).size,
      critical: new Set(
        thresholds
          .filter((s) => s.courseName === course && s.absenceHundredths >= 2500)
          .map((s) => s.studentId),
      ).size,
    }))
    .sort(
      (a, b) =>
        b.active + b.warning + b.critical - (a.active + a.warning + a.critical) ||
        a.course.localeCompare(b.course, 'es'),
    )
}
