import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import PaginationControls from './PaginationControls'

describe('PaginationControls', () => {
  it('does not render when all items fit on one page', () => {
    const { container } = render(
      <PaginationControls page={1} total={20} onPageChange={vi.fn()} />
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('renders the current page and moves backward and forward', () => {
    const onPageChange = vi.fn()

    render(<PaginationControls page={2} total={45} pageSize={20} onPageChange={onPageChange} />)

    expect(screen.getByText('Pagina 2 de 3')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }))
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }))

    expect(onPageChange).toHaveBeenNthCalledWith(1, 1)
    expect(onPageChange).toHaveBeenNthCalledWith(2, 3)
  })

  it('disables navigation buttons at the boundaries', () => {
    const onPageChange = vi.fn()

    render(<PaginationControls page={1} total={21} pageSize={20} onPageChange={onPageChange} />)

    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Siguiente' })).not.toBeDisabled()
  })
})
