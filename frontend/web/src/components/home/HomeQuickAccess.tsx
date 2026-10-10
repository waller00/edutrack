'use client'

import Link from 'next/link'
import SettingsDetails from '@/components/admin/settings/SettingsDetails'
import { ArrowRight } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { hasAnyPermission, hasPermission, permissionScope } from '@/lib/auth/permissions'

export default function HomeQuickAccess() {
  const { me } = useAuth()
  const own = (id: string) => permissionScope(me, id) === 'own'
  const entries = [
    {
      label: 'Mi agenda',
      description: 'Tus próximas actividades.',
      href: '/me/events',
      show: hasPermission(me, 'events.read'),
    },
    {
      label: 'Mis asistencias',
      description: 'Historial y resumen del período.',
      href: '/me/attendance',
      show: hasPermission(me, 'attendance.read'),
    },
    {
      label: 'Mis licencias',
      description: 'Licencias registradas a tu nombre.',
      href: '/me/licenses',
      show: hasPermission(me, 'licenses.read'),
    },
    {
      label: own('gradebook.read') ? 'Mis Libretas' : 'Libretas',
      description: 'Grupos, evaluaciones y seguimiento.',
      href: '/libreta',
      show: hasPermission(me, 'gradebook.read'),
    },
    {
      label: 'Pase de lista',
      description: 'Asistencia de tus clases.',
      href: '/me/roll-call',
      show: hasPermission(me, 'student-attendance.take'),
    },
    {
      label: 'Inteligencia académica',
      description: 'Indicadores de aprendizaje.',
      href: '/libreta/indicadores',
      show: hasPermission(me, 'academic-analytics.read', 'all'),
    },
    {
      label: 'Cursos',
      description: 'Cursos, asignaturas y orientaciones.',
      href: '/admin/courses',
      show:
        hasPermission(me, 'courses.read') ||
        hasPermission(me, 'courses.manage', 'all'),
    },
    {
      label: 'Control de libretas',
      description: 'Avance y observaciones del centro.',
      href: '/libreta/control',
      show: hasPermission(me, 'gradebook.review', 'all'),
    },
    {
      label: 'Visado de libretas',
      description: 'Consultar y revisar los visados.',
      href: '/libreta/visado',
      show: hasPermission(me, 'gradebook.read', 'all'),
    },
    {
      label: 'Asistencia de estudiantes',
      description: 'Justificaciones, faltas seguidas y 18/25 faltas.',
      href: '/admin/student-attendance',
      show: hasAnyPermission(
        me,
        ['student-attendance.justify', 'student-attendance.manage', 'student-reports.read'],
        'all',
      ),
    },
    {
      label: 'Usuarios',
      description: 'Cuentas y solicitudes de acceso.',
      href: '/admin/users',
      show: hasPermission(me, 'users.read', 'all'),
    },
    {
      label: 'Ciclos lectivos',
      description: 'Organización de los ciclos.',
      href: '/admin/school-years',
      show: hasPermission(me, 'school-years.manage', 'all'),
    },
    {
      label: 'Estudiantes',
      description: 'Datos y seguimiento de estudiantes.',
      href: '/admin/students',
      show: hasPermission(me, 'students.manage', 'all'),
    },
    {
      label: 'Mensualidades',
      description: 'Pagos y estados de cuenta.',
      href: '/admin/tuition',
      show: hasPermission(me, 'students.manage', 'all'),
    },
    {
      label: 'Configuración de libreta',
      description: 'Períodos, escalas y criterios.',
      href: '/libreta/configuracion',
      show: hasPermission(me, 'academic-config.manage', 'all'),
    },
    {
      label: 'Configuración del sistema',
      description: 'Preferencias de la institución.',
      href: '/admin/settings',
      show: hasPermission(me, 'settings.manage', 'all'),
    },
  ].filter((entry) => entry.show)
  const renderLinks = (items: typeof entries) => (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((entry) => (
        <Link
          key={entry.href}
          href={entry.href}
          className="group rounded-xl border border-slate-200 bg-white p-4 transition hover:border-emerald-400"
        >
          <span className="flex items-center justify-between gap-2 text-sm font-medium text-slate-900">
            {entry.label}
            <ArrowRight
              className="h-4 w-4 shrink-0 text-emerald-600"
              aria-hidden
            />
          </span>
          <span className="mt-1 block text-xs text-slate-500">
            {entry.description}
          </span>
        </Link>
      ))}
    </div>
  )
  return (
    <section aria-label="Accesos rápidos" className="space-y-3">
      <h2 className="text-sm font-semibold text-slate-700">Accesos rápidos</h2>
      {renderLinks(entries.slice(0, 6))}
      {entries.length > 6 && (
        <SettingsDetails
          title="Más accesos"
          description="Consultá el resto de los módulos disponibles para tu perfil."
        >
          {renderLinks(entries.slice(6))}
        </SettingsDetails>
      )}
      {entries.length === 0 && (
        <p className="rounded-xl border bg-white p-4 text-sm text-slate-500">
          Tu perfil todavía no tiene módulos habilitados. Podés consultar y
          completar tus datos en{' '}
          <Link
            href="/profile"
            className="font-medium text-emerald-700 underline"
          >
            Mi perfil
          </Link>
          .
        </p>
      )}
    </section>
  )
}
