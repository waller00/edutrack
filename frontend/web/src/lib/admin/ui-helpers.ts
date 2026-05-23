/** Banner éxito/error en pantallas admin (licencias, eventos, asistencias). */
export function getAdminFlashMessageClass(message: string): string {
  return message.includes('✅') ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
}
