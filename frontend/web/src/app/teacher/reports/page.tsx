import { redirect } from 'next/navigation'

/** Compatibilidad: antes existía el enlace; ahora redirige al módulo real */
export default function TeacherReportsRedirect() {
  redirect('/teacher/attendance')
}
