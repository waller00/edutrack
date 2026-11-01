import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import OnboardingSpotlight, { findTourTarget } from './OnboardingSpotlight'

const SPOTS = [
  { target: 'demo.a', title: 'Elegí el día', text: 'Con las flechas.' },
  { target: 'demo.b', title: 'Falta en pantalla', text: 'No hay datos.' },
  { target: 'demo.c', title: 'Guardá la lista', text: 'Cuando marcaste a todos.' },
]

function Screen({ targets }: { targets: string[] }) {
  return (
    <div>
      {targets.map((target) => (
        <button key={target} type="button" data-tour={target}>
          {target}
        </button>
      ))}
    </div>
  )
}

beforeEach(() => {
  // jsdom no dibuja: un elemento "se ve" si no está oculto.
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
    return ((this as HTMLElement).closest('[hidden]') ? [] : [new DOMRect(0, 0, 10, 10)]) as unknown as DOMRectList
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('<OnboardingSpotlight />', () => {
  it('señala el primer control que está y saltea el que falta', async () => {
    render(
      <>
        <Screen targets={['demo.a', 'demo.c']} />
        <OnboardingSpotlight spots={SPOTS} onClose={vi.fn()} />
      </>,
    )

    const dialog = await screen.findByRole('dialog', { name: 'Elegí el día' })
    expect(dialog).toHaveTextContent('1 de 2')
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }))

    expect(await screen.findByRole('dialog', { name: 'Guardá la lista' })).toHaveTextContent('2 de 2')
    expect(screen.queryByText('Falta en pantalla')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Anterior/ }))
    expect(await screen.findByRole('dialog', { name: 'Elegí el día' })).toBeInTheDocument()
  })

  it('el globo de un control aparece cuando el control aparece', async () => {
    const { rerender } = render(
      <>
        <Screen targets={[]} />
        <OnboardingSpotlight spots={SPOTS} onClose={vi.fn()} />
      </>,
    )
    expect(screen.queryByRole('dialog')).toBeNull()

    rerender(
      <>
        <Screen targets={['demo.c']} />
        <OnboardingSpotlight spots={SPOTS} onClose={vi.fn()} />
      </>,
    )
    expect(await screen.findByRole('dialog', { name: 'Guardá la lista' })).toHaveTextContent('1 de 1')
  })

  it('un control oculto no cuenta', async () => {
    render(
      <>
        <div hidden>
          <button type="button" data-tour="demo.a">a</button>
        </div>
        <Screen targets={['demo.c']} />
        <OnboardingSpotlight spots={SPOTS} onClose={vi.fn()} />
      </>,
    )
    expect(await screen.findByRole('dialog', { name: 'Guardá la lista' })).toBeInTheDocument()
  })

  it('el mismo ancla dos veces (menú de escritorio y de celular): vale el que se ve', () => {
    render(
      <>
        <div hidden>
          <a href="/x" data-tour="nav:x">oculto</a>
        </div>
        <a href="/x" data-tour="nav:x">visible</a>
      </>,
    )
    expect(findTourTarget('nav:x')).toHaveTextContent('visible')
  })

  it('«Listo», «Ocultar globos» y Esc los cierran', async () => {
    const onClose = vi.fn()
    render(
      <>
        <Screen targets={['demo.c']} />
        <OnboardingSpotlight spots={SPOTS} onClose={onClose} />
      </>,
    )
    fireEvent.click(await screen.findByRole('button', { name: /Listo/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar globos' }))
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('el resaltado deja usar el control señalado', async () => {
    const onClick = vi.fn()
    render(
      <>
        <button type="button" data-tour="demo.a" onClick={onClick}>
          Anterior día
        </button>
        <OnboardingSpotlight spots={SPOTS} onClose={vi.fn()} />
      </>,
    )
    await screen.findByRole('dialog')
    expect(document.querySelector('[data-onboarding-spotlight] .pointer-events-none')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Anterior día' }))
    await waitFor(() => expect(onClick).toHaveBeenCalled())
  })
})
