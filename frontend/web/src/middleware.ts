import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/** Rutas antiguas / inexistentes: evitan 404 y enlaces rotos en caché */
export function middleware(request: NextRequest) {
  const p = request.nextUrl.pathname
  if (p === '/teacher/reports') {
    return NextResponse.redirect(new URL('/teacher/attendance', request.url))
  }
  if (p === '/staff/reports') {
    return NextResponse.redirect(new URL('/staff/attendance', request.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/teacher/reports', '/staff/reports'],
}
