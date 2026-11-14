import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReportDownloadMenu from './ReportDownloadMenu'
import { downloadFile } from '@/lib/api/download'

vi.mock('@/lib/api/download', () => ({ downloadFile: vi.fn() }))

const mockedDownload = vi.mocked(downloadFile)

function renderMenu(props: Partial<Parameters<typeof ReportDownloadMenu>[0]> = {}) {
  return render(
    <ReportDownloadMenu
      pathFor={(format) => `/analytics/report?format=${format}`}
      fallbackName={(format) => `Informe.${format}`}
      note="Todas las secciones que ves."
      {...props}
    />,
  )
}

const trigger = () => screen.getByRole('button', { name: 'Descargar informe' })

beforeEach(() => {
  vi.clearAllMocks()
  mockedDownload.mockResolvedValue(undefined)
})

describe('Descargar informe', () => {
  it('ofrece PDF y Excel, y baja el elegido con los filtros de la pantalla', async () => {
    renderMenu()
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(trigger())
    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Todas las secciones que ves.')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /Excel con los datos/ }))
    await waitFor(() => expect(mockedDownload).toHaveBeenCalledWith('/analytics/report?format=xlsx', 'Informe.xlsx'))
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Descargar informe' })).not.toBeInTheDocument())
  })

  it('mientras genera, dice que está generando y no deja pedir otro', async () => {
    let finish: () => void = () => undefined
    mockedDownload.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)))
    renderMenu()
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('button', { name: /PDF para imprimir/ }))
    expect(await screen.findByText('Generando…')).toBeVisible()
    expect(screen.getByRole('button', { name: /Excel con los datos/ })).toBeDisabled()
    finish()
    await waitFor(() => expect(screen.queryByText('Generando…')).not.toBeInTheDocument())
  })

  it('si falla, lo dice en el mismo panel', async () => {
    mockedDownload.mockRejectedValue(new Error('No tenés permiso para descargar este archivo.'))
    renderMenu()
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('button', { name: /PDF para imprimir/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No tenés permiso para descargar este archivo.')
    expect(screen.getByRole('group', { name: 'Descargar informe' })).toBeVisible()
  })

  it('Escape cierra y devuelve el foco al botón', () => {
    renderMenu()
    fireEvent.click(trigger())
    fireEvent.keyDown(screen.getByRole('button', { name: /PDF para imprimir/ }), { key: 'Escape' })
    expect(screen.queryByRole('group', { name: 'Descargar informe' })).not.toBeInTheDocument()
    expect(trigger()).toHaveFocus()
  })

  it('un clic afuera lo cierra', () => {
    renderMenu()
    fireEvent.click(trigger())
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('group', { name: 'Descargar informe' })).not.toBeInTheDocument()
  })

  it('deshabilitado mientras la pantalla no sabe qué mostrar', () => {
    renderMenu({ disabled: true })
    expect(trigger()).toBeDisabled()
  })
})
