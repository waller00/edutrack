import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import UserNav from './UserNav'
import { AuthProvider } from '@/contexts/AuthContext'
import { api } from '@/lib/api/client'

const mockUsePathname = vi.fn()

const routerPush = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  usePathname: () => mockUsePathname(),
  useRouter: () => ({ push: routerPush, replace: vi.fn() }),
}))

vi.mock('@/lib/api/client', () => ({
  api: vi.fn(),
}))

vi.mock('@/lib/observability/user-session', () => ({
  identifyObservabilityUser: vi.fn(),
  clearObservabilityUser: vi.fn(),
}))

function renderNav() {
  return render(
    <AuthProvider>
      <UserNav />
    </AuthProvider>,
  )
}

/**
 * Mock de api resuelto por URL (no por orden de llamada). Evita flakiness:
 * el componente dispara /auth/me y /notifications/in-app/summary desde
 * efectos independientes, y bajo CI el orden/cantidad puede variar.
 */
function mockApiByUrl(me: Record<string, unknown> | Error, unreadCount = 0) {
  vi.mocked(api).mockImplementation(async (url: string) => {
    const u = String(url)
    if (u.includes('/auth/me')) {
      if (me instanceof Error) throw me
      return me
    }
    if (u.includes('/notifications/in-app/summary')) return { unreadCount, items: [] }
    return {}
  })
}

describe('UserNav', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset()
    mockUsePathname.mockReset()
    mockUsePathname.mockReturnValue('/dashboard')
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { href: 'http://localhost/dashboard' },
    })
  })

  it('shows auth links when there is no session on a public path', async () => {
    mockUsePathname.mockReturnValue('/login')
    mockApiByUrl(new Error('unauthorized'))

    renderNav()

    await waitFor(() => expect(screen.getByRole('link', { name: 'Iniciar Sesión' })).toBeInTheDocument())

    expect(screen.queryByRole('button', { name: /volver/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Registrarse' })).toBeInTheDocument()
  })

  it('hides the public header on a protected path while the guard redirects', async () => {
    mockUsePathname.mockReturnValue('/admin/attendance')
    mockApiByUrl(new Error('unauthorized'))

    render(
      <AuthProvider>
        <UserNav>
          <div>placeholder del guard</div>
        </UserNav>
      </AuthProvider>,
    )

    await waitFor(() => expect(screen.getByText('placeholder del guard')).toBeInTheDocument())

    expect(screen.queryByRole('link', { name: 'Iniciar Sesión' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Registrarse' })).not.toBeInTheDocument()
  })

  it('no muestra barra de módulos; campana y menú de usuario para docente aprobado', async () => {
    mockApiByUrl({
      role: 'TEACHER',
      name: 'Ana',
      email: 'ana@example.com',
      isApproved: true,
      isActive: true,
      needsProfileCompletion: false,
    })

    renderNav()

    // La inicial está en el botón de cuenta y en el usuario al pie del menú.
    expect((await screen.findAllByText('A')).length).toBeGreaterThan(0)
    expect(screen.queryByText('Mis asistencias')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /avisos/i })).toBeInTheDocument()
  })

  it('los avisos están en la campana, no en el menú lateral', async () => {
    mockApiByUrl(
      {
        role: 'TEACHER',
        name: 'Ana',
        email: 'ana@example.com',
        isApproved: true,
        isActive: true,
        needsProfileCompletion: false,
        permissions: [{ id: 'notifications.read', scope: 'own' }],
      },
      3,
    )

    renderNav()

    expect(await screen.findByRole('button', { name: 'Avisos, 3 sin leer' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Notificaciones' })).not.toBeInTheDocument()
  })

  it('admin puede abrir menú y cerrar sesión', async () => {
    mockUsePathname.mockReturnValue('/login')
    mockApiByUrl({
      role: 'ADMIN',
      email: 'admin@example.com',
      isApproved: true,
      isActive: true,
      needsProfileCompletion: false,
      permissions: [{ id: 'settings.manage', scope: 'all' }],
    })

    renderNav()

    expect(await screen.findByText('admin@example.com')).toBeInTheDocument()
    expect(screen.queryByText('Usuarios')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /volver/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /admin@example.com/i }))
    const menuLinks = screen.getAllByRole('link')
    expect(menuLinks.map((link) => link.textContent?.trim()).slice(-3)).toEqual([
      'Mi perfil',
      'Guía de EduTrack',
      'Configuración del sistema',
    ])
    expect(screen.getByRole('link', { name: /configuración del sistema/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /cerrar sesión/i }))

    await waitFor(() => expect(globalThis.location.href).toContain('/auth/logout'))
  })

  it('does not show protected modules for users without access', async () => {
    mockApiByUrl({
      role: 'ADMIN',
      email: 'admin@example.com',
      isApproved: false,
      isActive: true,
      needsProfileCompletion: true,
    })

    renderNav()

    await screen.findByText('admin@example.com')
    expect(screen.queryByText('Usuarios')).not.toBeInTheDocument()
  })

  it('admin con permisos globales no ve atajos "Mis…" de otros roles en el menú lateral', async () => {
    mockUsePathname.mockReturnValue('/admin/licenses')
    mockApiByUrl({
      role: 'ADMIN',
      name: 'Admin',
      email: 'admin@example.com',
      isApproved: true,
      isActive: true,
      needsProfileCompletion: false,
      permissions: [
        { id: 'attendance.read', scope: 'all' },
        { id: 'events.read', scope: 'all' },
        { id: 'licenses.read', scope: 'all' },
        { id: 'users.read', scope: 'all' },
      ],
    })

    renderNav()

    await screen.findByRole('link', { name: 'Licencias' })
    expect(screen.queryByRole('link', { name: 'Mis licencias' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Mis asistencias' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Mi agenda' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Eventos asignados' })).not.toBeInTheDocument()
    // Dice de quién es: "Asistencias" a secas se confundía con la de los estudiantes.
    expect(screen.getAllByRole('link', { name: 'Asistencia del personal' })).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Asistencia del personal' })).toHaveAttribute('href', '/admin/attendance')
  })

  it('muestra módulos por permiso aunque el rol no sea ADMIN', async () => {
    mockUsePathname.mockReturnValue('/admin/users')
    mockApiByUrl({
      role: 'STAFF',
      email: 'staff@example.com',
      isApproved: true,
      isActive: true,
      needsProfileCompletion: false,
      permissions: [{ id: 'users.read', scope: 'all' }],
    })

    renderNav()

    expect((await screen.findAllByText('staff@example.com')).length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'Usuarios' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Cursos' })).not.toBeInTheDocument()
  })
})

describe('UserNav: menú lateral que se contrae', () => {
  const ADMIN = {
    role: 'ADMIN',
    name: 'Admin',
    email: 'admin@example.com',
    isApproved: true,
    isActive: true,
    needsProfileCompletion: false,
    permissions: [
      { id: 'users.read', scope: 'all' },
      { id: 'gradebook.read', scope: 'all' },
    ],
  }

  beforeEach(() => {
    vi.mocked(api).mockReset()
    mockUsePathname.mockReset()
    mockUsePathname.mockReturnValue('/admin/users')
    globalThis.localStorage.clear()
    mockApiByUrl(ADMIN)
  })

  it('se contrae a íconos y lo recuerda', async () => {
    renderNav()
    await screen.findByRole('link', { name: 'Usuarios' })

    fireEvent.click(screen.getByRole('button', { name: 'Contraer menú lateral' }))

    expect(screen.getByRole('button', { name: 'Expandir menú lateral' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Personal: abrir el menú' })).toBeInTheDocument()
    // El panel del costado tiene los ítems del grupo, para llegar sin abrir el menú.
    expect(screen.getByRole('link', { name: 'Usuarios' })).toHaveAttribute('href', '/admin/users')
    expect(screen.queryByText('Panel de trabajo')).not.toBeInTheDocument()
    expect(globalThis.localStorage.getItem('edutrack.sidebar.collapsed')).toBe('1')
  })

  it('arranca contraído si así lo dejó (los enlaces recargan la página)', async () => {
    globalThis.localStorage.setItem('edutrack.sidebar.collapsed', '1')
    renderNav()

    expect(await screen.findByRole('button', { name: 'Expandir menú lateral' })).toBeInTheDocument()
  })

  it('el clic en un ícono abre el menú con ese grupo desplegado', async () => {
    globalThis.localStorage.setItem('edutrack.sidebar.collapsed', '1')
    renderNav()

    fireEvent.click(await screen.findByRole('button', { name: 'Libretas: abrir el menú' }))

    expect(screen.getByRole('button', { name: 'Contraer menú lateral' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Libretas' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: 'Visado de libretas' })).toBeInTheDocument()
    expect(globalThis.localStorage.getItem('edutrack.sidebar.collapsed')).toBe('0')
  })

  it('recuerda los grupos que el usuario despliega', async () => {
    const { unmount } = renderNav()
    await screen.findByRole('link', { name: 'Usuarios' })

    fireEvent.click(screen.getByRole('button', { name: 'Libretas' }))
    expect(screen.getByRole('link', { name: 'Reunión de profesores' })).toBeInTheDocument()
    expect(JSON.parse(globalThis.localStorage.getItem('edutrack.sidebar.openGroups') ?? '{}')).toMatchObject({
      Libretas: true,
    })
    unmount()

    // Al recargar (otro clic en el menú), el grupo sigue abierto.
    renderNav()
    expect(await screen.findByRole('link', { name: 'Reunión de profesores' })).toBeInTheDocument()
  })
})

it.each(['TEACHER', 'INSPECCION', 'COORDINADOR'])('muestra cursos por permiso de lectura y libretas según alcance para %s', async role => {
  mockUsePathname.mockReturnValue('/admin/courses')
  mockApiByUrl({ role, isActive: true, isApproved: true, permissions: [{ id: 'courses.read', scope: 'all' }, { id: 'gradebook.read', scope: role === 'TEACHER' ? 'own' : 'all' }] })
  globalThis.localStorage.clear()
  renderNav()
  expect(await screen.findByRole('link', { name: 'Cursos' })).toHaveAttribute('href', '/admin/courses')
  // El docente tiene sus libretas en "Mi trabajo"; quien ve todas, en el grupo "Libretas".
  fireEvent.click(screen.getByRole('button', { name: role === 'TEACHER' ? 'Mi trabajo' : 'Libretas' }))
  expect(screen.getByRole('link', { name: role === 'TEACHER' ? 'Mis libretas' : 'Libretas' })).toHaveAttribute('href', '/libreta')
  expect(screen.queryByRole('link', { name: 'Configuración de libreta' })).not.toBeInTheDocument()
})

it('docente: la libreta es una sola entrada; sus secciones están en el menú de cada libreta', async () => {
  mockUsePathname.mockReturnValue('/libreta')
  mockApiByUrl({
    role: 'TEACHER',
    isActive: true,
    isApproved: true,
    permissions: [
      { id: 'gradebook.read', scope: 'own' },
      { id: 'gradebook.close', scope: 'own' },
    ],
  })
  globalThis.localStorage.clear()
  renderNav()

  expect(await screen.findByRole('link', { name: 'Mis libretas' })).toHaveAttribute('href', '/libreta')
  for (const name of ['Evaluaciones', 'Inasistencias de Libreta', 'Cierre de períodos']) {
    expect(screen.queryByRole('link', { name })).not.toBeInTheDocument()
  }
})

it('adscripción: las faltas en Asistencia de estudiantes, las notas en Rendimiento académico, sin "Reportes"', async () => {
  mockUsePathname.mockReturnValue('/admin/student-attendance')
  mockApiByUrl({
    role: 'ADSCRIPTO',
    isActive: true,
    isApproved: true,
    permissions: [
      { id: 'student-attendance.justify', scope: 'all' },
      { id: 'student-reports.read', scope: 'all' },
      { id: 'gradebook.read', scope: 'all' },
    ],
  })
  globalThis.localStorage.clear()
  renderNav()

  expect(await screen.findByRole('link', { name: 'Asistencia de estudiantes' })).toHaveAttribute(
    'href',
    '/admin/student-attendance',
  )
  fireEvent.click(screen.getByRole('button', { name: 'Libretas' }))
  expect(screen.getByRole('link', { name: 'Rendimiento académico' })).toHaveAttribute('href', '/libreta/indicadores')
  expect(screen.queryByRole('link', { name: 'Reportes de estudiantes' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^Reportes/ })).not.toBeInTheDocument()
})

it('el primer elemento del teclado salta el menú y lleva al contenido', async () => {
  mockUsePathname.mockReturnValue('/')
  mockApiByUrl({ role: 'TEACHER', isActive: true, isApproved: true, permissions: [] })
  globalThis.localStorage.clear()
  renderNav()

  const skip = await screen.findByRole('link', { name: 'Saltar al contenido' })
  expect(skip).toHaveAttribute('href', '#contenido-principal')
  expect(document.getElementById('contenido-principal')).toHaveAttribute('tabindex', '-1')
})

it('el menú va por destinatario: lo propio, el personal y los estudiantes no se mezclan', async () => {
  mockUsePathname.mockReturnValue('/')
  mockApiByUrl({
    role: 'ADMIN',
    isActive: true,
    isApproved: true,
    permissions: [
      { id: 'attendance.read', scope: 'all' },
      { id: 'student-attendance.manage', scope: 'all' },
      { id: 'students.manage', scope: 'all' },
    ],
  })
  globalThis.localStorage.clear()
  renderNav()

  fireEvent.click(await screen.findByRole('button', { name: 'Personal' }))
  fireEvent.click(screen.getByRole('button', { name: 'Estudiantes' }))
  const staffGroup = document.getElementById('nav-group-personal')!
  const studentsGroup = document.getElementById('nav-group-estudiantes')!
  expect(staffGroup).toHaveTextContent('Asistencia del personal')
  expect(staffGroup).not.toHaveTextContent('Asistencia de estudiantes')
  expect(studentsGroup).toHaveTextContent('Asistencia de estudiantes')
  expect(studentsGroup).not.toHaveTextContent('Asistencia del personal')
})
