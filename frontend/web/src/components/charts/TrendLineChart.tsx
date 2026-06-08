'use client'

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

export type TrendPoint = {
  period: string
  lateRate: number
  aop: number
  coverage: number
}

function shortDate(isoDate: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (!m) return isoDate
  return `${m[3]}/${m[2]}`
}

const SERIES = [
  { key: 'lateRate', name: 'Tardanza', color: '#ea580c' },
  { key: 'aop', name: 'Ausentismo', color: '#dc2626' },
  { key: 'coverage', name: 'Cobertura', color: '#059669' },
] as const

/** Tendencia multi-serie (tardanza/ausentismo/cobertura) sobre el período seleccionado. */
export default function TrendLineChart({ points, height = 280 }: Readonly<{ points: TrendPoint[]; height?: number }>) {
  if (points.length === 0) {
    return <p className="py-12 text-center text-sm text-gray-500">No hay datos suficientes para graficar en el rango.</p>
  }

  const data = points.map((p) => ({ ...p, label: shortDate(p.period) }))

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: -8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="4 6" stroke="#e8e8e8" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#4b5563' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
        <YAxis
          tick={{ fontSize: 11, fill: '#64748b' }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${v}%`}
          width={44}
        />
        <Tooltip
          formatter={(value, name) => [`${Number(value).toFixed(2)}%`, name]}
          labelFormatter={(label) => `Período ${String(label)}`}
          contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12 }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {SERIES.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={s.color}
            strokeWidth={2.5}
            dot={{ r: 3, strokeWidth: 2, fill: '#fff' }}
            activeDot={{ r: 5 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
