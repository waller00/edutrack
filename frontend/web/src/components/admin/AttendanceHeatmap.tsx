'use client'

import { useMemo } from 'react'
import { addDaysToYmd, weekdayNumberInUruguay } from '@/lib/admin/event-occurrences'
import {
  dominantCategory,
  groupRowsByDate,
  HEATMAP_CATEGORY_STYLE,
  type AttendanceSummaryRow,
  type HeatmapCategory,
} from '@/lib/attendance/summary'

/** Columna 0=Lun … 6=Dom para un YYYY-MM-DD. */
function mondayIndex(ymd: string): number {
  const wd = weekdayNumberInUruguay(ymd) // 0=Dom … 6=Sáb
  return wd === null ? 0 : (wd + 6) % 7
}

const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const LEGEND_ORDER: HeatmapCategory[] = ['present', 'late', 'absent', 'justified', 'substituted', 'none']

function dayTooltip(ymd: string, rows: AttendanceSummaryRow[]): string {
  if (rows.length === 0) return `${ymd}: sin actividad`
  const detail = rows.map((r) => `${r.evento} — ${r.estado}`).join(' · ')
  return `${ymd}: ${detail}`
}

export default function AttendanceHeatmap({
  rows,
  from,
  to,
}: Readonly<{
  rows: AttendanceSummaryRow[]
  from: string
  to: string
}>) {
  const { days, byDate } = useMemo(() => {
    const grouped = groupRowsByDate(rows)
    if (!from || !to) return { days: [] as string[], byDate: grouped }
    const start = addDaysToYmd(from, -mondayIndex(from))
    const list: string[] = []
    let cursor = start
    // Tope defensivo: ~2 años de celdas.
    for (let i = 0; i < 740 && cursor <= to; i += 1) {
      list.push(cursor)
      cursor = addDaysToYmd(cursor, 1)
    }
    return { days: list, byDate: grouped }
  }, [rows, from, to])

  if (!from || !to || days.length === 0) {
    return <div className="text-sm text-gray-500">Sin datos para el período</div>
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2 overflow-x-auto">
        <div className="grid shrink-0 gap-1 pr-1 text-[10px] text-slate-400" style={{ gridTemplateRows: 'repeat(7, minmax(0, 1fr))' }}>
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className="flex h-3.5 items-center">
              {label}
            </div>
          ))}
        </div>
        <div
          className="grid gap-1"
          style={{ gridTemplateRows: 'repeat(7, minmax(0, 1fr))', gridAutoFlow: 'column' }}
          role="img"
          aria-label="Mapa de calor de asistencia"
        >
          {days.map((ymd) => {
            const inRange = ymd >= from && ymd <= to
            if (!inRange) {
              return <div key={ymd} className="h-3.5 w-3.5" aria-hidden />
            }
            const dayRows = byDate.get(ymd) ?? []
            const category = dominantCategory(dayRows)
            return (
              <div
                key={ymd}
                className={`h-3.5 w-3.5 rounded-sm ${HEATMAP_CATEGORY_STYLE[category].box}`}
                title={dayTooltip(ymd, dayRows)}
              />
            )
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600">
        {LEGEND_ORDER.map((cat) => (
          <div key={cat} className="flex items-center gap-1.5">
            <span className={`inline-block h-3 w-3 rounded-sm ${HEATMAP_CATEGORY_STYLE[cat].box}`} aria-hidden />
            {HEATMAP_CATEGORY_STYLE[cat].label}
          </div>
        ))}
      </div>
    </div>
  )
}
