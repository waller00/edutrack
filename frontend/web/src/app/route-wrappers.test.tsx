import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StaffAttendance from './staff/attendance/page'
import StaffEvents from './staff/events/page'
import StaffLicenses from './staff/licenses/page'
import TeacherAttendance from './teacher/attendance/page'
import TeacherEvents from './teacher/events/page'
import TeacherLicenses from './teacher/licenses/page'
import StudentAttendance from './student/attendance/page'
import LegacyRegisterRedirect from './register-step-by-step/page'

const redirectMock = vi.fn()
const routerReplaceMock = vi.fn()

vi.mock('@/components/auth/RoleGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="guard">{children}</div>,
}))

vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>()
  return {
    ...actual,
    redirect: (href: string) => redirectMock(href),
    useRouter: () => ({ replace: routerReplaceMock }),
  }
})

describe('wrapper pages', () => {
  beforeEach(() => {
    redirectMock.mockClear()
    routerReplaceMock.mockClear()
  })

  it('redirects legacy attendance routes (teacher/staff) to /me/attendance', async () => {
    render(<StaffAttendance />)
    render(<TeacherAttendance />)

    await waitFor(() => expect(routerReplaceMock).toHaveBeenCalledWith('/me/attendance'))
    expect(routerReplaceMock).toHaveBeenCalledTimes(2)
  })

  it('redirects legacy events routes (teacher/staff) to /me/events', async () => {
    render(<StaffEvents />)
    render(<TeacherEvents />)

    await waitFor(() => expect(routerReplaceMock).toHaveBeenCalledWith('/me/events'))
    expect(routerReplaceMock).toHaveBeenCalledTimes(2)
  })

  it('redirects legacy licenses routes (teacher/staff) to /me/licenses', async () => {
    render(<StaffLicenses />)
    render(<TeacherLicenses />)

    await waitFor(() => expect(routerReplaceMock).toHaveBeenCalledWith('/me/licenses'))
    expect(routerReplaceMock).toHaveBeenCalledTimes(2)
  })

  it('redirects the legacy student attendance route to /me/roll-call', async () => {
    render(<StudentAttendance />)

    await waitFor(() => expect(routerReplaceMock).toHaveBeenCalledWith('/me/roll-call'))
  })

  it('redirects the legacy register route to the unified register page', async () => {
    const replace = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { replace },
    })

    render(<LegacyRegisterRedirect />)

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/register'))
  })

})
