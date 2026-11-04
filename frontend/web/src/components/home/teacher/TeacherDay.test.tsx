import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TeacherDay from './TeacherDay'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
vi.mock('@/contexts/AuthContext', () => ({
  useOptionalAuth: () => ({
    me: {
      id: 't1',
      permissions: [
        { id: 'student-attendance.take', scope: 'own' },
        { id: 'gradebook.read', scope: 'own' },
      ],
    },
  }),
}))
vi.mock('@/lib/hooks/useNow', () => ({ useNow: () => new Date('2026-11-04T15:00:00.000Z') }))
const mockedApi = vi.mocked(api)

const lesson = (eventId: string, startAt: string, endAt: string, rollCall: Record<string, unknown> = {}) => ({
  eventId,
  ymd: '2026-11-04',
  title: 'Clase',
  subject: eventId === 'mat' ? 'Matemática' : 'Física',
  course: '1.º A',
  orientation: null,
  startAt,
  endAt,
  teacher: { id: 't1', name: 'Yo' },
  substitute: null,
  isSubstitution: false,
  nonWorkingDay: null,
  rollCall: {
    sessionId: null,
    status: 'PENDING',
    takenAt: null,
    takenBy: null,
    rosterSize: 30,
    canEdit: true,
    blockedReason: null,
    opensAt: new Date(new Date(startAt).getTime() - 600_000).toISOString(),
    editableUntil: '2026-11-11T12:00:00.000Z',
    ...rollCall,
  },
})

const meeting = (periodId: string, status: string, missing: unknown[] | null = []) => ({
  periodId,
  name: '2.ª Entrega',
  kind: 'ENTREGA',
  sortOrder: 30,
  reportCard: true,
  judgementLabel: null,
  closesOn: '2026-11-14',
  status,
  closedAt: null,
  closedLate: false,
  reopenReason: null,
  missing,
  review: null,
})

beforeEach(() => {
  mockedApi.mockReset()
  mockedApi.mockImplementation(async (path: string) => {
    if (path.startsWith('/student-attendance/my-classes')) {
      return [
        lesson('mat', '2026-11-04T11:00:00.000Z', '2026-11-04T12:00:00.000Z', { status: 'TAKEN', takenAt: '2026-11-04T11:15:00.000Z' }),
        lesson('fis', '2026-11-04T13:00:00.000Z', '2026-11-04T14:00:00.000Z'),
      ] as never
    }
    if (path === '/student-attendance/mine/pending') {
      return {
        windowHours: 72,
        data: [
          {
            eventId: 'quim',
            ymd: '2026-11-03',
            title: 'Química',
            subject: 'Química',
            course: '2.º B',
            orientation: null,
            startAt: '2026-11-03T13:00:00.000Z',
            endAt: '2026-11-03T14:00:00.000Z',
            editableUntil: '2026-11-06T14:00:00.000Z',
            sessionId: null,
            daysLate: 1,
            covered: false,
            titular: null,
          },
        ],
      } as never
    }
    if (path === '/gradebook/mine/summary') {
      return {
        data: [
          { gradeBookId: 'gb-a', role: 'OWNER', meetings: [meeting('e2', 'CLOSED', null)], students: [] },
          {
            gradeBookId: 'gb-b',
            role: 'OWNER',
            meetings: [meeting('e2', 'OPEN', [{ code: 'MISSING_GRADES', studentIds: ['s1'] }])],
            students: [{ studentId: 's1', lastName: 'Pérez', firstName: 'Ana' }],
          },
        ],
      } as never
    }
    if (path === '/gradebook/mine/indicators') {
      return {
        data: [
          {
            gradeBookId: 'gb-b',
            attendance: { classesWithRollCall: 20, marks: 600, absent: 24, justified: 6, late: 12 },
            grades: { reference: { periodId: 'e1', name: '1.ª Entrega', closed: true }, graded: 30, alert: 4 },
            evolution: null,
          },
        ],
      } as never
    }
    if (path === '/gradebook/mine') {
      const header = (id: string, code: string) => ({
        id,
        status: 'ACTIVE',
        schoolYear: { id: 'y', code: 2026, label: '2026' },
        course: { id: id, name: code, code, level: 'EBI' },
        courseOfferingId: 'o',
        orientation: null,
        subject: { id: 's', name: 'Matemática', code: null },
        teacher: { id: 't1', name: 'Yo', username: 'yo' },
      })
      return { data: [header('gb-a', '1-A'), header('gb-b', '1-B')] } as never
    }
    throw new Error(`sin respuesta para ${path}`)
  })
})

describe('<TeacherDay />', () => {
  it('las clases de hoy con su lista y cuántas van pasadas', async () => {
    render(<TeacherDay />)
    const today = (await screen.findByRole('heading', { name: 'Tus clases de hoy' })).closest('section')!
    expect(await within(today).findByText('Listas pasadas: 1 de 2')).toBeInTheDocument()
    expect(within(today).getByRole('link', { name: 'Pasar lista' })).toHaveAttribute('href', '/me/roll-call/fis/2026-11-04')
    expect(within(today).getByRole('link', { name: 'Ver lista' })).toHaveAttribute('href', '/me/roll-call/mat/2026-11-04')
  })

  it('las listas atrasadas, con hasta cuándo se pueden pasar', async () => {
    render(<TeacherDay />)
    const overdue = (await screen.findByRole('heading', { name: 'Listas atrasadas' })).closest('section')!
    expect(await within(overdue).findByText('Vence el vie 6/11 a las 11:00')).toBeInTheDocument()
    expect(within(overdue).getByText(/el plazo es de 3 días/)).toBeInTheDocument()
    expect(within(overdue).getByRole('link', { name: 'Pasar lista' })).toHaveAttribute('href', '/me/roll-call/quim/2026-11-03')
  })

  it('las reuniones por cerrar: cuántas cerró y qué le falta a cada libreta', async () => {
    render(<TeacherDay />)
    const closings = (await screen.findByRole('heading', { name: 'Reuniones por cerrar' })).closest('section')!
    expect(await within(closings).findByText(/1 de 2 libretas cerradas/)).toBeInTheDocument()
    expect(within(closings).getByText('· 1 sin R (rendimiento): Pérez, Ana')).toBeInTheDocument()
    expect(within(closings).getByRole('link', { name: 'Completar' })).toHaveAttribute('href', '/libreta/gb-b/cierre?periodId=e2')
    // Cada dato se pide una sola vez aunque lo usen dos bloques.
    expect(mockedApi.mock.calls.filter(([path]) => path === '/gradebook/mine/summary')).toHaveLength(1)
  })

  it('tus grupos, con lo esencial del seguimiento de cada uno', async () => {
    render(<TeacherDay />)
    const groups = (await screen.findByRole('heading', { name: 'Tus grupos' })).closest('section')!
    expect(await within(groups).findByText('asistencia 95 % · 4 de 30 con R en alerta')).toBeInTheDocument()
    expect(within(groups).getByRole('link', { name: 'Ver seguimiento' })).toHaveAttribute('href', '/libreta/gb-b/seguimiento')
  })
})

