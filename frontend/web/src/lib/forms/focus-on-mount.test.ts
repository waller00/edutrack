import { describe, expect, it } from 'vitest'
import { focusOnMount } from './focus-on-mount'

describe('focusOnMount', () => {
  it('enfoca el campo al montarse y no falla al desmontarse', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    focusOnMount(input)
    expect(document.activeElement).toBe(input)
    expect(() => focusOnMount(null)).not.toThrow()
    input.remove()
  })
})
