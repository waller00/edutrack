'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AlertTriangle, ArrowLeft, Loader2 } from 'lucide-react'
import { useLibreta } from '@/contexts/LibretaContext'
import { LIBRETA_SECTIONS, sectionHref } from '@/lib/libreta/menu'
import { libretaCode } from './MisLibretas'
import GroupSwitcher from './GroupSwitcher'

/**
 * Marco del Libro del Profesor: identidad de la libreta arriba, secciones a la izquierda.
 *
 * Es la metáfora que hace navegable el módulo: una libreta es un libro con capítulos siempre
 * visibles, no una pantalla con paneles apilados. Cada capítulo lleva su explicación de una línea,
 * porque "Precierre" o "Visados" no se entienden solos.
 */
export default function LibretaShell({ children }: { children: React.ReactNode }) {
  const { gradeBookId, detail, loading, error } = useLibreta()
  const pathname = usePathname()
  // `/libreta/<id>/<sección>` → la sección, o null en la portada. Se conserva al cambiar de grupo.
  const openSection = pathname.split('/')[3] ?? null

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
          Volver a Mis Libretas
        </Link>
      </div>
    )
  }

  const readOnly = detail.status === 'ARCHIVED'

  return (
    <div className="space-y-4">
      <header className="border-b border-gray-200 pb-2">
        <p className="text-xs text-gray-500">
          <Link href="/libreta" className="text-emerald-700 hover:underline">Mis Libretas</Link>
          {' / '}Libro del Profesor
        </p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-bold uppercase tracking-wide text-slate-700">
            Libreta: {libretaCode(detail)}
          </h1>
          <GroupSwitcher gradeBookId={gradeBookId} section={openSection} />
        </div>
        <p className="text-sm text-gray-600">
          {detail.course.name}
          {detail.orientation ? ` — ${detail.orientation}` : ' — tronco común'}
          {' · '}Ciclo {detail.schoolYear.label}
          {detail.teacher?.name ? ` · ${detail.teacher.name}` : ''}
          {' · '}{detail.studentCount} estudiante{detail.studentCount === 1 ? '' : 's'}
        </p>
      </header>

      {readOnly && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Ciclo lectivo cerrado. La libreta pasó a histórico: se consulta y se exporta, pero no admite
          cambios.
        </p>
      )}

      <div className="flex flex-col gap-4 lg:flex-row">
        <nav aria-label="Secciones de la libreta" className="lg:w-72 lg:shrink-0">
          <p className="mb-2 text-sm font-semibold text-gray-900">Menú Libro del Profesor</p>
          <ul className="space-y-0.5">
            {LIBRETA_SECTIONS.map((section) => {
              const href = sectionHref(gradeBookId, section.id)
              const active = pathname === href
              return (
                <li key={section.id}>
                  <Link
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={`block rounded px-3 py-2 transition ${
                      active
                        ? 'bg-amber-50 font-medium text-amber-900 ring-1 ring-amber-200'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <span className="block text-sm">{section.label}</span>
                    <span className="block text-xs leading-snug text-gray-500">{section.hint}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  )
}
