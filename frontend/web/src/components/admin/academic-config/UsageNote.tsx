'use client'

type Item = { count: number; one: string; many: string }

/**
 * "Usado en N …" debajo del estado.
 *
 * Está para que la consecuencia de tocar una fila sea visible **antes** de tocarla: desactivar un
 * período que sostiene libretas cerradas, o reescribir los tramos de una escala que ya tiene notas,
 * no es lo mismo que hacerlo sobre una fila que nadie usó todavía.
 */
export default function UsageNote({ items }: { items: readonly Item[] }) {
  const used = items.filter((item) => item.count > 0)
  if (used.length === 0) return <span className="mt-0.5 block text-[11px] text-gray-400">Sin uso todavía</span>

  return (
    <span className="mt-0.5 block text-[11px] text-gray-500">
      {used.map((item) => `${item.count} ${item.count === 1 ? item.one : item.many}`).join(' · ')}
    </span>
  )
}
