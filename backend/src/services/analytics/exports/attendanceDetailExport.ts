import ExcelJS from 'exceljs'
import type { ResolvedAttendanceByInstance } from '../models.js'

const COLUMNS = [
  'Fecha',
  'Tipo',
  'Estado',
  'Hora Registro',
  'Usuario ID',
  'Usuario',
  'Rol',
  'Evento ID',
  'Evento',
  'Turno/Tipo Evento',
  'Instancia Planificada ID',
  'Hora Planificada Inicio',
  'Hora Real Entrada',
  'Hora Real Salida',
  'Duración Real (min)',
  'Brecha (min)',
  'Horas (min) Incompletas',
  'Notas',
  'Licencia Asociada ID',
  'Licencia Asociada Estado',
] as const

function safeIso(d: Date | null) {
  return d ? d.toISOString() : ''
}

function brechaMinutes(plannedStart: Date | null, actualIn: Date | null) {
  if (!plannedStart || !actualIn) return 0
  return (actualIn.getTime() - plannedStart.getTime()) / (1000 * 60)
}

function csvEscape(v: unknown) {
  const s = String(v ?? '')
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function toLicenseEstado(isJustifiedAbsence: boolean) {
  return isJustifiedAbsence ? 'ACTIVE' : ''
}

export function buildAttendanceDetailRows(resolvedInstances: ResolvedAttendanceByInstance[]) {
  const rows: Record<string, unknown>[] = []

  for (const i of resolvedInstances) {
    const plannedStartIso = safeIso(i.planned.plannedStartTime)
    const plannedEndIso = safeIso(i.planned.plannedEndTime)
    const actualInIso = safeIso(i.actualInTime)
    const actualOutIso = safeIso(i.actualOutTime)
    const brecha = brechaMinutes(i.planned.plannedStartTime, i.actualInTime)
    const incompleteMinutes = i.hasCheckIn && !i.hasCheckOut ? i.durationMinutes : 0

    const licenciaId = i.licenseIdJustifying || ''
    const licenciaEstado = toLicenseEstado(i.isJustifiedAbsence)

    const base = {
      Fecha: i.planned.plannedDate,
      'Usuario ID': i.planned.userIdRequired || '',
      Usuario: i.userDisplayName,
      Rol: i.userRole,
      'Evento ID': i.planned.eventId,
      Evento: i.planned.eventTitle,
      'Turno/Tipo Evento': i.planned.eventType,
      'Instancia Planificada ID': i.planned.plannedInstanceId,
      'Hora Planificada Inicio': plannedStartIso,
      'Hora Real Entrada': actualInIso,
      'Hora Real Salida': actualOutIso || plannedEndIso,
      'Duración Real (min)': Number(i.durationMinutes.toFixed(2)),
      'Brecha (min)': Number(brecha.toFixed(2)),
      'Horas (min) Incompletas': Number(incompleteMinutes.toFixed(2)),
      Notas: '',
      'Licencia Asociada ID': licenciaId,
      'Licencia Asociada Estado': licenciaEstado,
    } as const

    rows.push({
      ...base,
      Tipo: 'CHECK_IN',
      Estado: i.checkInStatusResolved,
      'Hora Registro': i.hasCheckIn ? actualInIso : '',
      Notas: i.checkInNotes || '',
    })

    rows.push({
      ...base,
      Tipo: 'CHECK_OUT',
      Estado: i.checkOutStatusResolved,
      'Hora Registro': i.hasCheckOut ? actualOutIso : '',
      Notas: i.checkOutNotes || '',
    })
  }

  // Orden determinístico: Fecha asc, Tipo (CHECK_IN antes), Usuario ID, Hora Registro (si existe)
  rows.sort((a, b) => {
    const fa = String(a['Fecha'])
    const fb = String(b['Fecha'])
    if (fa !== fb) return fa.localeCompare(fb)
    const ta = String(a['Tipo'])
    const tb = String(b['Tipo'])
    if (ta !== tb) return ta.localeCompare(tb)
    const ua = String(a['Usuario ID'])
    const ub = String(b['Usuario ID'])
    if (ua !== ub) return ua.localeCompare(ub)
    const ha = String(a['Hora Registro'])
    const hb = String(b['Hora Registro'])
    if (ha === hb) return 0
    if (!ha) return 1
    if (!hb) return -1
    return ha.localeCompare(hb)
  })

  return rows
}

export async function generateAttendanceDetailXlsx(params: {
  resolvedInstances: ResolvedAttendanceByInstance[]
}) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Asistencia_Detallada')
  const rows = buildAttendanceDetailRows(params.resolvedInstances)

  sheet.addRow([...COLUMNS])
  for (const r of rows) {
    sheet.addRow(COLUMNS.map((c) => r[c]))
  }

  // Estilos mínimos para legibilidad.
  sheet.columns.forEach((col) => {
    if (typeof col.width === 'number') return
    col.width = 18
  })
  sheet.getRow(1).font = { bold: true }

  return workbook.xlsx.writeBuffer()
}

export function generateAttendanceDetailCsv(params: {
  resolvedInstances: ResolvedAttendanceByInstance[]
}) {
  const rows = buildAttendanceDetailRows(params.resolvedInstances)
  const header = COLUMNS.map((c) => c).join(',')
  const lines = rows.map((r) => COLUMNS.map((c) => csvEscape(r[c])).join(','))
  return `${header}\n${lines.join('\n')}\n`
}
