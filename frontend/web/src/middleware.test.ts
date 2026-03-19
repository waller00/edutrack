import { describe, expect, it } from 'vitest'
import { middleware } from './middleware'

describe('middleware', () => {
  it('redirects teacher legacy reports to attendance', () => {
    const response = middleware({
      nextUrl: { pathname: '/teacher/reports' },
      url: 'http://localhost/teacher/reports',
    } as never)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost/teacher/attendance')
  })

  it('redirects staff legacy reports to attendance', () => {
    const response = middleware({
      nextUrl: { pathname: '/staff/reports' },
      url: 'http://localhost/staff/reports',
    } as never)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('http://localhost/staff/attendance')
  })

  it('lets unrelated routes continue', () => {
    const response = middleware({
      nextUrl: { pathname: '/teacher/events' },
      url: 'http://localhost/teacher/events',
    } as never)

    expect(response.status).toBe(200)
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })
})
