import { redirect } from 'next/navigation'

/**
 * "Cerrar Prom. por Libreta" abría la misma pantalla que "por Alumno", que ya cierra de las dos
 * formas. Se unificaron en "Cierre de períodos"; la ruta queda para que los enlaces viejos no se rompan.
 */
export default function Page() {
  redirect('/libreta/cierre-alumno')
}
