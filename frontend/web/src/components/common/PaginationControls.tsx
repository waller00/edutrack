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
    <div className="px-6 py-3 border-t bg-gray-50">
      <div className="flex justify-between items-center">
        <div className="text-sm text-gray-700">
          Pagina {page} de {totalPages}
        </div>
        <div className="flex gap-2">
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
