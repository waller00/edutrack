'use client'

import { Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'

export type StatusSlice = {
  status: string
  count: number
  pct: number
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  PRESENT: { label: 'Presente', color: '#10b981' },
  LATE: { label: 'Tarde', color: '#f59e0b' },
  ABSENT_NOT_JUSTIFIED: { label: 'Ausente no justificado', color: '#dc2626' },
  ABSENT_JUSTIFIED: { label: 'Ausente justificado', color: '#94a3b8' },
  SUBSTITUTED: { label: 'Suplido', color: '#6366f1' },
}

/** Dona de distribución de estados de entrada sobre el total planificado. */
export default function StatusDonutChart({ rows, height = 260 }: Readonly<{ rows: StatusSlice[]; height?: number }>) {
  if (rows.length === 0) {
    return <p className="py-12 text-center text-sm text-gray-500">No hay instancias planificadas en el rango.</p>
  }

  const data = rows.map((r) => ({
    name: STATUS_META[r.status]?.label ?? r.status,
    value: r.count,
    pct: r.pct,
    fill: STATUS_META[r.status]?.color ?? '#64748b',
  }))

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="80%" paddingAngle={2} stroke="#fff" />
        <Tooltip
          formatter={(value, name, item) => {
            const pct = (item?.payload as { pct?: number } | undefined)?.pct ?? 0
            return [`${Number(value)} (${pct.toFixed(2)}%)`, name]
          }}
          contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12 }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  )
}
