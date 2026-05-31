export type SubstitutionRow = {
  id: string
  eventId: string
  originalTeacherUserId: string
  substituteUserId: string
  date: string
  startTime: string
  endTime: string
  reason: string
  notes?: string | null
  event?: {
    id: string
    title: string
    type: string
    status: string
    subject?: { id: string; name: string } | null
    courseOffering?: { course: { id: string; name: string; code: string | null } } | null
  }
  originalTeacher?: { id: string; name: string | null; email: string; username?: string | null }
  substitute?: { id: string; name: string | null; email: string; username?: string | null }
}

export type SubstitutionListResponse = {
  total: number
  page: number
  pageSize: number
  data: SubstitutionRow[]
}
