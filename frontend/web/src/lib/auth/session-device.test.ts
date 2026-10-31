import { describe, expect, it } from 'vitest'
import { describeSessionDevice } from './session-device'

describe('describeSessionDevice', () => {
  it.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', 'Chrome en Windows'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0', 'Edge en Windows'],
    ['Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36', 'Chrome en Android'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', 'Safari en iPhone'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:131.0) Gecko/20100101 Firefox/131.0', 'Firefox en Mac'],
  ])('%s → %s', (userAgent, expected) => {
    expect(describeSessionDevice(userAgent)).toBe(expected)
  })

  it('sin datos (sesiones de antes de guardarlos) no inventa un dispositivo', () => {
    expect(describeSessionDevice(null)).toBe('Dispositivo sin identificar')
    expect(describeSessionDevice('curl/8.0')).toBe('Dispositivo sin identificar')
  })
})
