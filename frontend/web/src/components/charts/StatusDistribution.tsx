export type DistributionItem = {
  key: string
  label: string
  count: number
  /** Clase de fondo de Tailwind (`bg-emerald-600`): el color sólo refuerza, el texto dice el dato. */
  colorClass: string
}

const GRID_COLS: Record<number, string> = {
  1: 'sm:grid-cols-1',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-4',
}

export function percentOf(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 100) : 0
}

/**
 * Distribución compacta: una barra apilada fina y, debajo, cada estado con su cantidad, su
 * porcentaje y una barra corta. Reemplaza al gráfico de columnas que se estiraba a todo el ancho y
 * quedaba enorme. El dato siempre va escrito (RNF 7.2): el color nunca es la única señal.
 */
export default function StatusDistribution({
  items,
  label,
}: Readonly<{ items: readonly DistributionItem[]; label: string }>) {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.count), 0)

  return (
    <figure aria-label={label} className="space-y-3">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden>
        {total > 0 &&
          items
            .filter((item) => item.count > 0)
            .map((item) => (
              <div key={item.key} className={item.colorClass} style={{ width: `${(item.count / total) * 100}%` }} />
            ))}
      </div>
      <dl className={`grid gap-2 ${GRID_COLS[items.length] ?? 'sm:grid-cols-3'}`}>
        {items.map((item) => {
          const pct = percentOf(item.count, total)
          return (
            <div key={item.key} className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
              <dt className="flex items-center gap-2 text-xs font-medium text-slate-600">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${item.colorClass}`} aria-hidden />
                {item.label}
              </dt>
              <dd className="mt-0.5 flex items-baseline gap-1.5">
                <span className="text-lg font-semibold tabular-nums text-slate-900">{item.count}</span>
                <span className="text-xs tabular-nums text-slate-500">{pct}%</span>
              </dd>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200/70" aria-hidden>
                <div className={`h-full rounded-full ${item.colorClass}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          )
        })}
      </dl>
    </figure>
  )
}
