import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import ResetPage from './page'

describe('ResetPage', () => {
  const locationMock = { replace: vi.fn() }

  beforeEach(() => {
    locationMock.replace.mockClear()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: locationMock,
    })
  })

  it('redirige al login Keycloak', () => {
    render(<ResetPage />)
    expect(locationMock.replace).toHaveBeenCalled()
    expect(screen.getByText(/Redirigiendo/i)).toBeInTheDocument()
  })
})
