/**
 * Reuniones de boletín (EBI: 1.ª a 4.ª Entrega; EMS: semestres), como las devuelve
 * `GET /admin/gradebook/periods?reportCard=true`. Las usan el control de libretas y los reportes.
 */
export type ReportCardPeriod = {
  id: string
  name: string
  level: 'EBI' | 'EMS' | null
  closesOn: string | null
}

export const LEVEL_LABEL: Record<string, string> = { EBI: 'Ciclo básico', EMS: 'Bachillerato' }

export const REPORT_CARD_PERIODS_PATH = '/admin/gradebook/periods?reportCard=true'

/** Para los `<optgroup>`: cada nivel tiene sus propias reuniones. */
export function groupByLevel<T extends { level: string | null }>(periods: readonly T[]): [string, T[]][] {
  const groups = new Map<string, T[]>()
  for (const p of periods) {
    const key = p.level ?? 'OTRO'
    groups.set(key, [...(groups.get(key) ?? []), p])
  }
  return [...groups]
}

/**
 * La reunión que viene: la primera cuyo plazo todavía no pasó. Si ya pasaron todas, la última.
 */
export function nextMeeting<T extends { closesOn: string | null }>(periods: readonly T[], todayYmd: string): T | null {
  const upcoming = periods
    .filter((p) => p.closesOn && p.closesOn.slice(0, 10) >= todayYmd)
    .sort((a, b) => String(a.closesOn).localeCompare(String(b.closesOn)))
  return upcoming[0] ?? periods.at(-1) ?? null
}

/** La última reunión cuyo plazo ya pasó: la que tiene R para reportar. Si ninguna pasó, la primera. */
export function lastClosedMeeting<T extends { closesOn: string | null }>(periods: readonly T[], todayYmd: string): T | null {
  const past = periods
    .filter((p) => p.closesOn && p.closesOn.slice(0, 10) < todayYmd)
    .sort((a, b) => String(b.closesOn).localeCompare(String(a.closesOn)))
  return past[0] ?? periods[0] ?? null
}
