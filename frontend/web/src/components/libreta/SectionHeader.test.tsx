import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import SectionHeader from './SectionHeader'
import { sectionById } from '@/lib/libreta/menu'

describe('<SectionHeader />', () => {
  it('repite el título y la explicación de la sección', () => {
    render(<SectionHeader id="desarrollo" />)

    const section = sectionById('desarrollo')!
    expect(screen.getByRole('heading', { name: section.label })).toBeInTheDocument()
    expect(screen.getByText(section.hint)).toBeInTheDocument()
  })

  it('no rompe si el id no está en el catálogo', () => {
    // @ts-expect-error el tipo lo impide, pero una ruta vieja puede colarse en runtime.
    const { container } = render(<SectionHeader id="inexistente" />)
    expect(container).toBeEmptyDOMElement()
  })
})
