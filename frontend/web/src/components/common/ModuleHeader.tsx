'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { useOptionalAuth } from '@/contexts/AuthContext'
import { moduleById, NAV_GROUP_META, visibleRelated, type ModuleId } from '@/lib/navigation/modules'

/**
 * Encabezado de una pantalla: de qué parte del sistema es, cómo se llama y para qué sirve, todo
 * desde el catálogo de módulos. Si hay una sección con la que se confunde (la asistencia del
 * personal y la de los estudiantes, por ejemplo), ofrece el enlace: "¿Buscás…?".
 *
 * El grupo va escrito además de con ícono (RNF 7.2: nunca sólo color o forma).
 */
export default function ModuleHeader({
  id,
  actions,
  children,
  className = '',
}: Readonly<{
  id: ModuleId
  /** Botones de la pantalla (exportar, crear…), a la derecha del título. */
  actions?: ReactNode
  /** Explicaciones extra de la pantalla, debajo de la descripción. */
  children?: ReactNode
  className?: string
}>) {
  const entry = moduleById(id)
  const me = useOptionalAuth()?.me ?? null
  const group = NAV_GROUP_META[entry.group]
  const GroupIcon = group.icon
  const related = visibleRelated(me, entry).slice(0, 2)

  return (
    <header className={`space-y-2 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {/* Un módulo fuera del menú (Mensajes) no se presenta como parte de un grupo del menú. */}
          {group.showChip && entry.menu !== false && (
            <p className="mb-1.5 inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
              <GroupIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {group.title}
            </p>
          )}
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{entry.label}</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">{entry.description}</p>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {related.length > 0 && (
        <ul aria-label="Secciones relacionadas" className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
          {related.map((item) => (
            <li key={item.id}>
              {item.text}{' '}
              <Link
                href={item.target.href}
                className="inline-flex items-center gap-0.5 font-medium text-emerald-700 hover:underline"
              >
                {item.target.label}
                <ArrowRight className="h-3 w-3" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {children}
    </header>
  )
}
