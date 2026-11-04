import { describe, expect, it } from 'vitest'
import { defaultMyAttendanceRange, myAttendanceTiles } from './my-attendance-range'

describe('el período de Mis asistencias', () => {
  it('el ciclo lectivo hasta hoy; entre ciclos, el año calendario', () => {
    expect(defaultMyAttendanceRange({ from: '2026-03-02', to: '2026-12-15' }, '2026-11-04')).toEqual({ from: '2026-03-02', to: '2026-11-04' })
    expect(defaultMyAttendanceRange({ from: '2025-03-03', to: '2025-12-12' }, '2026-02-10')).toEqual({ from: '2025-03-03', to: '2025-12-12' })
    expect(defaultMyAttendanceRange({ from: '2026-03-02', to: '2026-12-15' }, '2026-02-10')).toEqual({ from: '2026-01-01', to: '2026-02-10' })
    expect(defaultMyAttendanceRange(null, '2026-11-04')).toEqual({ from: '2026-01-01', to: '2026-11-04' })
  })
})

describe('los números del resumen', () => {
  const stats = {
    esperadas: 40,
    presente: 30,
    tarde: 6,
    ausenteJustificado: 2,
    ausenteNoJustificado: 1,
    suplido: 1,
    cobertura: 0,
    pctPuntualidad: 0,
    pctAsistencia: 0,
    pctAusentismo: 0,
    horasTrabajadas: 52.5,
    horasPlanificadas: 60,
    deltaHoras: -7.5,
    minTardeAcumulados: 48,
    minTardePromedio: 8,
  }

  it('cada uno con su base, y las clases cubiertas aparte', () => {
    const tiles = myAttendanceTiles(stats, { classes: 3, hours: 4.5 })
    expect(tiles.map((t) => [t.label, t.value])).toEqual([
      ['Asistencia', '90 %'],
      ['Puntualidad', '83,3 %'],
      ['Faltas', '4'],
      ['Horas', '52,5 h'],
      ['Clases que cubriste', '3'],
    ])
    expect(tiles[0].detail).toBe('36 de 40 clases y turnos con entrada marcada.')
    expect(tiles[1].detail).toBe('30 de 36 a tiempo; 6 tarde (48 min en total).')
    expect(tiles[2].detail).toBe('1 sin justificar, 2 justificadas y 1 con suplente.')
    expect(myAttendanceTiles(stats, { classes: 0, hours: 0 })).toHaveLength(4)
    expect(myAttendanceTiles({ ...stats, esperadas: 0, presente: 0, tarde: 0 }, null)[0].value).toBe('—')
  })
})
