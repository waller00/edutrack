'use client'

import Link from 'next/link'
import SettingsDetails from '@/components/admin/settings/SettingsDetails'
import { ArrowRight } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { quickAccessModules } from '@/lib/navigation/modules'

/**
 * Accesos rápidos de Inicio. Nombre y descripción salen del catálogo de módulos, el mismo del
 * menú: antes cada uno tenía su lista y ya decían cosas distintas.
 */
export default function HomeQuickAccess() {
  const { me } = useAuth()
  const entries = quickAccessModules(me)
  const renderLinks = (items: typeof entries) => (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((entry) => (
        <Link
          key={entry.id}
          href={entry.href}
          className="group rounded-xl border border-slate-200 bg-white p-4 transition hover:border-emerald-400"
        >
          <span className="flex items-center justify-between gap-2 text-sm font-medium text-slate-900">
            {entry.label}
            <ArrowRight
              className="h-4 w-4 shrink-0 text-emerald-600"
              aria-hidden
            />
          </span>
          <span className="mt-1 block text-xs text-slate-500">
            {entry.description}
          </span>
        </Link>
      ))}
    </div>
  )
  return (
    <section aria-label="Accesos rápidos" className="space-y-3">
      <h2 className="text-sm font-semibold text-slate-700">Accesos rápidos</h2>
      {renderLinks(entries.slice(0, 6))}
      {entries.length > 6 && (
        <SettingsDetails
          title="Más accesos"
          description="Consultá el resto de los módulos disponibles para tu perfil."
        >
          {renderLinks(entries.slice(6))}
        </SettingsDetails>
      )}
      {entries.length === 0 && (
        <p className="rounded-xl border bg-white p-4 text-sm text-slate-500">
          Tu perfil todavía no tiene módulos habilitados. Podés consultar y
          completar tus datos en{' '}
          <Link
            href="/profile"
            className="font-medium text-emerald-700 underline"
          >
            Mi perfil
          </Link>
          .
        </p>
      )}
    </section>
  )
}
