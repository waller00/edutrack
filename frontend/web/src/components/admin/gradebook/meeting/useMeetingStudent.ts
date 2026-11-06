'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api/client'
import type { MeetingStudent } from '@/lib/gradebook/meeting-student'

export type MeetingStudentQuery = {
  courseOfferingId: string
  courseOrientationId?: string | null
  periodId: string
}

export type MeetingStudentDetail =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: MeetingStudent }
  | { status: 'error'; error: string }

export function meetingStudentPath(query: MeetingStudentQuery, studentId: string): string {
  const params = new URLSearchParams({ courseOfferingId: query.courseOfferingId, periodId: query.periodId })
  if (query.courseOrientationId) params.set('courseOrientationId', query.courseOrientationId)
  return `/admin/gradebook/group-matrix/students/${studentId}?${params}`
}

/**
 * El detalle del alumno del panel. Queda guardado por alumno mientras no cambien el grupo ni la
 * reunión: «Anterior / Siguiente» ida y vuelta no lo vuelve a pedir. Lo que decide la reunión
 * (rendimiento, conducta, juicio) no viene acá, así que guardarlo no lo deja viejo.
 */
export function useMeetingStudent(query: MeetingStudentQuery | null, studentId: string | null) {
  const path = query && studentId ? meetingStudentPath(query, studentId) : null
  const cache = useRef(new Map<string, MeetingStudent>())
  const [detail, setDetail] = useState<MeetingStudentDetail>({ status: 'idle' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!path) {
      setDetail({ status: 'idle' })
      return
    }
    const cached = cache.current.get(path)
    if (cached) {
      setDetail({ status: 'ready', data: cached })
      return
    }
    let alive = true
    setDetail({ status: 'loading' })
    api<MeetingStudent>(path)
      .then((data) => {
        cache.current.set(path, data)
        if (alive) setDetail({ status: 'ready', data })
      })
      .catch((err) => {
        if (alive) setDetail({ status: 'error', error: err instanceof Error ? err.message : 'No se pudo cargar el detalle del alumno' })
      })
    return () => {
      alive = false
    }
  }, [path, attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  return { detail, retry }
}
