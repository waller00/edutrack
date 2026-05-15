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

const attendanceMock = vi.fn(() => <div>Attendance page</div>)
const eventsMock = vi.fn(() => <div>Events page</div>)
const licensesMock = vi.fn(() => <div>Licenses page</div>)
const redirectMock = vi.fn()

vi.mock('@/components/MyAttendancePage', () => ({
  default: () => attendanceMock(),
}))

vi.mock('@/components/MyAssignedEventsPage', () => ({
  default: () => eventsMock(),
}))

vi.mock('@/components/MyLicensesPage', () => ({
  default: () => licensesMock(),
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

  it('renders attendance compatibility wrappers without role-specific props', () => {
    render(<StaffAttendance />)
    render(<TeacherAttendance />)

    expect(attendanceMock).toHaveBeenCalledTimes(2)
  })

  it('renders events compatibility wrappers without role-specific props', () => {
    render(<StaffEvents />)
    render(<TeacherEvents />)

    expect(eventsMock).toHaveBeenCalledTimes(2)
  })

  it('renders licenses compatibility wrappers without role-specific props', () => {
    render(<StaffLicenses />)
    render(<TeacherLicenses />)

    expect(licensesMock).toHaveBeenCalledTimes(2)
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

})
