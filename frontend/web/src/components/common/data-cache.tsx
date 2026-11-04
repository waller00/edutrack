'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '@/lib/api/client'

type Store = {
  /** Sube con "Actualizar": todo se vuelve a pedir. */
  version: number
  refresh: () => void
  load: <T>(path: string) => Promise<T>
}

const IndicatorDataContext = createContext<Store | null>(null)

/**
 * Un solo pedido por dirección para toda la pantalla: en Indicadores de estudiantes, el Resumen,
 * Asistencia y Quién necesita atención usan los mismos datos de riesgo; en «Mi día» del docente, los
 * cierres y las observaciones salen del mismo resumen de libretas. Cambiar de sección no vuelve a
 * pedir, y un error no queda guardado, así "Reintentar" pide de nuevo.
 */
export function IndicatorDataProvider({ children }: Readonly<{ children: ReactNode }>) {
  const cache = useRef(new Map<string, Promise<unknown>>())
  const [version, setVersion] = useState(0)
  const refresh = useCallback(() => {
    cache.current.clear()
    setVersion((n) => n + 1)
  }, [])
  const load = useCallback(<T,>(path: string): Promise<T> => {
    let entry = cache.current.get(path)
    if (!entry) {
      entry = api<T>(path)
      entry.catch(() => cache.current.delete(path))
      cache.current.set(path, entry)
    }
    return entry as Promise<T>
  }, [])
  const value = useMemo(() => ({ version, refresh, load }), [version, refresh, load])
  return <IndicatorDataContext.Provider value={value}>{children}</IndicatorDataContext.Provider>
}

export function useIndicatorRefresh(): { refresh: () => void } {
  const store = useContext(IndicatorDataContext)
  return { refresh: store?.refresh ?? (() => undefined) }
}

export type IndicatorData<T> = {
  data: T | null
  /** Pidiendo: la primera vez, o después de "Actualizar" (se sigue mostrando lo anterior). */
  loading: boolean
  error: string | null
  retry: () => void
}

type Result<T> = { data: T | null; error: string | null }

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'No se pudieron cargar los indicadores')

/** Avisa el resultado del pedido salvo que se haya cancelado antes (otro ciclo, otra sección). */
function deliver<T>(request: Promise<T>, done: (result: Result<T>) => void): () => void {
  let cancelled = false
  request.then(
    (data) => {
      if (!cancelled) done({ data, error: null })
    },
    (err: unknown) => {
      if (!cancelled) done({ data: null, error: errorText(err) })
    },
  )
  return () => {
    cancelled = true
  }
}

/** Los datos de `path` (`null` no pide nada). Una respuesta vieja nunca pisa a la de otro ciclo. */
export function useIndicatorData<T>(path: string | null): IndicatorData<T> {
  const store = useContext(IndicatorDataContext)
  const version = store?.version ?? 0
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<(Result<T> & { key: string; path: string }) | null>(null)
  const key = `${version}|${attempt}|${path}`

  useEffect(() => {
    if (!path) return
    const request = store ? store.load<T>(path) : api<T>(path)
    return deliver(request, (result) => setState({ ...result, key, path }))
  }, [key, path, store])

  const current = state?.path === path ? state : null
  return {
    data: current?.data ?? null,
    loading: Boolean(path) && state?.key !== key,
    error: current?.key === key ? current.error : null,
    retry: () => setAttempt((n) => n + 1),
  }
}
