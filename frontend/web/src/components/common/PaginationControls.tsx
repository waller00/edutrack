'use client'

type PaginationControlsProps = {
  page: number
  total: number
  pageSize?: number
  onPageChange: (nextPage: number) => void
}

export default function PaginationControls({
  page,
  total,
  pageSize = 20,
  onPageChange,
}: PaginationControlsProps) {
  if (total <= pageSize) return null

  const totalPages = Math.ceil(total / pageSize)

  return (
    <div className="border-t bg-gray-50 px-4 py-3 sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-gray-700">
          Pagina {page} de {totalPages}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page === 1}
            className="px-3 py-1 border rounded disabled:opacity-50"
          >
            Anterior
          </button>
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            className="px-3 py-1 border rounded disabled:opacity-50"
          >
            Siguiente
          </button>
        </div>
      </div>
    </div>
  )
}
