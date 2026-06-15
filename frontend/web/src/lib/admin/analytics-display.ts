/** Badge del puntaje de prioridad (riesgo) de una persona: rojo / ámbar / verde. */
export function getRiskScoreBadgeClass(score: number): string {
  if (score > 8) return 'bg-red-50 text-red-800'
  if (score > 3) return 'bg-amber-50 text-amber-900'
  return 'bg-emerald-50 text-emerald-900'
}
