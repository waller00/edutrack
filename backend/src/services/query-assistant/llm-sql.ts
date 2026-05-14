import OpenAI, { APIError } from 'openai'
import { z } from 'zod'
import { prisma } from '../../prisma.js'
import { DATABASE_CONTEXT } from './schema-context.js'
import type { QueryAssistantTableResult } from './schemas.js'

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
- Si el usuario dice "mayo" sin año, usá el año del contexto.
- Si el usuario dice "este mes", usá el mes y año del contexto.
- Para "más de 4", filtrá HAVING COUNT(*) > 4. Para "4 o más" o "al menos 4", usá HAVING COUNT(*) >= 4.
- Para rankings o "quién ... más", usá GROUP BY, COUNT(*) y ORDER BY COUNT(*) DESC.
- Para faltas/ausencias docentes usá "AttendanceIncident"."type" = 'TEACHER_NO_SHOW'.
- Para tardanzas usá "AttendanceIncident"."type" = 'LATE_ARRIVAL' salvo que pidan marcas de asistencia, donde podés usar "Attendance"."status" = 'LATE'.
- Limitá los resultados a 200 filas como máximo.
- Si la pregunta no se puede responder con las tablas disponibles, devolvé un SELECT inocuo sin filas: SELECT 'No se puede responder con el esquema disponible' AS "Mensaje" WHERE false.
- JSON único, sin markdown.`

const FORBIDDEN_SQL = /\b(insert|update|delete|upsert|merge|alter|drop|create|truncate|grant|revoke|copy|call|do|execute|vacuum|analyze|set|reset|listen|notify)\b/i
const ALLOWED_TABLES = new Set([
  'User',
  'OrgRole',
  'Attendance',
  'AttendanceIncident',
  'Event',
  'Course',
  'MedicalLeave',
  'BiometricPunch',
  'AuditLog',
])

function currentSqlContextLine() {
  const now = new Date()
  return `Contexto temporal: fecha UTC aproximada ${now.toISOString().slice(0, 10)}.`
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
  return sql.trim().replace(/;+$/u, '').trim()
}

function referencedTables(sql: string): string[] {
  const found = new Set<string>()
  const quoted = sql.matchAll(/\b(?:from|join)\s+"([^"]+)"/giu)
  for (const match of quoted) found.add(match[1])
  const unquoted = sql.matchAll(/\b(?:from|join)\s+([A-Za-z_][A-Za-z0-9_]*)/giu)
  for (const match of unquoted) found.add(match[1])
  return [...found]
}

function validateReadOnlySql(sql: string): string {
  const cleaned = stripTrailingSemicolon(sql)
  if (!/^select\b/i.test(cleaned)) throw new Error('QUERY_ASSISTANT_SQL_NOT_SELECT')
  if (cleaned.includes(';')) throw new Error('QUERY_ASSISTANT_SQL_MULTIPLE_STATEMENTS')
  if (cleaned.includes('--') || cleaned.includes('/*') || cleaned.includes('*/')) {
    throw new Error('QUERY_ASSISTANT_SQL_COMMENTS_FORBIDDEN')
  }
  if (FORBIDDEN_SQL.test(cleaned)) throw new Error('QUERY_ASSISTANT_SQL_FORBIDDEN_KEYWORD')

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
  if (value instanceof Date) return value.toISOString().slice(0, 19).replace('T', ' ')
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

export async function runNaturalLanguageSqlQuery(question: string): Promise<QueryAssistantTableResult> {
  const client = getOpenAiClient()
  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'

  let completion
  try {
    completion = await client.chat.completions.create({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `${SQL_SYSTEM_PROMPT}\n\n${DATABASE_CONTEXT}\n${currentSqlContextLine()}` },
        { role: 'user', content: question.trim().slice(0, 2000) },
      ],
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

  const plan = sqlPlanSchema.parse(parsedJson)
  const safeSql = validateReadOnlySql(plan.sql)
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(limitedSql(safeSql))
  return rowsToTableResult(plan.title, plan.summary, rows)
}
