import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import LoginPage from './page'

vi.mock('@/lib/api/client', () => ({
  api: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
}))

import { api } from '@/lib/api/client'

describe('LoginPage (Keycloak)', () => {
  const locationMock = { href: '' }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api).mockRejectedValue(new Error('401'))
    locationMock.href = ''
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: locationMock,
    })
  })

  it('muestra botón Continuar que redirige al BFF', async () => {
    render(<LoginPage />)
    const btn = await screen.findByRole('button', { name: 'Continuar' })
    fireEvent.click(btn)
    expect(locationMock.href).toContain('/auth/login')
  })
})
