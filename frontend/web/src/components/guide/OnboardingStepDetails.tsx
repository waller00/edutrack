import type { OnboardingStep } from '@/lib/navigation/onboarding'

export default function OnboardingStepDetails({ step }: Readonly<{ step: OnboardingStep }>) {
  return (
    <div className="mt-3 space-y-4 text-sm text-slate-600">
      <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{step.scopeLabel}</span>
      <div>
        <p className="font-medium text-slate-900">Qué podés ver</p>
        <p className="mt-1 leading-relaxed">{step.module.description}</p>
      </div>
      <div>
        <p className="font-medium text-slate-900">Probá este paso</p>
        <p className="mt-1 leading-relaxed">{step.instructions}</p>
      </div>
      {step.spots.length > 0 && (
        <div>
          <p className="font-medium text-slate-900">Lo que vas a ver en la pantalla</p>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5">
            {step.spots.map((spot) => (
              <li key={spot.target}>
                <span className="font-medium text-slate-800">{spot.title}:</span> {spot.text}
              </li>
            ))}
          </ol>
        </div>
      )}
      {step.actions.length > 0 && (
        <div>
          <p className="font-medium text-slate-900">También podés hacer</p>
          <ul className="mt-2 list-disc space-y-1.5 pl-5">
            {step.actions.map((action) => <li key={action}>{action}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}
