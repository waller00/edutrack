import { redirect } from 'next/navigation'

/**
 * "Vista de grupo" era la misma matriz que "Reunión de profesores". Se unificó en esta última;
 * la ruta queda para que los enlaces viejos no se rompan.
 */
export default function Page() {
  redirect('/libreta/reunion')
}
