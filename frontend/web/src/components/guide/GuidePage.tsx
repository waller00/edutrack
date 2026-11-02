'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Check, CheckCircle2, RotateCcw, Route } from 'lucide-react'
import ModuleHeader from '@/components/common/ModuleHeader'
import { useAuth } from '@/contexts/AuthContext'
import { getRoleLabel } from '@/lib/roles/display'
import { useOnboarding } from './useOnboarding'
import OnboardingStepDetails from './OnboardingStepDetails'

/** Recorrido práctico, disponible también para perfiles personalizados. */
export default function GuidePage() {
  const { me } = useAuth()
  const router = useRouter()
  const onboarding = useOnboarding()
  const [selected, setSelected] = useState<string | null>(null)
  const step = onboarding.steps.find((entry) => entry.module.id === selected) ?? onboarding.current
  const count = onboarding.completed.length
  const total = onboarding.steps.length

  function openStep() {
    const href = onboarding.start(step?.module.id)
    if (href) router.push(href)
  }

  return (
    <main className="responsive-page max-w-6xl space-y-6">
      <ModuleHeader id="guide" />

      <section aria-labelledby="onboarding-welcome" className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5 sm:p-6">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">
          <Route className="h-4 w-4" aria-hidden />
          {me?.roleLabel || getRoleLabel(me?.role ?? '')}
        </p>
        <h2 id="onboarding-welcome" className="mt-3 text-xl font-semibold text-slate-900 sm:text-2xl">
          {onboarding.finished ? '¡Terminaste tu recorrido!' : 'Aprendé EduTrack con tu propio trabajo'}
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
          {onboarding.finished
            ? 'Ya conocés las herramientas de tu perfil. Podés volver a cualquier paso cuando lo necesites.'
            : 'Esta guía te lleva a las pantallas que podés usar y te muestra qué hacer en cada una. Abrí un paso, mirá la pantalla y confirmá cuando termines.'}
        </p>
        <p className="mt-2 text-xs text-slate-500">El recorrido se adapta a tus permisos y su alcance. Tu avance se guarda en este navegador para tu cuenta.</p>
        <div className="mt-5 flex items-center justify-between gap-3 text-sm">
          <span aria-live="polite" className="font-medium text-emerald-800">{count} de {total} pasos completados</span>
          {onboarding.progress.started && (
            <button type="button" onClick={() => { onboarding.restart(); setSelected(null) }} className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-emerald-800">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reiniciar recorrido
            </button>
          )}
        </div>
        <progress aria-label="Progreso de la guía" max={total || 1} value={count} className="mt-2 h-2 w-full overflow-hidden rounded-full accent-emerald-600" />
      </section>

      {onboarding.ready && step && (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(15rem,1fr)_minmax(0,1.7fr)]">
          <nav aria-label="Pasos de tu guía" className="max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 lg:max-h-none">
            <p className="px-2 pb-3 pt-1 text-sm font-semibold text-slate-900">Tu recorrido</p>
            <ol className="space-y-1">
              {onboarding.steps.map((entry, index) => {
                const done = onboarding.progress.completed.includes(entry.module.id)
                const active = entry.module.id === step.module.id
                return (
                  <li key={entry.module.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(entry.module.id)}
                      aria-current={active ? 'step' : undefined}
                      className={`flex w-full items-center gap-3 rounded-lg p-2.5 text-left text-sm transition ${active ? 'bg-emerald-50 font-semibold text-emerald-900 ring-1 ring-emerald-200' : 'text-slate-600 hover:bg-slate-50'}`}
                    >
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${done ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                        {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : index + 1}
                      </span>
                      <span className="min-w-0 flex-1">{entry.module.label}</span>
                      {done && <span className="sr-only">Completado</span>}
                    </button>
                  </li>
                )
              })}
            </ol>
          </nav>

          <section aria-labelledby="onboarding-step-title" className="rounded-xl border border-slate-200 bg-white p-5 lg:sticky lg:top-24 sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
              Paso {onboarding.steps.indexOf(step) + 1} de {total} · {step.module.label}
            </p>
            <h2 id="onboarding-step-title" tabIndex={-1} className="mt-3 text-xl font-semibold text-slate-900">{step.task}</h2>
            <OnboardingStepDetails step={step} />
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button type="button" onClick={openStep} className="btn-primary inline-flex items-center gap-2">
                {onboarding.progress.started ? 'Abrir este paso' : 'Empezar recorrido'}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </button>
              {onboarding.progress.completed.includes(step.module.id) && (
                <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" aria-hidden /> Completado</span>
              )}
            </div>
            <p className="mt-4 text-xs leading-relaxed text-slate-500">
              Te acompañamos dentro de la pantalla. Si todavía no hay datos o no corresponde realizar una operación, podés conocer las opciones y continuar. El botón «Ya lo hice» registra tu avance en el recorrido.
            </p>
          </section>
        </div>
      )}
    </main>
  )
}
