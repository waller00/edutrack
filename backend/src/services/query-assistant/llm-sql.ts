import OpenAI, { APIError } from 'openai'
import { DateTime } from 'luxon'
import { z } from 'zod'
import { getAppTimezone } from '../../config/app-timezone.js'
import { prisma } from '../../db/prisma.js'
import { temperatureParams } from './model-params.js'
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
- Si la pregunta habla de docentes/profesores en general, uní "User" con "OrgRole" por "User"."roleId" = "OrgRole"."id" y filtrá "OrgRole"."code" = 'TEACHER'. Para funcionarios/personal/administrativos filtrá "OrgRole"."code" = 'STAFF'. Si dice "personas" o no distingue rol, no filtres por rol.
- Para buscar a una persona nombrada usá coincidencia parcial e insensible a mayúsculas/acentos simples en varios campos, por ejemplo ("User"."name" ILIKE '%lopez%' OR "User"."firstName" ILIKE '%lopez%' OR "User"."lastName" ILIKE '%lopez%' OR "User"."username" ILIKE '%lopez%'). Nunca compares nombres con igualdad exacta.
- Zona horaria obligatoria del producto: America/Montevideo. La base guarda instantes UTC. Para filtrar o mostrar fecha/hora civil Uruguay en SQL usá ("Tabla"."campoFecha" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Montevideo').
- En "Attendance", el día civil de la marca está en "Attendance"."date" (medianoche de Uruguay como instante UTC): usá SIEMPRE "date" para filtrar por día, mes o año. "Attendance"."time" es solo el instante/hora de la marca; en ausencias materializadas puede arrastrar la fecha de otra ocurrencia de la serie, así que no filtres fechas con "time".
- Para preguntas por día civil ("8 de mayo", "hoy", "ayer"), filtrá usando la fecha proyectada a Uruguay, por ejemplo DATE("Attendance"."date" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Montevideo') = DATE '2026-05-08'.
- Para mostrar horas, devolvé la hora civil Uruguay, por ejemplo to_char(("Attendance"."time" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Montevideo'), 'HH24:MI') AS "Hora".
- Para mostrar fechas, devolvé la fecha civil Uruguay desde "date", por ejemplo to_char(("Attendance"."date" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Montevideo'), 'DD/MM/YYYY') AS "Fecha".
- Si el usuario dice un mes por nombre sin año explícito, por ejemplo "mayo", NO asumas el año actual: filtrá por EXTRACT(MONTH FROM fecha) = número_del_mes y devolvé también el año en una columna si ayuda.
- Solo usá el año del contexto cuando el usuario diga "este mes", "este año", "actual", o mencione explícitamente ese año.
- Si el usuario dice "este mes", usá mes y año del contexto.
- Para "más de 4", filtrá HAVING COUNT(*) > 4. Para "4 o más" o "al menos 4", usá HAVING COUNT(*) >= 4.
- Para rankings o "quién ... más", usá GROUP BY, COUNT(*) y ORDER BY COUNT(*) DESC.
- Para preguntas directas de asistencia ("personas que llegaron tarde", "quiénes llegaron tarde", "faltaron", "ausentes") preferí la tabla "Attendance".
- Para personas que llegaron tarde usá "Attendance"."type" = 'CHECK_IN' y "Attendance"."status" = 'LATE'.
- Para faltas/ausencias directas usá "Attendance"."status" IN ('ABSENT_NOT_JUSTIFIED', 'ABSENT_JUSTIFIED') cuando pidan listado de personas, y "AttendanceIncident"."type" = 'TEACHER_NO_SHOW' cuando pidan incidencias, ranking de incidencias o ausencias docentes detectadas. Advertencia: las ausencias solo existen en "Attendance" si un administrador las materializó; si el resultado queda vacío, aclaralo en summary ("puede haber faltas sin materializar en el listado de asistencias").
- Para tardanzas/incidencias de llegada tarde usá "AttendanceIncident"."type" = 'LATE_ARRIVAL' solo si el usuario habla de incidencias.
- Respetá siempre el filtro de ciclo lectivo indicado en el contexto salvo que diga "todos los ciclos": para "Event" usá "Event"."schoolYearId" = id; "Attendance" tiene su propio "schoolYearId", filtralo directo sin JOIN a "Event" (no descartes marcas sin evento); para "AttendanceIncident" uní con "Event" y filtrá "Event"."schoolYearId"; para "Course" usá "CourseOffering" si está disponible en el contexto o evitá mezclar ciclos.
- Limitá los resultados a 200 filas como máximo.
- Si la pregunta no se puede responder con las tablas disponibles, devolvé un SELECT inocuo sin filas: SELECT 'No se puede responder con el esquema disponible' AS "Mensaje" WHERE false.
- JSON único, sin markdown.

Ejemplos de SQL esperado:
- "personas que llegaron tarde en mayo" → SELECT persona, fecha (desde "date") y hora civil Uruguay (desde "time") usando "Attendance" JOIN "User", WHERE "Attendance"."type" = 'CHECK_IN' AND "Attendance"."status" = 'LATE' AND EXTRACT(MONTH FROM ("Attendance"."date" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Montevideo')) = 5, sin filtrar año si no lo nombró.
- "a que horas marco Carolina Lopez el 8 de mayo y en que estado" → SELECT to_char(("Attendance"."time" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Montevideo'), 'HH24:MI') AS "Hora", "Attendance"."status" AS "Estado" filtrando por DATE(("Attendance"."date" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Montevideo')) = DATE 'AAAA-05-08' si hay año explícito; si no hay año, filtrá día y mes civil Uruguay sobre "date".
- "docentes con más de 4 faltas en mayo" → GROUP BY usuario, contar ausencias con "Attendance"."status" IN ('ABSENT_NOT_JUSTIFIED', 'ABSENT_JUSTIFIED') o incidentes TEACHER_NO_SHOW si pregunta por incidencias; HAVING COUNT(*) > 4; EXTRACT(MONTH) = 5 sobre "Attendance"."date" en fecha civil Uruguay sin año si no lo nombró.
- "quién faltó más este mes" → usar mes y año del contexto, agrupar por persona, ORDER BY cantidad DESC.
- "qué profesores faltaron en junio" → "Attendance" JOIN "User" JOIN "OrgRole" (con "OrgRole"."code" = 'TEACHER'), aplicando el filtro de ciclo lectivo del contexto sobre "Attendance"."schoolYearId", WHERE "Attendance"."status" IN ('ABSENT_NOT_JUSTIFIED', 'ABSENT_JUSTIFIED') AND EXTRACT(MONTH FROM ("Attendance"."date" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Montevideo')) = 6, sin filtrar año si no lo nombró; devolver persona, fecha civil Uruguay y estado.`

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
  'Orientation',
  'CourseOrientation',
  'asignaturas',
  'SubjectCourseAssignment',
  'Student',
  'StudentEnrollment',
  'StudentTuitionYear',
  'MedicalLeave',
  'BiometricPunch',
  'AuditLog',
])

function currentSqlContextLine(scope?: QueryAssistantScope) {
  const today = DateTime.now().setZone(getAppTimezone()).toISODate()
  const cycleYearNote = scope?.schoolYearCode ? ` (corresponde al año ${scope.schoolYearCode})` : ''
  const schoolYearLine = scope?.allYears
    ? 'Contexto de ciclo lectivo: el usuario eligió todos los ciclos; no filtres por "schoolYearId".'
    : scope?.schoolYearId
      ? `Contexto de ciclo lectivo: filtrar por "schoolYearId" = '${scope.schoolYearId}'${cycleYearNote} en datos académicos/asistencia/eventos.`
      : 'Contexto de ciclo lectivo: si la tabla tiene "schoolYearId", usá el ciclo lectivo activo.'
  return `Contexto temporal: hoy es ${today} (fecha civil en America/Montevideo).\n${schoolYearLine}`
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
    return DateTime.fromJSDate(value, { zone: 'utc' }).setZone(getAppTimezone()).toFormat('dd/MM/yyyy HH:mm')
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
  return process.env.OPENAI_SQL_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini'
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
      ...temperatureParams(model, 0),
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

/** Los errores de validación propia (tabla desconocida, no-SELECT, etc.) también se reintentan. */
function isRepairableError(message: string): boolean {
  return message.startsWith('QUERY_ASSISTANT_SQL_') || isRepairableDbError(message)
}

const MAX_SQL_REPAIRS = 2

type SqlPlan = z.infer<typeof sqlPlanSchema>
type RepairBudget = { repairs: number }

/** Ronda de auto-corrección: devolvemos al modelo su SQL y el motivo del rechazo/error. */
async function repairPlan(
  client: OpenAI,
  model: string,
  messages: ChatMessage[],
  plan: SqlPlan,
  errorDetail: string,
  budget: RepairBudget,
): Promise<SqlPlan | null> {
  if (budget.repairs <= 0) return null
  budget.repairs -= 1
  messages.push(
    { role: 'assistant', content: JSON.stringify(plan) },
    {
      role: 'user',
      content: `La consulta SQL anterior falló: ${errorDetail.slice(0, 500)}. Corregí el SQL respetando el esquema y las reglas, y devolvé de nuevo el JSON con title, summary y sql.`,
    },
  )
  return requestSqlPlan(client, model, messages)
}

function normalizeSqlForComparison(sql: string): string {
  return stripTrailingSemicolon(sql).replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Verificación única cuando la consulta corre bien pero devuelve 0 filas: el caso
 * típico de mala interpretación (año filtrado de más, estado equivocado, nombre con
 * igualdad exacta). Si el modelo confirma el mismo SQL, el vacío se acepta como real.
 */
async function reviseEmptyResultPlan(
  client: OpenAI,
  model: string,
  messages: ChatMessage[],
  plan: SqlPlan,
): Promise<SqlPlan | null> {
  messages.push(
    { role: 'assistant', content: JSON.stringify(plan) },
    {
      role: 'user',
      content:
        'La consulta se ejecutó sin errores pero devolvió 0 filas. Revisá la interpretación: ¿filtraste un año que el usuario no nombró, un estado o tipo equivocado, un nombre con igualdad exacta en vez de ILIKE parcial, o un JOIN/filtro demasiado restrictivo? Si el SQL era correcto y simplemente no hay datos, devolvé exactamente el mismo SQL. Devolvé el JSON con title, summary y sql.',
    },
  )
  const revised = await requestSqlPlan(client, model, messages)
  return normalizeSqlForComparison(revised.sql) === normalizeSqlForComparison(plan.sql) ? null : revised
}

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

  const budget: RepairBudget = { repairs: MAX_SQL_REPAIRS }
  let emptyCheckPending = true
  let plan = await requestSqlPlan(client, model, messages)

  for (;;) {
    let rows: Record<string, unknown>[]
    try {
      rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(limitedSql(validateReadOnlySql(plan.sql)))
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      const next = isRepairableError(message) ? await repairPlan(client, model, messages, plan, message, budget) : null
      if (!next) throw e
      plan = next
      continue
    }
    if (rows.length === 0 && emptyCheckPending) {
      emptyCheckPending = false
      const revised = await reviseEmptyResultPlan(client, model, messages, plan)
      if (revised) {
        plan = revised
        continue
      }
    }
    return rowsToTableResult(plan.title, plan.summary, rows)
  }
}
