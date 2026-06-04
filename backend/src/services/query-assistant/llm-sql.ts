import OpenAI, { APIError } from 'openai'
import { DateTime } from 'luxon'
import { z } from 'zod'
import { APP_TIMEZONE } from '../../config/app-timezone.js'
import { prisma } from '../../db/prisma.js'
import { DATABASE_CONTEXT } from './schema-context.js'
import type { QueryAssistantTableResult } from './schemas.js'
import type { QueryAssistantScope } from './scope.js'

const sqlPlanSchema = z.object({
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(500),
  sql: z.string().min(1).max(6000),
})

const SQL_SYSTEM_PROMPT = `Sos un traductor de lenguaje natural a SQL PostgreSQL para EduTrack.
Tu tarea es generar UNA consulta SELECT de solo lectura usando exclusivamente las tablas y columnas del contexto.
Devolvé un JSON con: title, summary, sql.

Reglas estrictas:
- Solo SELECT. No uses INSERT, UPDATE, DELETE, UPSERT, MERGE, ALTER, DROP, CREATE, TRUNCATE, GRANT, REVOKE, COPY, CALL, DO, EXECUTE ni funciones con efectos laterales.
- No uses comentarios SQL.
- No uses punto y coma.
- Usá nombres de tablas y columnas entre comillas dobles, por ejemplo "AttendanceIncident"."detectedAt".
- Usá aliases legibles en español para las columnas finales, por ejemplo AS "Docente", AS "Cantidad".
- Para nombres de persona preferí COALESCE(NULLIF("User"."name", ''), NULLIF(CONCAT_WS(' ', "User"."firstName", "User"."lastName"), ''), "User"."username", "User"."email").
- Zona horaria obligatoria del producto: America/Montevideo. La base guarda instantes UTC. Para filtrar o mostrar fecha/hora civil Uruguay en SQL usá ("Tabla"."campoFecha" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Montevideo').
- Para preguntas por día civil ("8 de mayo", "hoy", "ayer"), filtrá usando la fecha proyectada a Uruguay, por ejemplo DATE("Attendance"."time" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Montevideo') = DATE '2026-05-08'.
- Para mostrar horas, devolvé la hora civil Uruguay, por ejemplo to_char(("Attendance"."time" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Montevideo'), 'HH24:MI') AS "Hora".
- Para mostrar fechas, devolvé la fecha civil Uruguay, por ejemplo to_char(("Attendance"."time" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Montevideo'), 'DD/MM/YYYY') AS "Fecha".
- Si el usuario dice un mes por nombre sin año explícito, por ejemplo "mayo", NO asumas el año actual: filtrá por EXTRACT(MONTH FROM fecha) = número_del_mes y devolvé también el año en una columna si ayuda.
- Solo usá el año del contexto cuando el usuario diga "este mes", "este año", "actual", o mencione explícitamente ese año.
- Si el usuario dice "este mes", usá mes y año del contexto.
- Para "más de 4", filtrá HAVING COUNT(*) > 4. Para "4 o más" o "al menos 4", usá HAVING COUNT(*) >= 4.
- Para rankings o "quién ... más", usá GROUP BY, COUNT(*) y ORDER BY COUNT(*) DESC.
- Para preguntas directas de asistencia ("personas que llegaron tarde", "quiénes llegaron tarde", "faltaron", "ausentes") preferí la tabla "Attendance".
- Para personas que llegaron tarde usá "Attendance"."type" = 'CHECK_IN' y "Attendance"."status" = 'LATE'.
- Para faltas/ausencias directas usá "Attendance"."status" IN ('ABSENT_NOT_JUSTIFIED', 'ABSENT_JUSTIFIED') cuando pidan listado de personas, y "AttendanceIncident"."type" = 'TEACHER_NO_SHOW' cuando pidan incidencias, ranking de incidencias o ausencias docentes detectadas.
- Para tardanzas/incidencias de llegada tarde usá "AttendanceIncident"."type" = 'LATE_ARRIVAL' solo si el usuario habla de incidencias.
- Respetá siempre el filtro de ciclo lectivo indicado en el contexto salvo que diga "todos los ciclos": para "Event" usá "Event"."schoolYearId" = id; para "Attendance" y "AttendanceIncident" uní con "Event" y filtrá "Event"."schoolYearId"; para "Course" usá "CourseOffering" si está disponible en el contexto o evitá mezclar ciclos.
- Limitá los resultados a 200 filas como máximo.
- Si la pregunta no se puede responder con las tablas disponibles, devolvé un SELECT inocuo sin filas: SELECT 'No se puede responder con el esquema disponible' AS "Mensaje" WHERE false.
- JSON único, sin markdown.

Ejemplos de SQL esperado:
- "personas que llegaron tarde en mayo" → SELECT persona, fecha y hora civil Uruguay usando "Attendance" JOIN "User", WHERE "Attendance"."type" = 'CHECK_IN' AND "Attendance"."status" = 'LATE' AND EXTRACT(MONTH FROM ("Attendance"."time" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Montevideo')) = 5, sin filtrar año si no lo nombró.
- "a que horas marco Carolina Lopez el 8 de mayo y en que estado" → SELECT to_char(("Attendance"."time" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Montevideo'), 'HH24:MI') AS "Hora", "Attendance"."status" AS "Estado" filtrando por DATE(("Attendance"."time" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Montevideo')) = DATE 'AAAA-05-08' si hay año explícito; si no hay año, filtrá día y mes civil Uruguay.
- "docentes con más de 4 faltas en mayo" → GROUP BY usuario, contar ausencias con "Attendance"."status" IN ('ABSENT_NOT_JUSTIFIED', 'ABSENT_JUSTIFIED') o incidentes TEACHER_NO_SHOW si pregunta por incidencias; HAVING COUNT(*) > 4; EXTRACT(MONTH) = 5 en fecha civil Uruguay sin año si no lo nombró.
- "quién faltó más este mes" → usar mes y año del contexto, agrupar por persona, ORDER BY cantidad DESC.`

const FORBIDDEN_SQL = /\b(insert|update|delete|upsert|merge|alter|drop|create|truncate|grant|revoke|copy|call|do|execute|vacuum|analyze|set|reset|listen|notify)\b/i
const ALLOWED_TABLES = new Set([
  'User',
  'OrgRole',
  'Attendance',
  'AttendanceIncident',
  'Event',
  'SchoolYear',
  'Course',
  'CourseOffering',
  'asignaturas',
  'Student',
  'StudentEnrollment',
  'MedicalLeave',
  'BiometricPunch',
  'AuditLog',
])

function currentSqlContextLine(scope?: QueryAssistantScope) {
  const now = new Date()
  const schoolYearLine = scope?.allYears
    ? 'Contexto de ciclo lectivo: el usuario eligió todos los ciclos; no filtres por "schoolYearId".'
    : scope?.schoolYearId
      ? `Contexto de ciclo lectivo: filtrar por "schoolYearId" = '${scope.schoolYearId}' en datos académicos/asistencia/eventos.`
      : 'Contexto de ciclo lectivo: si la tabla tiene "schoolYearId", usá el ciclo lectivo activo.'
  return `Contexto temporal: fecha UTC aproximada ${now.toISOString().slice(0, 10)}.\n${schoolYearLine}`
}

function getOpenAiClient() {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) throw new Error('OPENAI_API_KEY_NOT_CONFIGURED')
  if (!apiKey.startsWith('sk-')) {
    throw new Error(
      'OPENAI_API_KEY_INVALID_FORMAT: Usá una "Secret key" de OpenAI que empiece con sk- (creada en https://platform.openai.com/api-keys). Sin comillas ni espacios en el .env.',
    )
  }
  return new OpenAI({ apiKey })
}

function stripTrailingSemicolon(sql: string): string {
  let clean = sql.trim()
  while (clean.endsWith(';')) clean = clean.slice(0, -1).trimEnd()
  return clean.trim()
}

function referencedTables(sql: string): string[] {
  const found = new Set<string>()
  const quoted = sql.matchAll(/\b(?:from|join)\s+"([^"]+)"/giu)
  for (const match of quoted) found.add(match[1])
  const unquoted = sql.matchAll(/\b(?:from|join)\s+([A-Za-z_][A-Za-z0-9_]*)/giu)
  for (const match of unquoted) found.add(match[1])
  return [...found]
}

/**
 * Reemplaza por espacios el contenido de los literales de string ('...'), conservando
 * la longitud. Así los chequeos de palabras prohibidas, comentarios y `;` no dan falsos
 * positivos cuando esas secuencias aparecen dentro de un dato (p. ej. un apellido
 * 'Delete' o una nota con '--' o ';'). Los identificadores entre comillas dobles se
 * dejan intactos porque se necesitan para detectar las tablas referenciadas.
 */
function blankStringLiterals(sql: string): string {
  let out = ''
  let inString = false
  for (const ch of sql) {
    if (ch === "'") {
      // Una comilla simple alterna dentro/fuera de string. Las comillas escapadas ('')
      // alternan dos veces y dejan el contenido intermedio igualmente blanqueado.
      inString = !inString
      out += "'"
    } else {
      out += inString ? ' ' : ch
    }
  }
  return out
}

export function validateReadOnlySql(sql: string): string {
  const cleaned = stripTrailingSemicolon(sql)
  if (!/^select\b/i.test(cleaned)) throw new Error('QUERY_ASSISTANT_SQL_NOT_SELECT')

  // Chequeos de seguridad sobre el SQL sin contenido de literales de string, para no
  // rechazar datos legítimos que contengan ';', '--' o palabras reservadas.
  const skeleton = blankStringLiterals(cleaned)
  if (skeleton.includes(';')) throw new Error('QUERY_ASSISTANT_SQL_MULTIPLE_STATEMENTS')
  if (skeleton.includes('--') || skeleton.includes('/*') || skeleton.includes('*/')) {
    throw new Error('QUERY_ASSISTANT_SQL_COMMENTS_FORBIDDEN')
  }
  if (FORBIDDEN_SQL.test(skeleton)) throw new Error('QUERY_ASSISTANT_SQL_FORBIDDEN_KEYWORD')

  // Las tablas se detectan sobre los identificadores intactos del SQL original.
  const tables = referencedTables(cleaned)
  const unknown = tables.filter((t) => !ALLOWED_TABLES.has(t))
  if (unknown.length > 0) throw new Error(`QUERY_ASSISTANT_SQL_UNKNOWN_TABLE:${unknown.join(',')}`)

  return cleaned
}

function limitedSql(sql: string): string {
  return `SELECT * FROM (${sql}) AS "assistant_query" LIMIT 200`
}

function normalizeValue(value: unknown): string | number | null {
  if (value == null) return null
  if (typeof value === 'bigint') return Number(value)
  if (value instanceof Date) {
    return DateTime.fromJSDate(value, { zone: 'utc' }).setZone(APP_TIMEZONE).toFormat('dd/MM/yyyy HH:mm')
  }
  if (typeof value === 'number' || typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  return JSON.stringify(value)
}

function rowsToTableResult(title: string, summary: string, rows: Record<string, unknown>[]): QueryAssistantTableResult {
  const keys = rows[0] ? Object.keys(rows[0]) : []
  return {
    intent: 'SQL_QUERY',
    summary: `${title}: ${summary}${rows.length === 0 ? ' No se encontraron filas para esa consulta.' : ''}`,
    columns: keys.map((key) => ({ key, label: key })),
    rows: rows.map((row) => {
      const normalized: Record<string, string | number | null> = {}
      for (const [key, value] of Object.entries(row)) normalized[key] = normalizeValue(value)
      return normalized
    }),
  }
}

/** Modelo para generación de SQL. Permite uno más capaz que el de clasificación. */
function sqlModel(): string {
  return process.env.OPENAI_SQL_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'
}

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

async function requestSqlPlan(
  client: OpenAI,
  model: string,
  messages: ChatMessage[],
): Promise<z.infer<typeof sqlPlanSchema>> {
  let completion
  try {
    completion = await client.chat.completions.create({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages,
    })
  } catch (e: unknown) {
    if (e instanceof APIError) {
      const hint =
        e.status === 401
          ? ' Revisá que OPENAI_API_KEY sea una clave válida de https://platform.openai.com/api-keys (debe empezar con sk-).'
          : ''
      throw new Error(`OpenAI API (${e.status ?? '?'}): ${e.message}.${hint}`)
    }
    throw e
  }

  const raw = completion.choices[0]?.message?.content
  if (!raw) throw new Error('OPENAI_EMPTY_RESPONSE')

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(raw)
  } catch {
    throw new Error('OPENAI_INVALID_JSON')
  }
  return sqlPlanSchema.parse(parsedJson)
}

/** Si el error de Postgres delata SQL inválido (columna/función/sintaxis), conviene reintentar. */
function isRepairableDbError(message: string): boolean {
  return /column .* does not exist|does not exist|syntax error|relation .* does not exist|function .* does not exist|operator does not exist|invalid input syntax/i.test(
    message,
  )
}

const MAX_SQL_REPAIRS = 1

export async function runNaturalLanguageSqlQuery(
  question: string,
  scope?: QueryAssistantScope,
): Promise<QueryAssistantTableResult> {
  const client = getOpenAiClient()
  const model = sqlModel()

  const messages: ChatMessage[] = [
    // System 100% estático (instrucciones + esquema + sinónimos) → prefijo cacheable por OpenAI.
    { role: 'system', content: `${SQL_SYSTEM_PROMPT}\n\n${DATABASE_CONTEXT}` },
    // Lo volátil (fecha, ciclo lectivo) va con la pregunta del usuario.
    { role: 'user', content: `${currentSqlContextLine(scope)}\n\nPregunta: ${question.trim().slice(0, 2000)}` },
  ]

  let lastError: unknown
  for (let attempt = 0; attempt <= MAX_SQL_REPAIRS; attempt += 1) {
    const plan = await requestSqlPlan(client, model, messages)
    const safeSql = validateReadOnlySql(plan.sql)
    try {
      const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(limitedSql(safeSql))
      return rowsToTableResult(plan.title, plan.summary, rows)
    } catch (e: unknown) {
      lastError = e
      const message = e instanceof Error ? e.message : String(e)
      if (attempt >= MAX_SQL_REPAIRS || !isRepairableDbError(message)) throw e
      // Una sola ronda de auto-corrección: le devolvemos el SQL y el error de la base.
      messages.push(
        { role: 'assistant', content: JSON.stringify(plan) },
        {
          role: 'user',
          content: `La consulta SQL anterior falló al ejecutarse en PostgreSQL con este error: ${message.slice(0, 500)}. Corregí el SQL respetando el esquema y las reglas, y devolvé de nuevo el JSON con title, summary y sql.`,
        },
      )
    }
  }
  throw lastError instanceof Error ? lastError : new Error('QUERY_ASSISTANT_SQL_FAILED')
}
