'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

export type BreakdownRow = {
  label: string
  lateRatePct: number
  aopPct: number
  plannedCount: number
}

/** Barras horizontales comparando tardanza vs ausentismo por una dimensión. */
export default function BreakdownBarChart({ rows, height }: Readonly<{ rows: BreakdownRow[]; height?: number }>) {
  if (rows.length === 0) {
    return <p className="py-10 text-center text-sm text-gray-500">Sin datos para esta dimensión en el rango.</p>
  }

  const data = rows.slice(0, 10).map((r) => ({
    label: r.label.length > 22 ? `${r.label.slice(0, 22)}…` : r.label,
    fullLabel: r.label,
    Tardanza: r.lateRatePct,
    Ausentismo: r.aopPct,
    plannedCount: r.plannedCount,
  }))

  const computedHeight = height ?? Math.max(160, data.length * 44 + 40)

  return (
    <ResponsiveContainer width="100%" height={computedHeight}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }} barCategoryGap={12}>
        <CartesianGrid strokeDasharray="4 6" stroke="#eef0f2" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}%`} />
        <YAxis
          type="category"
          dataKey="label"
          width={140}
          tick={{ fontSize: 11, fill: '#374151' }}
          tickLine={false}
          axisLine={{ stroke: '#e5e7eb' }}
        />
        <Tooltip
          formatter={(value, name) => [`${Number(value).toFixed(2)}%`, name]}
          labelFormatter={(_label, payload) => {
            const row = payload?.[0]?.payload as { fullLabel?: string; plannedCount?: number } | undefined
            return row ? `${row.fullLabel} · ${row.plannedCount} planificadas` : ''
          }}
          contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12 }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="Tardanza" fill="#f59e0b" radius={[0, 4, 4, 0]} />
        <Bar dataKey="Ausentismo" fill="#dc2626" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
