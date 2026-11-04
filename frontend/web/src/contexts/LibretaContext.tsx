'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api/client'
import type { GradeBookDetail } from '@/lib/gradebook/types'
import { confirmDiscard } from '@/lib/hooks/useUnsavedChangesWarning'

/** Una sección con cambios sin guardar: lo que hay que preguntar antes de irse a otra libreta. */
export type LeaveGuard = { dirty: boolean; message: string }

/**
 * Datos de la libreta abierta, compartidos por todas sus secciones.
 *
 * Se cargan una vez en el layout: sin esto, cada sección repetiría la misma consulta y el
 * encabezado parpadearía al navegar entre ellas.
 */
type LibretaContextValue = {
  gradeBookId: string
  detail: GradeBookDetail | null
  loading: boolean
  error: string | null
  reload: () => Promise<void>
  /** La sección abierta avisa si tiene cambios sin guardar; `null` al irse. */
  setLeaveGuard: (guard: LeaveGuard | null) => void
  /** `true` si se puede dejar la sección: no hay cambios, o se aceptó descartarlos. */
  confirmLeave: () => boolean
}

const LibretaContext = createContext<LibretaContextValue | null>(null)

export function LibretaProvider({
  gradeBookId,
  children,
}: {
  gradeBookId: string
  children: React.ReactNode
}) {
  const [detail, setDetail] = useState<GradeBookDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setDetail(await api<GradeBookDetail>(`/gradebook/${gradeBookId}`))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la libreta')
    } finally {
      setLoading(false)
    }
  }, [gradeBookId])

  useEffect(() => {
    void reload()
  }, [reload])

  // En una referencia: avisar cambios sin guardar no tiene por qué volver a dibujar la libreta.
  const guard = useRef<LeaveGuard | null>(null)
  const setLeaveGuard = useCallback((next: LeaveGuard | null) => {
    guard.current = next
  }, [])
  const confirmLeave = useCallback(() => confirmDiscard(guard.current?.dirty ?? false, guard.current?.message ?? ''), [])

  const value = useMemo(
    () => ({ gradeBookId, detail, loading, error, reload, setLeaveGuard, confirmLeave }),
    [gradeBookId, detail, loading, error, reload, setLeaveGuard, confirmLeave],
  )

  return <LibretaContext.Provider value={value}>{children}</LibretaContext.Provider>
}

/** Lo mismo, fuera de una libreta `null` (pantallas que también se usan sueltas). */
export function useOptionalLibreta(): LibretaContextValue | null {
  return useContext(LibretaContext)
}

export function useLibreta(): LibretaContextValue {
  const context = useContext(LibretaContext)
  if (!context) throw new Error('useLibreta debe usarse dentro de LibretaProvider')
  return context
}
