import { redirect } from 'next/navigation'

/**
 * "Visado de libretas" se unió con el control: es el último paso de "Control y visado de
 * libretas". La ruta queda para que los enlaces viejos no se rompan.
 */
export default function Page() {
  redirect('/libreta/control?paso=visado')
}
