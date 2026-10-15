import { fireEvent, render, screen } from '@testing-library/react'
import GuideWelcomeBanner, { GUIDE_DISMISSED_KEY } from '@/components/guide/GuideWelcomeBanner'

describe('GuideWelcomeBanner', () => {
  beforeEach(() => {
    globalThis.localStorage.clear()
  })

  it('invita a la guía y, al cerrarlo, no vuelve', async () => {
    const { unmount } = render(<GuideWelcomeBanner />)
    expect(await screen.findByRole('link', { name: 'Ver la guía' })).toHaveAttribute('href', '/guia')

    fireEvent.click(screen.getByRole('button', { name: 'No mostrar más' }))
    expect(screen.queryByRole('complementary', { name: 'Guía para empezar' })).not.toBeInTheDocument()
    expect(globalThis.localStorage.getItem(GUIDE_DISMISSED_KEY)).toBe('1')

    unmount()
    render(<GuideWelcomeBanner />)
    expect(screen.queryByRole('link', { name: 'Ver la guía' })).not.toBeInTheDocument()
  })

  it('sin storage se sigue viendo y cerrar no rompe', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado')
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado')
    })
    render(<GuideWelcomeBanner />)
    expect(await screen.findByRole('link', { name: 'Ver la guía' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'No mostrar más' }))
    expect(screen.queryByRole('link', { name: 'Ver la guía' })).not.toBeInTheDocument()
    getItem.mockRestore()
    setItem.mockRestore()
  })
})
