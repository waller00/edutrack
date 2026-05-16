'use client'

import { api } from '@/lib/api'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

const LS_KEY = 'edutrack_admin_school_year_id'
const LS_ALL = 'edutrack_admin_school_year_all'

export type SchoolYearApiRow = {
  id: string
  code: number
  label: string
  startsOn: string | null
  endsOn: string | null
  status: string
  createdAt: string
  updatedAt: string
  /** Cantidad de cursos catalogados en este ciclo (para UI / copiar estructura). */
  coursesCount?: number
}

type AdminSchoolYearContextValue = {
  loading: boolean
  years: SchoolYearApiRow[]
  activeId: string | null
  selectedId: string | null
  allYears: boolean
  setSelectedId: (id: string | null) => void
  setAllYears: (v: boolean) => void
  reload: () => Promise<void>
  /** Sufijo para anexar a URLs de API admin (`schoolYearId=` o `allYears=1`). */
  schoolYearQuery: string
  /** Ciclo fijo (nunca `allYears`): combos de curso/asignatura al crear eventos, etc. */
  schoolYearScopedQuery: string
}

const AdminSchoolYearContext = createContext<AdminSchoolYearContextValue | null>(null)

export function AdminSchoolYearProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [years, setYears] = useState<SchoolYearApiRow[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [selectedId, setSelectedIdState] = useState<string | null>(null)
  const [allYears, setAllYearsState] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [list, active] = await Promise.all([
        api<SchoolYearApiRow[]>('/admin/school-years'),
        api<SchoolYearApiRow | null>('/admin/school-years/active'),
      ])
      setYears(Array.isArray(list) ? list : [])
      const act = active?.id ?? null
      setActiveId(act)

      const all = typeof window !== 'undefined' && localStorage.getItem(LS_ALL) === '1'
      setAllYearsState(all)
      if (all) {
        setSelectedIdState(null)
        return
      }
      const fromLs = typeof window !== 'undefined' ? localStorage.getItem(LS_KEY) : null
      if (fromLs && list.some((y) => y.id === fromLs)) {
        setSelectedIdState(fromLs)
      } else {
        setSelectedIdState(act ?? list[0]?.id ?? null)
      }
    } catch {
      setYears([])
      setActiveId(null)
      setSelectedIdState(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const setSelectedId = useCallback((id: string | null) => {
    setSelectedIdState(id)
    if (typeof window === 'undefined') return
    if (id) localStorage.setItem(LS_KEY, id)
    else localStorage.removeItem(LS_KEY)
  }, [])

  const setAllYears = useCallback((v: boolean) => {
    setAllYearsState(v)
    if (typeof window === 'undefined') return
    if (v) {
      localStorage.setItem(LS_ALL, '1')
      setSelectedIdState(null)
    } else {
      localStorage.removeItem(LS_ALL)
    }
  }, [])

  const schoolYearQuery = useMemo(() => {
    if (allYears) return 'allYears=1'
    const id = selectedId ?? activeId
    if (!id) return ''
    return `schoolYearId=${encodeURIComponent(id)}`
  }, [allYears, selectedId, activeId])

  const schoolYearScopedQuery = useMemo(() => {
    const id = selectedId ?? activeId
    if (!id) return ''
    return `schoolYearId=${encodeURIComponent(id)}`
  }, [selectedId, activeId])

  const value = useMemo<AdminSchoolYearContextValue>(
    () => ({
      loading,
      years,
      activeId,
      selectedId,
      allYears,
      setSelectedId,
      setAllYears,
      reload,
      schoolYearQuery,
      schoolYearScopedQuery,
    }),
    [
      loading,
      years,
      activeId,
      selectedId,
      allYears,
      setSelectedId,
      setAllYears,
      reload,
      schoolYearQuery,
      schoolYearScopedQuery,
    ],
  )

  return <AdminSchoolYearContext.Provider value={value}>{children}</AdminSchoolYearContext.Provider>
}

export function useAdminSchoolYear(): AdminSchoolYearContextValue {
  const ctx = useContext(AdminSchoolYearContext)
  if (!ctx) {
    throw new Error('useAdminSchoolYear debe usarse dentro de AdminSchoolYearProvider')
  }
  return ctx
}

/** Para páginas admin renderizadas fuera del provider (tests). */
export function useOptionalAdminSchoolYear(): AdminSchoolYearContextValue | null {
  return useContext(AdminSchoolYearContext)
}
