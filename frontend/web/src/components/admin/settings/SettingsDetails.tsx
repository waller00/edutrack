import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'

export default function SettingsDetails({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <details className="group rounded-xl border border-slate-200 bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-sm font-medium text-slate-800">
            {title}
          </span>
          {description && (
            <span className="mt-1 block text-xs text-slate-500">
              {description}
            </span>
          )}
        </span>
        <ChevronDown
          className="h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="space-y-4 border-t border-slate-100 p-4">{children}</div>
    </details>
  )
}
