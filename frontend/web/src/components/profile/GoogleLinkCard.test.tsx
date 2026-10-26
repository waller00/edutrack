import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GoogleLinkCard from './GoogleLinkCard'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({
  api: vi.fn(),
}))

const mockedApi = vi.mocked(api)

describe('GoogleLinkCard', () => {
  beforeEach(() => {
    mockedApi.mockReset()
  })

  it('sin Google vinculado ofrece vincularlo, con el reingreso que pide el backend', async () => {
    mockedApi.mockResolvedValueOnce({ linked: false, account: null })
    render(<GoogleLinkCard />)

    expect(await screen.findByRole('link', { name: 'Vincular con Google' })).toHaveAttribute(
      'href',
      'http://localhost:4000/auth/account/link-google',
    )
    expect(screen.getByText('Sin vincular')).toBeInTheDocument()
    expect(screen.getByText(/aunque tu Gmail no sea el correo de EduTrack/)).toBeInTheDocument()
    expect(mockedApi).toHaveBeenCalledWith('/auth/account/google-status')
  })

  it('con Google vinculado dice con qué cuenta entra y no ofrece volver a vincular', async () => {
    mockedApi.mockResolvedValueOnce({ linked: true, account: 'ana@gmail.com' })
    render(<GoogleLinkCard />)

    expect(await screen.findByText('Vinculado')).toBeInTheDocument()
    expect(screen.getByText(/«Continuar con Google» \(ana@gmail\.com\)/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Vincular con Google' })).not.toBeInTheDocument()
  })

  it('si no se puede consultar lo dice, sin ofrecer un botón a ciegas', async () => {
    mockedApi.mockRejectedValueOnce(new Error('503'))
    render(<GoogleLinkCard />)

    expect(await screen.findByText(/No pudimos consultar/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Vincular con Google' })).not.toBeInTheDocument()
  })
})
