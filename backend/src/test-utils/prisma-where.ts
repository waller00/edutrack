import { Prisma } from '@prisma/client'

/**
 * Los tests de rutas mockean Prisma, así que un `where` que Prisma rechaza al ejecutar pasa igual.
 * El caso que ya llegó a producción: `{ not: null }` sobre un campo obligatorio («Mi día» del docente
 * no cargaba). El tipo generado no lo admite, pero el backend compila sin `strictNullChecks`.
 *
 * `invalidNullFilters` recorre el `where` con el esquema real (`Prisma.dmmf`) y devuelve los campos
 * obligatorios que se filtran por `null`. Sigue AND/OR/NOT y las relaciones (`is`, `some`, …).
 */

type Field = { name: string; kind: string; type: string; isRequired: boolean; isList: boolean }

const MODELS = new Map(Prisma.dmmf.datamodel.models.map((model) => [model.name, model.fields as unknown as Field[]]))
const LOGICAL = new Set(['AND', 'OR', 'NOT'])
const RELATION_FILTERS = new Set(['is', 'isNot', 'some', 'every', 'none'])

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)

function scalarNulls(path: string, value: unknown): string[] {
  if (value === null) return [path]
  if (!isObject(value)) return []
  return ['equals', 'not'].filter((op) => op in value && value[op] === null).map((op) => `${path}.${op}`)
}

function walk(model: string, where: unknown, path: string, out: string[]): void {
  if (Array.isArray(where)) {
    where.forEach((item, index) => walk(model, item, `${path}[${index}]`, out))
    return
  }
  if (!isObject(where)) return
  const fields = MODELS.get(model)
  if (!fields) throw new Error(`No existe el modelo ${model} en el esquema de Prisma`)
  for (const [key, value] of Object.entries(where)) {
    const at = path ? `${path}.${key}` : key
    if (LOGICAL.has(key)) {
      walk(model, value, at, out)
      continue
    }
    const field = fields.find((f) => f.name === key)
    if (!field) continue
    if (field.kind === 'object') {
      if (!isObject(value)) continue
      const nested = Object.keys(value).some((k) => RELATION_FILTERS.has(k))
      if (nested) {
        for (const [op, inner] of Object.entries(value)) if (RELATION_FILTERS.has(op)) walk(field.type, inner, `${at}.${op}`, out)
      } else walk(field.type, value, at, out)
      continue
    }
    if (field.isRequired && !field.isList) out.push(...scalarNulls(at, value))
  }
}

export function invalidNullFilters(model: string, where: unknown): string[] {
  const out: string[] = []
  walk(model, where, '', out)
  return out
}

/** Falla el test si el `where` filtra por `null` un campo obligatorio del modelo. */
export function expectValidWhere(model: string, where: unknown): void {
  const invalid = invalidNullFilters(model, where)
  if (invalid.length > 0) {
    throw new Error(`Prisma rechaza estos filtros de ${model} (el campo es obligatorio y no puede ser null): ${invalid.join(', ')}`)
  }
}
