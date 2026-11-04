import { AlertTriangle } from 'lucide-react'
import type { Part } from '@/lib/admin/student-indicators'
import { formatShare } from '@/lib/format/percent'

/**
 * Un total partido en partes: una barra fina, sin texto encima. El nombre accesible enumera cada
 * parte con su «N de M», y la lista de al lado (`PartsList`) dice lo mismo en pantalla: la barra
 * sólo muestra la forma.
 */
export function SegmentedBar({ parts, label, className = '' }: Readonly<{ parts: readonly Part[]; label: string; className?: string }>) {
  const total = parts.reduce((acc, part) => acc + part.value, 0)
  const description = `${label}: ${parts.map((part) => `${part.label}, ${formatShare(part.value, total)}`).join('; ')}`
  return (
    <div role="img" aria-label={description} className={`flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-slate-100 ${className}`}>
      {total > 0 &&
        parts
          .filter((part) => part.value > 0)
          .map((part) => (
            <span
              key={part.key}
              title={`${part.label}: ${formatShare(part.value, total)}`}
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{ width: `${(part.value / total) * 100}%`, background: part.color }}
            />
          ))}
    </div>
  )
}

/** Las partes con su número y su base; la que está en alerta lo dice con icono y texto. */
export function PartsList({ parts, unit }: Readonly<{ parts: readonly Part[]; unit: string }>) {
  const total = parts.reduce((acc, part) => acc + part.value, 0)
  return (
    <ul className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
      {parts.map((part) => (
        <li key={part.key} className="flex min-w-0 items-start gap-2">
          <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: part.color }} aria-hidden />
          <span className="min-w-0">
            <span className="text-slate-800">{part.label}</span>{' '}
            <span className="tabular-nums text-slate-600">
              {formatShare(part.value, total)} {unit}
            </span>
            {part.alert && part.value > 0 && (
              <span className="ml-1 inline-flex items-center gap-0.5 text-xs font-medium text-amber-800">
                <AlertTriangle className="h-3 w-3" aria-hidden />
                alerta
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}
