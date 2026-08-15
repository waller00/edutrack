/**
 * Extracción estructurada de los datos del documento dentro de la decisión de Didit.
 *
 * La decisión trae el OCR en `id_verification` (o `id_verifications[]`, según la versión
 * del workflow), pero el formato exacto de las claves varía. En vez de acoplarnos a una
 * ruta fija, recorremos el objeto y nos quedamos con el primer valor plausible para cada
 * campo lógico, probando nombres en snake_case y camelCase.
 *
 * Esto reemplaza al match por texto (`JSON.stringify(...).includes(...)`), que solo podía
 * responder "coincide / no coincide" y nunca qué dice realmente el documento.
 */

export type DiditDocumentFields = {
  firstName?: string
  lastName?: string
  fullName?: string
  documentNumber?: string
  /** `yyyy-mm-dd` */
  dateOfBirth?: string
  /** `yyyy-mm-dd` */
  expirationDate?: string
}

/** Contenedores donde Didit suele anidar el OCR; se priorizan sobre el resto del objeto. */
const PREFERRED_CONTAINERS = ['id_verification', 'idverification', 'id_verifications', 'document', 'kyc']

const FIELD_KEYS: Record<keyof DiditDocumentFields, string[]> = {
  firstName: ['first_name', 'firstname', 'given_name', 'given_names', 'names', 'nombre', 'nombres'],
  lastName: ['last_name', 'lastname', 'surname', 'family_name', 'apellido', 'apellidos'],
  fullName: ['full_name', 'fullname', 'name_on_document', 'nombre_completo'],
  documentNumber: [
    'document_number',
    'documentnumber',
    'personal_number',
    'personalnumber',
    'id_number',
    'idnumber',
    'national_id',
    'nationalid',
    'numero_documento',
    'cedula',
  ],
  dateOfBirth: ['date_of_birth', 'dateofbirth', 'birth_date', 'birthdate', 'dob', 'fecha_nacimiento'],
  expirationDate: [
    'expiration_date',
    'expirationdate',
    'date_of_expiry',
    'dateofexpiry',
    'expiry_date',
    'expirydate',
    'expires_at',
    'valid_until',
    'fecha_vencimiento',
  ],
}

const DATE_FIELDS = new Set<keyof DiditDocumentFields>(['dateOfBirth', 'expirationDate'])

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[\s-]/g, '_')
}

/** `dd/mm/yyyy`, `yyyy-mm-dd`, `yyyymmdd` e ISO completo → `yyyy-mm-dd`. */
export function normalizeDiditDate(value: string): string | undefined {
  const raw = String(value ?? '').trim()
  if (!raw) return undefined

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  const slash = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(raw)
  if (slash) {
    const d = Number(slash[1])
    const m = Number(slash[2])
    const y = Number(slash[3])
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }
    return undefined
  }

  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(raw)
  if (compact) {
    const m = Number(compact[2])
    const d = Number(compact[3])
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return `${compact[1]}-${compact[2]}-${compact[3]}`
  }

  return undefined
}

function scalarToString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const t = value.trim()
    return t.length > 0 ? t : undefined
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

/** Recorre el objeto en anchura y aplica `visit` a cada par clave/valor escalar. */
function walkEntries(root: unknown, visit: (key: string, value: unknown) => void): void {
  const queue: unknown[] = [root]
  const seen = new Set<unknown>()

  while (queue.length > 0) {
    const node = queue.shift()
    if (!node || typeof node !== 'object') continue
    if (seen.has(node)) continue
    seen.add(node)

    if (Array.isArray(node)) {
      for (const item of node) queue.push(item)
      continue
    }

    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      visit(key, value)
      if (value && typeof value === 'object') queue.push(value)
    }
  }
}

function collectFrom(source: unknown, into: DiditDocumentFields): void {
  walkEntries(source, (key, value) => {
    const normalized = normalizeKey(key)
    for (const field of Object.keys(FIELD_KEYS) as (keyof DiditDocumentFields)[]) {
      if (into[field] !== undefined) continue
      if (!FIELD_KEYS[field].includes(normalized)) continue
      const scalar = scalarToString(value)
      if (!scalar) continue
      if (DATE_FIELDS.has(field)) {
        const date = normalizeDiditDate(scalar)
        if (date) into[field] = date
      } else {
        into[field] = scalar
      }
    }
  })
}

/** Sub-objetos donde Didit anida el OCR, para mirarlos antes que el resto de la decisión. */
function preferredContainers(decision: unknown): unknown[] {
  const found: unknown[] = []
  walkEntries(decision, (key, value) => {
    if (!value || typeof value !== 'object') return
    if (PREFERRED_CONTAINERS.includes(normalizeKey(key))) found.push(value)
  })
  return found
}

/**
 * Devuelve los datos que Didit leyó del documento. Los campos ausentes quedan `undefined`:
 * quien consuma esto debe tratar "no lo sabemos" distinto de "no coincide".
 */
export function extractDiditDocumentFields(decision: unknown): DiditDocumentFields {
  const out: DiditDocumentFields = {}
  if (!decision || typeof decision !== 'object') return out

  // Primero los contenedores de OCR conocidos: evita capturar, por ejemplo, el
  // `first_name` que el propio formulario mandó como vendor_data.
  for (const container of preferredContainers(decision)) collectFrom(container, out)
  collectFrom(decision, out)

  if (!out.firstName && !out.lastName && out.fullName) {
    // Algunos workflows solo devuelven el nombre completo.
    const parts = out.fullName.trim().split(/\s+/)
    if (parts.length >= 2) {
      out.firstName = parts[0]
      out.lastName = parts.slice(1).join(' ')
    }
  }

  return out
}
