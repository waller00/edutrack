import { describe, it, expect, afterEach } from 'vitest'
import { apiBaseUrl } from './base-url'

const ORIGINAL = process.env.NEXT_PUBLIC_API_URL

afterEach(() => {
  process.env.NEXT_PUBLIC_API_URL = ORIGINAL
})

describe('apiBaseUrl', () => {
  it('usa el default cuando no hay env', () => {
    delete process.env.NEXT_PUBLIC_API_URL
    expect(apiBaseUrl()).toBe('http://localhost:4000')
  })

  it('respeta NEXT_PUBLIC_API_URL y recorta barras finales', () => {
    process.env.NEXT_PUBLIC_API_URL = 'https://api.edutrack-uy.com///'
    expect(apiBaseUrl()).toBe('https://api.edutrack-uy.com')
  })
})
