import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StaffAttendance from './staff/attendance/page'
import StaffEvents from './staff/events/page'
import StaffLicenses from './staff/licenses/page'
import StaffReportsRedirect from './staff/reports/page'
import TeacherAttendance from './teacher/attendance/page'
import TeacherEvents from './teacher/events/page'
import TeacherLicenses from './teacher/licenses/page'
import TeacherReportsRedirect from './teacher/reports/page'
import StudentAttendance from './student/attendance/page'
import LegacyRegisterRedirect from './register-step-by-step/page'

const attendanceMock = vi.fn(({ role }: { role: string }) => <div>Attendance role: {role}</div>)
const eventsMock = vi.fn(({ role }: { role: string }) => <div>Events role: {role}</div>)
const licensesMock = vi.fn(({ role }: { role: string }) => <div>Licenses role: {role}</div>)
const redirectMock = vi.fn()

vi.mock('@/components/MyAttendancePage', () => ({
  default: (props: { role: string }) => attendanceMock(props),
}))

vi.mock('@/components/MyAssignedEventsPage', () => ({
  default: (props: { role: string }) => eventsMock(props),
}))

vi.mock('@/components/MyLicensesPage', () => ({
  default: (props: { role: string }) => licensesMock(props),
}))

vi.mock('@/components/RoleGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="guard">{children}</div>,
}))

vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>()
  return {
    ...actual,
    redirect: (href: string) => redirectMock(href),
  }
})

describe('wrapper pages', () => {
  beforeEach(() => {
    attendanceMock.mockClear()
    eventsMock.mockClear()
    licensesMock.mockClear()
    redirectMock.mockClear()
  })

  it('passes the correct roles to attendance wrappers', () => {
    render(<StaffAttendance />)
    render(<TeacherAttendance />)

    expect(attendanceMock).toHaveBeenNthCalledWith(1, { role: 'STAFF' })
    expect(attendanceMock).toHaveBeenNthCalledWith(2, { role: 'TEACHER' })
  })

  it('passes the correct roles to events wrappers', () => {
    render(<StaffEvents />)
    render(<TeacherEvents />)

    expect(eventsMock).toHaveBeenNthCalledWith(1, { role: 'STAFF' })
    expect(eventsMock).toHaveBeenNthCalledWith(2, { role: 'TEACHER' })
  })

  it('passes the correct roles to licenses wrappers', () => {
    render(<StaffLicenses />)
    render(<TeacherLicenses />)

    expect(licensesMock).toHaveBeenNthCalledWith(1, { role: 'STAFF' })
    expect(licensesMock).toHaveBeenNthCalledWith(2, { role: 'TEACHER' })
  })

  it('renders the guarded student placeholder content', () => {
    render(<StudentAttendance />)

    expect(screen.getByTestId('guard')).toBeInTheDocument()
    expect(screen.getByText('Mis asistencias')).toBeInTheDocument()
    expect(screen.getByText('Tabla/Gráfico próximamente.')).toBeInTheDocument()
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

  it('redirects legacy reports pages to their attendance modules', () => {
    StaffReportsRedirect()
    TeacherReportsRedirect()

    expect(redirectMock).toHaveBeenNthCalledWith(1, '/staff/attendance')
    expect(redirectMock).toHaveBeenNthCalledWith(2, '/teacher/attendance')
  })
})
