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
 * reunión: «Anterior / Siguiente» ida y vuelta no lo vuelve a pedir. El juicio de la reunión no
 * viene acá; una corrección de administración sí lo cambia, y por eso `refresh` lo vuelve a pedir.
 */
export function useMeetingStudent(query: MeetingStudentQuery | null, studentId: string | null) {
  const path = query && studentId ? meetingStudentPath(query, studentId) : null
  const cache = useRef(new Map<string, MeetingStudent>())
  const [detail, setDetail] = useState<MeetingStudentDetail>({ status: 'idle' })
  const [attempt, setAttempt] = useState(0)
  // Al releer después de corregir se sigue mostrando lo que había: la materia desplegada no se cierra.
  const quiet = useRef(false)

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
    if (!quiet.current) setDetail({ status: 'loading' })
    quiet.current = false
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
  /** Después de una corrección: lo guardado de este alumno ya no vale y se vuelve a pedir. */
  const refresh = useCallback(() => {
    if (path) cache.current.delete(path)
    quiet.current = true
    setAttempt((n) => n + 1)
  }, [path])
  return { detail, retry, refresh }
}
