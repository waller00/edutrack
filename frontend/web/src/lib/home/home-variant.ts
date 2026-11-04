import { hasPermission } from '@/lib/auth/permissions'
import { hasOwnTeachingWork, type NavViewer } from '@/lib/navigation/modules'

/**
 * Qué Inicio le toca a cada uno:
 * - `team`: quien ve el centro entero (las clases del día, lo que necesita atención);
 * - `teacher`: el docente, con «Mi día»;
 * - `own`: Personal, con sus accesos y su agenda.
 */
export type HomeVariant = 'team' | 'teacher' | 'own'

export function homeVariant(me: NavViewer): HomeVariant {
  if (hasPermission(me, 'analytics.read', 'all')) return 'team'
  return hasOwnTeachingWork(me) ? 'teacher' : 'own'
}
