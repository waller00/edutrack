'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Check, ChevronDown, Pause, Route, Sparkles } from 'lucide-react'
import { isOnboardingStepPath } from '@/lib/navigation/onboarding'
import { useOnboarding } from './useOnboarding'
import OnboardingStepDetails from './OnboardingStepDetails'
import OnboardingSpotlight from './OnboardingSpotlight'

/**
 * Acompaña el trabajo real sin bloquear los controles de la pantalla. En la pantalla del paso,
 * los globos señalan cada control; si la persona los oculta, no vuelven solos en ese paso, pero
 * «Mostrarme en la pantalla» los trae de nuevo.
 */
export default function OnboardingCompanion() {
  const pathname = usePathname()
  const router = useRouter()
  const onboarding = useOnboarding()
  const step = onboarding.current
  if (!onboarding.ready || !onboarding.progress.active || !step || pathname === '/guia') return null
  const onStep = isOnboardingStepPath(pathname, step)
  const stepId = step.module.id
  const spotsOn = onStep && step.spots.length > 0 && !onboarding.progress.spotsHidden.includes(stepId)

  return (
    <aside aria-label="Guía en curso" className="mx-3 mt-4 rounded-xl border border-emerald-200 bg-white p-4 shadow-sm sm:mx-4 lg:mx-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
          <Route className="h-4 w-4 shrink-0" aria-hidden />
          Paso {onboarding.steps.indexOf(step) + 1} de {onboarding.steps.length}: {step.task}
        </p>
        <button type="button" onClick={onboarding.pause} className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100">
          <Pause className="h-3.5 w-3.5" aria-hidden /> Continuar más tarde
        </button>
      </div>
      <details className="mt-2">
        <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-slate-700">
          Qué hacer en este paso <ChevronDown className="h-4 w-4" aria-hidden />
        </summary>
        <OnboardingStepDetails step={step} />
      </details>
      <p className="mt-2 text-sm text-slate-600">{step.instructions}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {onStep ? (
          <button type="button" onClick={() => { const href = onboarding.complete(); if (href) router.push(href) }} className="btn-primary inline-flex items-center gap-2 text-sm">
            <Check className="h-4 w-4" aria-hidden /> Ya lo hice · {onboarding.pending.length > 1 ? 'Siguiente paso' : 'Finalizar recorrido'}
          </button>
        ) : (
          <Link href={step.module.href} className="btn-primary text-sm">Ir a {step.module.label}</Link>
        )}
        {onStep && step.spots.length > 0 && (
          <button
            type="button"
            onClick={() => (spotsOn ? onboarding.hideSpots(stepId) : onboarding.showSpots(stepId))}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 hover:underline"
          >
            <Sparkles className="h-4 w-4" aria-hidden />
            {spotsOn ? 'Ocultar globos' : 'Mostrarme en la pantalla'}
          </button>
        )}
        <Link href="/guia" className="text-sm font-medium text-emerald-700 hover:underline">Ver todos los pasos</Link>
        <span className="text-xs text-slate-500" aria-live="polite">{onboarding.completed.length} de {onboarding.steps.length} completados</span>
      </div>
      {spotsOn && <OnboardingSpotlight key={stepId} spots={step.spots} onClose={() => onboarding.hideSpots(stepId)} />}
    </aside>
  )
}
