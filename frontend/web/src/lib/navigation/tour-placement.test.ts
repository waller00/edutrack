import { describe, expect, it } from 'vitest'
import { EDGE, placePopover } from './tour-placement'

const VIEWPORT = { width: 1280, height: 800 }
const POPOVER = { width: 320, height: 160 }

describe('placePopover', () => {
  it('va abajo del control, centrado, si entra', () => {
    const anchor = { top: 100, left: 400, width: 200, height: 40 }
    expect(placePopover(anchor, POPOVER, VIEWPORT)).toEqual({ side: 'bottom', top: 152, left: 340 })
  })

  it('si abajo no entra, va arriba', () => {
    const anchor = { top: 700, left: 400, width: 200, height: 40 }
    expect(placePopover(anchor, POPOVER, VIEWPORT)).toMatchObject({ side: 'top', top: 700 - 12 - 160 })
  })

  it('no se sale por los costados', () => {
    const atLeft = placePopover({ top: 100, left: 0, width: 40, height: 40 }, POPOVER, VIEWPORT)
    expect(atLeft.left).toBe(EDGE)
    const atRight = placePopover({ top: 100, left: 1260, width: 20, height: 40 }, POPOVER, VIEWPORT)
    expect(atRight.left).toBe(1280 - 320 - EDGE)
  })

  it('un control alto prueba los costados', () => {
    const anchor = { top: 20, left: 100, width: 300, height: 760 }
    expect(placePopover(anchor, POPOVER, VIEWPORT)).toMatchObject({ side: 'right', left: 412 })
  })

  it('si el control ocupa toda la ventana, el globo queda adentro, abajo a la derecha', () => {
    const anchor = { top: 0, left: 0, width: 1280, height: 800 }
    expect(placePopover(anchor, POPOVER, VIEWPORT)).toEqual({ side: 'bottom', top: 800 - 160 - EDGE, left: 1280 - 320 - EDGE })
  })

  it('en una pantalla angosta va abajo, como hoja fija', () => {
    const anchor = { top: 100, left: 20, width: 200, height: 40 }
    expect(placePopover(anchor, POPOVER, { width: 375, height: 700 })).toEqual({ side: 'dock', top: 700 - 160 - EDGE, left: EDGE })
  })
})
