import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import RootLayout, { metadata } from './layout'

vi.mock('@/components/UserNav', () => ({
  default: () => <div data-testid="user-nav">User nav</div>,
}))

describe('RootLayout', () => {
  it('renders the shared navigation and children', () => {
    const { container } = render(
      <RootLayout>
        <div>Contenido</div>
      </RootLayout>
    )

    expect(screen.getByTestId('user-nav')).toBeInTheDocument()
    expect(screen.getByText('Contenido')).toBeInTheDocument()
    expect(container.querySelector('html')).toHaveAttribute('lang', 'es')
  })

  it('exposes the expected metadata', () => {
    expect(metadata.title).toBe('EduTrack')
    expect(metadata.description).toBe('Sistema de gestión educativa')
  })
})
