import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GradeBookAccessLog from './GradeBookAccessLog'

const apiMock = vi.fn()
vi.mock('@/lib/api/client', () => ({
  api: (...args: unknown[]) => apiMock(...args),
}))

describe('<GradeBookAccessLog />', () => {
  it('se carga al desplegarlo y lista quién abrió la libreta', async () => {
    apiMock.mockResolvedValue({
      data: [{ id: 'l-1', userName: 'Ana G', roleCode: 'TEACHER', ip: '10.0.0.1', occurredAt: '2026-05-10T15:00:00.000Z' }],
    })
    render(<GradeBookAccessLog gradeBookId="gb-1" />)
    expect(apiMock).not.toHaveBeenCalled()

    await userEvent.click(screen.getByText('Accesos a la libreta'))

    expect(apiMock).toHaveBeenCalledWith('/admin/gradebook/gradebooks/gb-1/access-log')
    expect(await screen.findByText(/Ana G/)).toBeInTheDocument()
    expect(screen.getByText(/TEACHER, 10\.0\.0\.1/)).toBeInTheDocument()
  })

  it('si nadie la abrió, lo dice; si falla, también', async () => {
    apiMock.mockResolvedValueOnce({ data: [] })
    const { unmount } = render(<GradeBookAccessLog gradeBookId="gb-1" />)
    await userEvent.click(screen.getByText('Accesos a la libreta'))
    expect(await screen.findByText('Nadie la abrió todavía.')).toBeInTheDocument()
    unmount()

    apiMock.mockRejectedValueOnce(new Error('Sin permiso'))
    render(<GradeBookAccessLog gradeBookId="gb-1" />)
    await userEvent.click(screen.getByText('Accesos a la libreta'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Sin permiso')
  })
})
