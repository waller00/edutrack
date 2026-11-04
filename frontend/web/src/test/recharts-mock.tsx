import type { ReactNode } from 'react'

/**
 * Recharts no dibuja en jsdom (mide el contenedor). Las pantallas se prueban por sus números y
 * tablas, no por el SVG: los contenedores dejan pasar a sus hijos y las marcas no dibujan nada.
 *
 *   vi.mock('recharts', async () => (await import('@/test/recharts-mock')).rechartsMock)
 */
const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>
const Mark = () => null

export const rechartsMock = {
  ResponsiveContainer: Container,
  BarChart: Container,
  LineChart: Container,
  Bar: Mark,
  Line: Mark,
  Cell: Mark,
  CartesianGrid: Mark,
  Legend: Mark,
  Tooltip: Mark,
  XAxis: Mark,
  YAxis: Mark,
}
