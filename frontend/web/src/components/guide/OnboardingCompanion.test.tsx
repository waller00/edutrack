import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OnboardingCompanion from './OnboardingCompanion'

const { state, hideSpots, showSpots } = vi.hoisted(() => ({
  state: { pathname: '/me/roll-call', spotsHidden: [] as string[] },
  hideSpots: vi.fn(),
  showSpots: vi.fn(),
}))

vi.mock('next/navigation', () => ({ usePathname: () => state.pathname, useRouter: () => ({ push: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }))
// El globo se prueba aparte: acá sólo importa cuándo se monta y con qué.
vi.mock('./OnboardingSpotlight', () => ({
  default: ({ spots, onClose }: { spots: { title: string }[]; onClose: () => void }) => (
    <div data-testid="globos">
      {spots.map((spot) => spot.title).join(', ')}
      <button type="button" onClick={onClose}>
        cerrar globos
      </button>
    </div>
  ),
}))

const STEP = {
  task: 'Conocé el pase de lista',
  instructions: 'Elegí una clase.',
  module: { id: 'roll-call', href: '/me/roll-call', label: 'Pase de lista', description: 'Tus listas.' },
  scopeLabel: 'Tu cuenta y lo asignado a vos',
  actions: [],
  spots: [
    { target: 'roll-call.day', title: 'Elegí el día', text: '…' },
    { target: 'roll-call.save', title: 'Guardá la lista', text: '…' },
  ],
}

vi.mock('./useOnboarding', () => ({
  useOnboarding: () => ({
    ready: true,
    steps: [STEP],
    current: STEP,
    completed: [],
    pending: [STEP],
    progress: { active: true, spotsHidden: state.spotsHidden },
    complete: vi.fn(),
    pause: vi.fn(),
    hideSpots,
    showSpots,
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  state.pathname = '/me/roll-call'
  state.spotsHidden = []
})

describe('<OnboardingCompanion />', () => {
  it('en la pantalla del paso arrancan los globos, y se ocultan para ese paso', () => {
    render(<OnboardingCompanion />)
    expect(screen.getByTestId('globos')).toHaveTextContent('Elegí el día, Guardá la lista')

    fireEvent.click(screen.getByRole('button', { name: 'Ocultar globos' }))
    expect(hideSpots).toHaveBeenCalledWith('roll-call')

    fireEvent.click(screen.getByRole('button', { name: 'cerrar globos' }))
    expect(hideSpots).toHaveBeenCalledTimes(2)
  })

  it('ocultos, no vuelven solos pero se pueden pedir', () => {
    state.spotsHidden = ['roll-call']
    render(<OnboardingCompanion />)
    expect(screen.queryByTestId('globos')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Mostrarme en la pantalla' }))
    expect(showSpots).toHaveBeenCalledWith('roll-call')
  })

  it('fuera de la pantalla del paso no hay globos: ofrece ir', () => {
    state.pathname = '/profile'
    render(<OnboardingCompanion />)
    expect(screen.queryByTestId('globos')).toBeNull()
    expect(screen.queryByRole('button', { name: /globos|Mostrarme/ })).toBeNull()
    expect(screen.getByRole('link', { name: 'Ir a Pase de lista' })).toHaveAttribute('href', '/me/roll-call')
  })
})
