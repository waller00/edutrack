'use client'

import Link from 'next/link'
import { GraduationCap, Users } from 'lucide-react'
import ModuleHeader from '@/components/common/ModuleHeader'
import { useAuth } from '@/contexts/AuthContext'
import { canSeeModule, moduleById, visibleNavGroups, type ModuleId } from '@/lib/navigation/modules'

/** Nombre de una sección dentro del texto: enlace si la persona la puede abrir. */
function ModuleRef({ id }: Readonly<{ id: ModuleId }>) {
  const { me } = useAuth()
  const entry = moduleById(id)
  if (!canSeeModule(me, entry)) return <strong className="font-semibold text-slate-800">{entry.label}</strong>
  return (
    <Link href={entry.href} className="font-semibold text-emerald-700 hover:underline">
      {entry.label}
    </Link>
  )
}

/**
 * Guía de EduTrack: qué hay en cada grupo del menú y para qué sirve cada sección, sólo con lo que
 * la persona puede usar. Arriba, lo que más confunde a quien recién llega: la asistencia del
 * personal y la de los estudiantes son dos cosas distintas.
 */
export default function GuidePage() {
  const { me } = useAuth()
  const groups = visibleNavGroups(me).filter((group) => group.id !== 'inicio')

  return (
    <main className="responsive-page max-w-5xl space-y-6">
      <ModuleHeader id="guide" />

      <section aria-labelledby="guide-two-attendances" className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 sm:p-5">
        <h2 id="guide-two-attendances" className="text-base font-semibold text-slate-900">
          Dos asistencias distintas
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          EduTrack lleva por separado la asistencia del personal y la de los estudiantes. No se mezclan: cada una se
          registra, se controla y se justifica en sus propias pantallas.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <article className="rounded-lg border border-slate-200 bg-white p-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Users className="h-4 w-4 text-slate-500" aria-hidden />
              Del personal
            </h3>
            <p className="text-xs text-slate-500">Docentes y funcionarios: si vinieron a trabajar.</p>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-slate-700">
              <li>Se registra con el reloj de huella o con el marcado manual del día.</li>
              <li>
                Se controla en <ModuleRef id="staff-attendance" />, y cada uno ve la suya en{' '}
                <ModuleRef id="my-attendance" />.
              </li>
              <li>
                Las ausencias con licencia se cargan en <ModuleRef id="staff-licenses" />.
              </li>
              <li>
                La puntualidad y el ausentismo se miden en <ModuleRef id="staff-indicators" />.
              </li>
            </ul>
          </article>
          <article className="rounded-lg border border-slate-200 bg-white p-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <GraduationCap className="h-4 w-4 text-slate-500" aria-hidden />
              De los estudiantes
            </h3>
            <p className="text-xs text-slate-500">Quién vino a cada clase.</p>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-slate-700">
              <li>
                El docente la marca en <ModuleRef id="roll-call" />, clase por clase.
              </li>
              <li>
                Adscripción justifica las faltas y sigue a quien falta seguido en{' '}
                <ModuleRef id="student-attendance" />.
              </li>
              <li>Cada libreta muestra las faltas acumuladas de su grupo, en la sección Inasistencias.</li>
            </ul>
          </article>
        </div>
      </section>

      {groups.map((group) => {
        const GroupIcon = group.icon
        return (
          <section key={group.id} aria-labelledby={`guide-group-${group.id}`} className="space-y-2">
            <h2 id={`guide-group-${group.id}`} className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <GroupIcon className="h-5 w-5 text-slate-500" aria-hidden />
              {group.title}
            </h2>
            <p className="text-sm text-slate-600">{group.description}</p>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.modules.map((entry) => {
                const Icon = entry.icon
                return (
                  <li key={entry.id}>
                    <Link
                      href={entry.href}
                      className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-4 transition hover:border-emerald-400"
                    >
                      <span className="flex items-center gap-2 text-sm font-medium text-slate-900">
                        <Icon className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden />
                        {entry.label}
                      </span>
                      <span className="mt-1 text-xs text-slate-500">{entry.description}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </main>
  )
}
