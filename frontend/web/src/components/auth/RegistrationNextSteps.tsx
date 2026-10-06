import { Check, Clock, LogIn, Mail } from 'lucide-react'
import type { ComponentType } from 'react'

type Stage = 'verify' | 'approval'

type Step = {
  key: string
  title: string
  description: string
  Icon: ComponentType<{ className?: string }>
}

/**
 * Los dos pasos de una cuenta nueva, en orden: verificar el correo y recién después la aprobación
 * de administración. Cada paso dice su estado en texto (no sólo color).
 */
export function RegistrationNextSteps({ stage, email }: { stage: Stage; email?: string }) {
  const steps: Step[] = [
    {
      key: 'verify',
      title: 'Verificá tu correo',
      description:
        stage === 'verify'
          ? `Te mandamos un enlace${email ? ` a ${email}` : ''}. Abrilo para confirmar que el correo es tuyo.`
          : 'Tu correo ya está verificado.',
      Icon: Mail,
    },
    {
      key: 'approval',
      title: 'Aprobación de administración',
      description: 'Con el correo verificado, administración revisa tu cuenta y la aprueba.',
      Icon: Clock,
    },
    {
      key: 'login',
      title: 'Ingresá a EduTrack',
      description: 'Cuando tu cuenta esté aprobada, ya podés ingresar.',
      Icon: LogIn,
    },
  ]
  const currentIndex = stage === 'verify' ? 0 : 1

  return (
    <ol className="space-y-3 text-left" aria-label="Pasos para habilitar tu cuenta">
      {steps.map((step, i) => {
        const done = i < currentIndex
        const current = i === currentIndex
        let statusLabel = 'Después'
        if (done) statusLabel = 'Listo'
        else if (current) statusLabel = 'Ahora'
        const StepIcon = done ? Check : step.Icon
        return (
          <li
            key={step.key}
            aria-current={current ? 'step' : undefined}
            className={`flex gap-3 rounded-xl border p-3 ${
              current ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white'
            }`}
          >
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                done || current ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'
              }`}
              aria-hidden
            >
              <StepIcon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                {i + 1}. {step.title}
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    current ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {statusLabel}
                </span>
              </p>
              <p className={`mt-0.5 text-sm ${current ? 'text-slate-700' : 'text-slate-500'}`}>
                {step.description}
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
