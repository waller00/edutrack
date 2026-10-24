/**
 * Piezas compartidas por los datasets de demo.
 *
 * Nacieron dentro de `seed-demo-2025.ts`. Cuando apareció el segundo dataset —el ciclo en curso,
 * con datos hasta hoy— había dos opciones: copiar 300 líneas o sacarlas acá. Copiarlas significaba
 * que un arreglo en el generador de horarios quedara aplicado a un ciclo y no al otro.
 *
 * Todo lo de este archivo es **determinista**: las mismas claves producen siempre los mismos
 * números, así una demo se puede volver a sembrar y las pantallas muestran los mismos totales.
 */
import crypto from 'node:crypto'
import { DateTime } from 'luxon'
import type { User } from '@prisma/client'
import { TEACHER_SPECIALTIES, type TeacherSpecialty, type TeacherSpecialtyArea } from '../data/teacher-specialties.js'
import { getAppTimezone, uruguayWallToUtc } from '../../src/config/app-timezone.js'

/** Las seis horas de clase del turno matutino. */
export const CLASS_SLOTS = [
  { start: [7, 30], end: [8, 15] },
  { start: [8, 20], end: [9, 5] },
  { start: [9, 20], end: [10, 5] },
  { start: [10, 10], end: [10, 55] },
  { start: [11, 10], end: [11, 55] },
  { start: [12, 0], end: [12, 45] },
] as const

// ---------------------------------------------------------------------------- azar determinista

export function stableHash(input: string) {
  let h = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
export function ratio(key: string) {
  return (stableHash(key) % 10_000) / 10_000
}
export function intBetween(key: string, min: number, max: number) {
  return min + (stableHash(key) % (max - min + 1))
}
export function pick<T>(items: readonly T[], key: string): T {
  return items[stableHash(key) % items.length]
}

/** Cédula uruguaya con dígito verificador válido: la UI la valida al editar al alumno. */
export function buildValidCi(baseNumber: number) {
  const base7 = String(Math.abs(baseNumber) % 9_999_999).padStart(7, '0')
  const weights = [2, 9, 8, 7, 6, 3, 4]
  const sum = base7.split('').reduce((acc, digit, index) => acc + Number(digit) * weights[index], 0)
  const checkDigit = (10 - (sum % 10)) % 10
  return `${base7}${checkDigit}`
}

export function sha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

// ---------------------------------------------------------------------------- fechas

/** Día civil uruguayo a medianoche local, como lo guarda el resto del repo. */
export function ymdToDate(ymd: string) {
  return uruguayWallToUtc(ymd, 0, 0)
}
export function wall(ymd: string, hour: number, minute: number) {
  return uruguayWallToUtc(ymd, hour, minute)
}
export function minutesToWall(ymd: string, minutes: number) {
  const normalized = Math.max(0, Math.min(23 * 60 + 59, minutes))
  return wall(ymd, Math.floor(normalized / 60), normalized % 60)
}
export function toYmd(date: Date) {
  return DateTime.fromJSDate(date, { zone: 'utc' }).setZone(getAppTimezone()).toFormat('yyyy-MM-dd')
}
export function wallMinutesFromStoredTime(date: Date) {
  const wallTime = DateTime.fromJSDate(date, { zone: 'utc' }).setZone(getAppTimezone())
  return wallTime.hour * 60 + wallTime.minute
}
/** Día de la semana con domingo = 0, como `Event.daysOfWeek`. */
export function weekday(ymd: string) {
  return DateTime.fromISO(ymd, { zone: getAppTimezone() }).weekday % 7
}
export function eachYmd(start: string, end: string) {
  const days: string[] = []
  let cursor = DateTime.fromISO(start, { zone: getAppTimezone() }).startOf('day')
  const final = DateTime.fromISO(end, { zone: getAppTimezone() }).startOf('day')
  while (cursor <= final) {
    days.push(cursor.toFormat('yyyy-MM-dd'))
    cursor = cursor.plus({ days: 1 })
  }
  return days
}
// ---------------------------------------------------------------------------- especialidades

export function normalizedText(value: string) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

export function subjectArea(subjectName: string): TeacherSpecialtyArea {
  const s = normalizedText(subjectName)
  if (s.includes('matematica') || s.includes('contabilidad') || s.includes('economia') || s.includes('administracion')) return 'matematica'
  // Educación Física va **antes** que ciencias: "Educación Física y Recreación" contiene "física",
  // y mientras se evaluó después, esa asignatura caía en ciencias y los profesores de educación
  // física se quedaban sin horas.
  if (s.includes('educacion fisica') || s.includes('deporte') || s.includes('recreacion')) return 'educacion_fisica'
  if (s.includes('fisica') || s.includes('quimica') || s.includes('biologia') || s.includes('astronomia')) return 'ciencias'
  if (s.includes('computacion') || s.includes('tecnologias digitales')) return 'informatica'
  if (s.includes('historia') || s.includes('filosofia') || s.includes('derecho') || s.includes('sociologia') || s.includes('geografia') || s.includes('ciudadana') || s.includes('metodologia')) return 'humanidades'
  if (s.includes('ingles') || s.includes('literatura') || s.includes('espanol')) return 'lenguas'
  if (s.includes('arte') || s.includes('musica') || s.includes('danza') || s.includes('teatro') || s.includes('visual') || s.includes('diseño') || s.includes('diseno')) return 'arte'
  return 'gestion'
}

type TeacherIdentity = Pick<User, 'username' | 'email'>

export function specialtyForTeacher(teacher: TeacherIdentity): TeacherSpecialty | null {
  const username = teacher.username?.toLowerCase()
  if (username && TEACHER_SPECIALTIES[username]) return TEACHER_SPECIALTIES[username]
  return TEACHER_SPECIALTIES[teacher.email.toLowerCase()] ?? null
}

export function teacherLabel(teacher: Pick<User, 'username' | 'email' | 'name'>) {
  return teacher.username ?? teacher.email ?? teacher.name ?? 'docente-sin-identificador'
}

export function teacherCanTeachSubject(teacher: TeacherIdentity, subjectName: string) {
  const specialty = specialtyForTeacher(teacher)
  if (!specialty) return false
  const normalizedSubject = normalizedText(subjectName)
  return (
    specialty.areas.includes(subjectArea(subjectName)) ||
    (specialty.subjects ?? []).some((subject) => normalizedText(subject) === normalizedSubject)
  )
}

export function assertTeacherSpecialties(teachers: Array<Pick<User, 'username' | 'email' | 'name'>>) {
  if (teachers.length === 0) throw new Error('[demo] No hay docentes activos con TeacherProfile activo.')
  const missing = teachers.filter((teacher) => !specialtyForTeacher(teacher)).map(teacherLabel)
  if (missing.length > 0) throw new Error(`[demo] Faltan especialidades docentes para: ${missing.join(', ')}`)
}

// ---------------------------------------------------------------------------- horario

type Docente = Pick<User, 'id' | 'username' | 'email'>

/**
 * Armador de horario: reparte las asignaturas de cada grupo en las franjas libres y les pone un
 * docente que pueda dictarlas y no esté ocupado en esa hora.
 *
 * Un planificador por ciclo. El grupo no puede tener dos clases en la misma franja y el docente no
 * puede estar en dos aulas a la vez, y esas dos reglas se sostienen entre todas las clases del
 * ciclo, así que el estado vive acá y no en cada llamada.
 */
export function crearPlanificadorDeHorario(docentes: readonly Docente[]) {
  const docenteOcupado = new Set<string>()
  const grupoOcupado = new Set<string>()
  const carga = new Map(docentes.map((docente) => [docente.id, 0]))

  /** Días de la semana de una asignatura: una fija y, cada tres, una segunda hora. */
  function diasDeClase(indiceAsignatura: number, ordenCurso: number, corrimiento: number) {
    const primero = 1 + ((indiceAsignatura + ordenCurso + corrimiento) % 5)
    const segundo = indiceAsignatura % 3 === 0 ? 1 + ((primero + 2) % 5) : null
    return Array.from(new Set([primero, ...(segundo ? [segundo] : [])]))
  }

  function reservarFranja(p: { grupo: string; ordenCurso: number; indiceAsignatura: number }) {
    const base = (p.indiceAsignatura + p.ordenCurso) % CLASS_SLOTS.length
    for (let intento = 0; intento < CLASS_SLOTS.length * 5; intento += 1) {
      const franja = (base + intento) % CLASS_SLOTS.length
      const corrimiento = Math.floor(intento / CLASS_SLOTS.length)
      const dias = diasDeClase(p.indiceAsignatura, p.ordenCurso, corrimiento)
      if (!dias.some((dia) => grupoOcupado.has(`${p.grupo}:${dia}:${franja}`))) {
        dias.forEach((dia) => grupoOcupado.add(`${p.grupo}:${dia}:${franja}`))
        return { franja, dias }
      }
    }
    return null
  }

  /**
   * Docente de una clase. `fijo` es la designación que ya tomó el liceo (y entonces manda sobre la
   * especialidad); si no está libre en esa franja, se elige al compatible con menos horas.
   */
  function elegirDocente(p: { asignatura: string; dias: number[]; franja: number; fijo?: string | null }) {
    const libre = (candidato: Docente) => p.dias.every((dia) => !docenteOcupado.has(`${candidato.id}:${dia}:${p.franja}`))

    const designado = p.fijo ? docentes.find((docente) => docente.id === p.fijo) : undefined
    const candidatos = designado && libre(designado) ? [designado] : docentes.filter((docente) => teacherCanTeachSubject(docente, p.asignatura) && libre(docente))
    if (candidatos.length === 0) return null

    candidatos.sort((a, b) => {
      const diferenciaDeCarga = (carga.get(a.id) ?? 0) - (carga.get(b.id) ?? 0)
      if (diferenciaDeCarga !== 0) return diferenciaDeCarga
      return stableHash(`${p.asignatura}-${a.id}`) - stableHash(`${p.asignatura}-${b.id}`)
    })
    const elegido = candidatos[0]
    p.dias.forEach((dia) => docenteOcupado.add(`${elegido.id}:${dia}:${p.franja}`))
    carga.set(elegido.id, (carga.get(elegido.id) ?? 0) + p.dias.length)
    return elegido
  }

  return { reservarFranja, elegirDocente, carga }
}
