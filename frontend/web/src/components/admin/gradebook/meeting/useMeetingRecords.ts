'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api/client'
import type { JudgementState } from '@/lib/gradebook/meeting-board'
import { currentByKey, judgementState, meetingRecordsPath, type MeetingDecision } from '@/lib/gradebook/meeting-records'

export type MeetingRecordsScope = {
  courseOfferingId: string
  courseOrientationId?: string | null
  periodId: string
}

export type MeetingRecords = {
  rows: MeetingDecision[]
  /** El juicio vigente de cada alumno y el del grupo (clave `null`). */
  current: Map<string | null, MeetingDecision>
  /** `null` mientras cargan: la tabla no dice «Sin juicio» antes de saberlo. */
  judgements: JudgementState
  loading: boolean
  error: string | null
  /** `studentId` null es el juicio general del grupo. Devuelve si se guardó. */
  save: (studentId: string | null, text: string) => Promise<boolean>
}

/**
 * Los juicios de la reunión, pedidos una sola vez: los usan la tabla (columna Juicio), el panel
 * del alumno y «Juicios de la reunión», así lo que se escribe en uno se ve en los otros.
 */
export function useMeetingRecords(scope: MeetingRecordsScope | null): MeetingRecords {
  const courseOfferingId = scope?.courseOfferingId ?? null
  const courseOrientationId = scope?.courseOrientationId ?? null
  const periodId = scope?.periodId ?? null
  const [rows, setRows] = useState<MeetingDecision[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Sólo vale la última lectura: al cambiar rápido de grupo o de reunión, una respuesta vieja que
  // llegaba tarde pisaba la nueva y se veían los juicios del otro grupo.
  const latest = useRef(0)

  // Al guardar se vuelve a leer sin pasar por «cargando»: la tabla no parpadea a «…» y los otros
  // juicios que se estaban escribiendo no se pierden.
  const load = useCallback(async (quiet = false) => {
    if (!courseOfferingId || !periodId) return
    const request = ++latest.current
    if (!quiet) setLoading(true)
    try {
      const res = await api<{ data: MeetingDecision[] }>(meetingRecordsPath(courseOfferingId, courseOrientationId, periodId))
      if (request === latest.current) setRows(res.data ?? [])
    } catch (err) {
      if (request === latest.current) setError(err instanceof Error ? err.message : 'No se pudieron cargar los juicios')
    } finally {
      if (request === latest.current) setLoading(false)
    }
  }, [courseOfferingId, courseOrientationId, periodId])

  useEffect(() => {
    setRows([])
    setError(null)
    setLoading(true)
    void load()
  }, [load])

  const save = useCallback(
    async (studentId: string | null, text: string): Promise<boolean> => {
      if (!courseOfferingId || !periodId) return false
      setError(null)
      try {
        await api('/admin/gradebook/meeting-records', {
          method: 'POST',
          body: JSON.stringify({
            courseOfferingId,
            courseOrientationId: courseOrientationId ?? undefined,
            periodId,
            studentId: studentId ?? undefined,
            decision: text.trim(),
          }),
        })
        await load(true)
        return true
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo guardar el juicio')
        return false
      }
    },
    [courseOfferingId, courseOrientationId, periodId, load],
  )

  const current = useMemo(() => currentByKey(rows), [rows])
  const judgements = useMemo(() => (loading ? null : judgementState(current)), [loading, current])
  return { rows, current, judgements, loading, error, save }
}
