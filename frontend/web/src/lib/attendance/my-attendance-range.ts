import { formatCount, formatRatio } from '@/lib/format/percent'
import type { AttendanceSummaryStats } from './summary'

/**
 * El período con que abre «Mis asistencias»: el ciclo lectivo hasta hoy. Antes arrancaba el 1 de
 * enero, y en verano mostraba días sin clases como si fueran parte del año. Sin ciclo activo (entre
 * ciclos), el año calendario.
 */
export function defaultMyAttendanceRange(schoolYear: { from: string; to: string } | null, todayYmd: string): { from: string; to: string } {
  if (schoolYear && schoolYear.from <= todayYmd) return { from: schoolYear.from, to: schoolYear.to < todayYmd ? schoolYear.to : todayYmd }
  return { from: `${todayYmd.slice(0, 4)}-01-01`, to: todayYmd }
}

export type MyAttendanceTile = { label: string; value: string; detail: string }

const hours = (value: number) => `${String(value).replace('.', ',')} h`

/**
 * Los números del resumen, cada uno con de cuántos sale. Son los propios (`ownStats`): las clases
 * que cubrió como suplente van aparte, porque si no la asistencia no era de lo suyo.
 */
export function myAttendanceTiles(stats: AttendanceSummaryStats, coverage: { classes: number; hours: number } | null | undefined): MyAttendanceTile[] {
  const attended = stats.presente + stats.tarde
  const absences = stats.ausenteNoJustificado + stats.ausenteJustificado + stats.suplido
  const tiles: MyAttendanceTile[] = [
    {
      label: 'Asistencia',
      value: formatRatio(attended, stats.esperadas),
      detail: `${formatCount(attended)} de ${formatCount(stats.esperadas)} clases y turnos con entrada marcada.`,
    },
    {
      label: 'Puntualidad',
      value: formatRatio(stats.presente, attended),
      detail: `${formatCount(stats.presente)} de ${formatCount(attended)} a tiempo; ${formatCount(stats.tarde)} tarde (${formatCount(stats.minTardeAcumulados)} min en total).`,
    },
    {
      label: 'Faltas',
      value: formatCount(absences),
      detail: `${formatCount(stats.ausenteNoJustificado)} sin justificar, ${formatCount(stats.ausenteJustificado)} justificadas y ${formatCount(stats.suplido)} con suplente.`,
    },
    {
      label: 'Horas',
      value: hours(stats.horasTrabajadas),
      detail: `De ${hours(stats.horasPlanificadas)} planificadas.`,
    },
  ]
  if (coverage && coverage.classes > 0) {
    tiles.push({
      label: 'Clases que cubriste',
      value: formatCount(coverage.classes),
      detail: `${hours(coverage.hours)} como suplente. No cuentan en la asistencia de arriba.`,
    })
  }
  return tiles
}
