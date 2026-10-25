'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { AlertTriangle, ArrowLeft, BookOpen, CalendarDays, CheckCheck, ChevronLeft, ChevronRight, ClipboardList, FilePenLine, GraduationCap, LayoutList, Loader2, MessageSquare, NotebookPen, UserRoundCheck, Users } from 'lucide-react'
import { formatDateInUruguay } from '@/lib/forms/datetime-uy'
import { useLibreta } from '@/contexts/LibretaContext'
import { useOptionalAuth } from '@/contexts/AuthContext'
import { hasAnyPermission } from '@/lib/auth/permissions'
import { sectionById, sectionHref, sectionsFor, type LibretaSectionId } from '@/lib/libreta/menu'
import type { GradeBookAccessLevel } from '@/lib/gradebook/types'
import GroupSwitcher from './GroupSwitcher'

const MENU_COLLAPSED_KEY = 'edutrack.libreta.menuCollapsed'
const SECTION_ICONS = {
  planificacion: NotebookPen,
  desarrollo: FilePenLine,
  evaluaciones: ClipboardList,
  cierre: CalendarDays,
  mensajes: MessageSquare,
  visado: CheckCheck,
}

/**
 * ¿Mira la libreta como supervisor? El titular y el suplente la trabajan; quien entra con alcance
 * de control (Dirección, adscripción, inspección) la recorre para visarla y avisar.
 */
export function supervisesLibreta(
  level: GradeBookAccessLevel | undefined,
  me: Parameters<typeof hasAnyPermission>[0],
): boolean {
  if (level === 'OWNER' || level === 'SUBSTITUTE') return false
  return hasAnyPermission(me, ['gradebook.review', 'gradebook.endorse', 'gradebook.inspect'], 'all')
}

/**
 * Marco del Libro del Profesor: identidad de la libreta arriba, secciones a la izquierda.
 *
 * Es la metáfora que hace navegable el módulo: una libreta es un libro con capítulos siempre
 * visibles, no una pantalla con paneles apilados. Cada capítulo lleva su explicación de una línea,
 * porque "Precierre" o "Visados" no se entienden solos. El menú se puede contraer para dar más
 * espacio a la planilla.
 */
export default function LibretaShell({ children }: { children: React.ReactNode }) {
  const { gradeBookId, detail, loading, error } = useLibreta()
  const me = useOptionalAuth()?.me ?? null
  const pathname = usePathname()
  const router = useRouter()
  // `/libreta/<id>/<sección>` → la sección, o null en la portada. Se conserva al cambiar de grupo.
  const openSection = pathname.split('/')[3] ?? null
  const [menuCollapsed, setMenuCollapsed] = useState(false)
  const supervises = supervisesLibreta(detail?.access.level, me)
  const substitute = Boolean(detail?.access.ownWorkOnly)
  const sections = useMemo(() => sectionsFor({ supervises, substitute }), [supervises, substitute])

  // Una sección que no es de quien mira (el docente en "Visado", el suplente en "Cierre") vuelve a
  // la portada en vez de mostrar una pantalla que no le corresponde.
  const misplaced = Boolean(detail && openSection && sectionById(openSection) && !sections.some((s) => s.id === openSection))
  useEffect(() => {
    if (misplaced) router.replace(`/libreta/${gradeBookId}`)
  }, [misplaced, router, gradeBookId])

  useEffect(() => {
    try {
      setMenuCollapsed(window.localStorage.getItem(MENU_COLLAPSED_KEY) === '1')
    } catch {
      /* sin storage (modo privado / SSR) se queda expandido */
    }
  }, [])

  function toggleMenu() {
    setMenuCollapsed((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(MENU_COLLAPSED_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }

  if (loading && !detail) {
    return (
      <p className="flex items-center gap-2 py-10 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Abriendo la libreta…
      </p>
    )
  }

  if (error || !detail) {
    return (
      <div className="space-y-3">
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error ?? 'No se pudo cargar la libreta'}
        </p>
        <Link href="/libreta" className="inline-flex items-center gap-1 text-sm text-emerald-700 hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Volver a las libretas
        </Link>
      </div>
    )
  }

  const readOnly = detail.status === 'ARCHIVED'
  const substituteUntil = detail.access.substituteUntil ? formatDateInUruguay(detail.access.substituteUntil) : null

  return (
    <div className="libreta-workspace space-y-5">
      <header className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <Link href="/libreta" className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-emerald-700">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />Todas las libretas
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3 sm:gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 sm:h-14 sm:w-14">
              <BookOpen className="h-6 w-6" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-slate-500">Libro del Profesor</p>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{detail.subject.name}</h1>
              <p className="mt-1 text-sm text-slate-500">{detail.teacher?.name ?? 'Sin titular asignado'}</p>
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${readOnly ? 'bg-slate-100 text-slate-600' : 'bg-emerald-50 text-emerald-800'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${readOnly ? 'bg-slate-400' : 'bg-emerald-500'}`} aria-hidden />
              {readOnly ? 'Histórico' : 'En curso'}
            </span>
            <GroupSwitcher gradeBookId={gradeBookId} section={openSection} />
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-100 pt-4 text-xs text-slate-600 sm:text-sm">
          <span className="inline-flex items-center gap-2"><GraduationCap className="h-4 w-4 text-slate-400" aria-hidden />{detail.course.name}{detail.orientation ? ` — ${detail.orientation}` : ' — tronco común'}</span>
          <span className="inline-flex items-center gap-2"><CalendarDays className="h-4 w-4 text-slate-400" aria-hidden />Ciclo {detail.schoolYear.label}</span>
          <span className="inline-flex items-center gap-2"><Users className="h-4 w-4 text-slate-400" aria-hidden />{detail.studentCount} estudiante{detail.studentCount === 1 ? '' : 's'}</span>
        </div>
      </header>

      {substitute && (
        <p role="status" className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
          <UserRoundCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            <strong className="font-semibold">Suplencia.</strong> Cargás tus notas en esta libreta
            {substituteUntil ? ` hasta el ${substituteUntil}` : ''}. Lo que cargó el titular no se muestra.
          </span>
        </p>
      )}

      {readOnly && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Ciclo lectivo cerrado. La libreta pasó a histórico: se consulta y se exporta, pero no admite
          cambios.
        </p>
      )}

      {/* En el celular, las siete secciones con su explicación empujaban el contenido una pantalla
          entera hacia abajo: un selector ocupa una línea. */}
      <label className="block rounded-xl border border-slate-200 bg-white p-3 lg:hidden">
        <span className="mb-1.5 block text-xs font-medium text-slate-500">Sección de la libreta</span>
        <select
          value={openSection ?? ''}
          onChange={(e) => router.push(e.target.value ? sectionHref(gradeBookId, e.target.value as LibretaSectionId) : `/libreta/${gradeBookId}`)}
          className="min-h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800"
        >
          <option value="">Lista del grupo</option>
          {sections.map((section) => (
            <option key={section.id} value={section.id}>
              {section.label}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-col items-start gap-5 lg:flex-row">
        <nav
          aria-label="Secciones de la libreta"
          className={`hidden rounded-xl border border-slate-200 bg-white p-2 lg:sticky lg:top-20 lg:block lg:shrink-0 ${menuCollapsed ? 'lg:w-16' : 'lg:w-56'}`}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            {!menuCollapsed && (
              <p className="pl-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Menú Libro del Profesor</p>
            )}
            <button
              type="button"
              onClick={toggleMenu}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              aria-expanded={!menuCollapsed}
              aria-controls="libreta-menu-sections"
              title={menuCollapsed ? 'Expandir menú' : 'Contraer menú'}
              aria-label={menuCollapsed ? 'Expandir menú del Libro del Profesor' : 'Contraer menú del Libro del Profesor'}
            >
              {menuCollapsed ? (
                <ChevronRight className="h-4 w-4" aria-hidden />
              ) : (
                <ChevronLeft className="h-4 w-4" aria-hidden />
              )}
            </button>
          </div>

          <Link
            href={`/libreta/${gradeBookId}`}
            aria-current={!openSection ? 'page' : undefined}
            aria-label="Lista del grupo"
            title={menuCollapsed ? 'Lista del grupo' : undefined}
            className={`mb-2 flex min-h-11 items-center gap-2.5 rounded-lg border-b border-slate-100 p-2.5 text-sm font-medium ${menuCollapsed ? 'justify-center' : ''} ${!openSection ? 'bg-emerald-50 text-emerald-800' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            <LayoutList className="h-4 w-4 shrink-0" aria-hidden />
            {!menuCollapsed && 'Lista del grupo'}
          </Link>

          {menuCollapsed && (
            // Contraído no queda vacío: la abreviatura sigue llevando a cada sección.
            <ul id="libreta-menu-sections" className="space-y-0.5">
              {sections.map((section) => {
                const href = sectionHref(gradeBookId, section.id)
                const active = pathname === href
                return (
                  <li key={section.id}>
                    <Link
                      href={href}
                      aria-current={active ? 'page' : undefined}
                      aria-label={section.label}
                      title={section.label}
                      className={`block rounded px-1 py-2 text-center text-[11px] font-semibold ${
                        active ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100' : 'text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {section.abbr}
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}

          {!menuCollapsed && (
            <ul id="libreta-menu-sections" className="space-y-0.5">
              {sections.map((section) => {
                const href = sectionHref(gradeBookId, section.id)
                const active = pathname === href
                const Icon = SECTION_ICONS[section.id]
                return (
                  <li key={section.id}>
                    <Link
                      href={href}
                      aria-current={active ? 'page' : undefined}
                      title={section.hint}
                      className={`flex items-start gap-2.5 rounded-lg px-2.5 py-3 transition-colors ${
                        active
                          ? 'bg-emerald-50 font-medium text-emerald-800'
                          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                      }`}
                    >
                      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{section.label}</span>
                        <span className={`mt-1 text-xs leading-relaxed text-slate-500 ${active ? 'block' : 'sr-only'}`}>{section.hint}</span>
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </nav>

        <div className="w-full min-w-0 flex-1">{misplaced ? null : children}</div>
      </div>
    </div>
  )
}
