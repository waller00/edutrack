'use client'

import Link from 'next/link'
import { Route, X } from 'lucide-react'
import { useOnboarding } from './useOnboarding'

export default function GuideWelcomeBanner() {
  const onboarding = useOnboarding()
  if (!onboarding.ready || onboarding.finished || onboarding.progress.dismissed || !onboarding.steps.length) return null

  return (
    <aside aria-label="Guía para empezar" className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
      <Route className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{onboarding.progress.started ? 'Seguí con tu guía' : 'Empezá a usar EduTrack paso a paso'}</p>
        <p className="mt-1 text-emerald-800">
          {onboarding.progress.started
            ? `${onboarding.completed.length} de ${onboarding.steps.length} pasos completados. Retomá el recorrido cuando quieras.`
            : 'Un recorrido para tu perfil: conocé qué podés ver y hacer, y probalo en cada pantalla.'}
        </p>
        <Link href="/guia" className="mt-2 inline-flex font-semibold underline hover:text-emerald-700">
          {onboarding.progress.started ? 'Continuar la guía' : 'Empezar la guía'}
        </Link>
      </div>
      <button type="button" onClick={onboarding.dismiss} className="shrink-0 rounded p-1 text-emerald-700 hover:bg-emerald-100" aria-label="Ocultar invitación a la guía" title="Podés abrirlo desde tu cuenta">
        <X className="h-4 w-4" aria-hidden />
      </button>
    </aside>
  )
}
