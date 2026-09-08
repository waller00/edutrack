'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api/client'
import type { GradeBookDetail } from '@/lib/gradebook/types'

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

  const value = useMemo(
    () => ({ gradeBookId, detail, loading, error, reload }),
    [gradeBookId, detail, loading, error, reload],
  )

  return <LibretaContext.Provider value={value}>{children}</LibretaContext.Provider>
}

export function useLibreta(): LibretaContextValue {
  const context = useContext(LibretaContext)
  if (!context) throw new Error('useLibreta debe usarse dentro de LibretaProvider')
  return context
}
