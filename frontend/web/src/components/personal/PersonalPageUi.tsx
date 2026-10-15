import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'

export function PersonalLoading() {
  return (
    <p
      role="status"
      className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500"
    >
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      Cargando...
    </p>
  )
}

export function PersonalError({
  message,
  retry,
}: {
  message: string
  retry: () => void
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
    >
      <p>{message}</p>
      <button type="button" onClick={retry} className="font-medium underline">
        Reintentar
      </button>
    </div>
  )
}

export function PersonalPagination({
  page,
  total,
  onPage,
}: {
  page: number
  total: number
  onPage: (page: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / 20))
  if (pages === 1) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
      <p>
        {(page - 1) * 20 + 1}–{Math.min(page * 20, total)} de {total}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page === 1}
          onClick={() => onPage(page - 1)}
          className="flex items-center rounded-lg border bg-white p-2 disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          Anterior
        </button>
        <span>
          {page} / {pages}
        </span>
        <button
          type="button"
          disabled={page === pages}
          onClick={() => onPage(page + 1)}
          className="flex items-center rounded-lg border bg-white p-2 disabled:opacity-40"
        >
          Siguiente
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  )
}
