import { useRef, useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SidePanel from './SidePanel'

function Harness({ onClose = vi.fn() }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Abrir
      </button>
      <SidePanel
        open={open}
        onClose={() => {
          onClose()
          setOpen(false)
        }}
        labelledBy="titulo"
        initialFocusRef={closeRef}
      >
        <h2 id="titulo">Panel</h2>
        <button ref={closeRef} type="button">
          Cerrar
        </button>
        <button type="button">Último</button>
      </SidePanel>
    </>
  )
}

describe('<SidePanel />', () => {
  it('es un diálogo con nombre, arranca el foco donde se pide y bloquea el scroll', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    expect(screen.getByRole('dialog', { name: 'Panel' })).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('button', { name: 'Cerrar' })).toHaveFocus()
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('Tab da la vuelta dentro del panel', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    screen.getByRole('button', { name: 'Último' }).focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(screen.getByRole('button', { name: 'Cerrar' })).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(screen.getByRole('button', { name: 'Último' })).toHaveFocus()
  })

  it('Escape lo cierra y el foco vuelve a quien lo abrió', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    const opener = screen.getByRole('button', { name: 'Abrir' })
    opener.focus()
    fireEvent.click(opener)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(opener).toHaveFocus()
    expect(document.body.style.overflow).toBe('')
  })

  it('tocar afuera lo cierra; tocar adentro no', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    fireEvent.mouseDown(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!)
    expect(onClose).toHaveBeenCalled()
  })
})
