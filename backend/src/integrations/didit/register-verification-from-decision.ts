/** Cruza texto crudo devuelto por Didit (decision/) con datos del formulario de registro. */

import type { RegisterVerificationLite } from './register-verification-types.js'

function haystack(decision: unknown): string {
  return JSON.stringify(decision ?? {})
    .normalize('NFKC')
    .replace(/\u00a0/g, ' ')
}

function normDigits(v: string): string {
  return String(v ?? '').replace(/\D/g, '')
}

function normalizeDateForCompare(isoLike: string): string {
  const s = isoLike.trim().slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return s
}

function hayHasDate(hay: string, yyyyMmDd: string): boolean {
  const n = normalizeDateForCompare(yyyyMmDd)
  if (!n) return false
  const [y, m, d] = n.split('-')
  const variants = [
    n,
    `${d}/${m}/${y}`,
    `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`,
    `${y}${m}${d}`,
    `${y}-${m}-${d}`,
  ].filter(Boolean)
  const u = hay.toUpperCase()
  return variants.some((v) => u.includes(v.toUpperCase()))
}

function hayHasCiDigits(hayNorm: string, ciDigits: string): boolean {
  if (ciDigits.length < 7) return false
  return hayNorm.includes(ciDigits)
}

/** Todas las palabras (longitud ≥2) deben aparecer en el texto de Didit. */
function wordsLikelyPresent(hayU: string, phrase: string): boolean {
  const words = phrase
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .map((w) => w.toUpperCase())
  if (words.length === 0) return false
  return words.every((w) => hayU.includes(w))
}

function hayNorm(s: string): string {
  return s.replace(/\D/g, '')
}

function parseBirthToUtcMidnight(birthYyyyMmDd: string): Date | null {
  const s = normalizeDateForCompare(birthYyyyMmDd)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const [y, m, d] = s.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(Date.UTC(y, m - 1, d))
}

function collectIsoDatesFromText(hay: string): string[] {
  const found = new Set<string>()
  const isoRe = /\b(20\d{2}|19\d{2})-(\d{2})-(\d{2})\b/g
  let m: RegExpExecArray | null
  while ((m = isoRe.exec(hay))) {
    found.add(`${m[1]}-${m[2]}-${m[3]}`)
  }
  return [...found]
}

/** dd/mm/aaaa o d/m/aaaa → yyyy-mm-dd cuando es plausible. */
function collectSlashDatesAsIso(hay: string): string[] {
  const found = new Set<string>()
  const slashRe = /\b(\d{1,2})\/(\d{1,2})\/(20\d{2}|19\d{2})\b/g
  let m: RegExpExecArray | null
  while ((m = slashRe.exec(hay))) {
    const dd = Number(m[1])
    const mm = Number(m[2])
    const yyyy = Number(m[3])
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || yyyy < 1950 || yyyy > 2099) continue
    found.add(`${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`)
  }
  return [...found]
}

/**
 * Intenta deducir la fecha de vencimiento del documento dentro del JSON/texto de Didit.
 * Heurística: entre fechas halladas, preferir la posterior al nacimiento declarado (suele ser vencimiento vs nacimiento).
 */
function extractLikelyExpiryIsoFromDecision(decision: unknown, birthYyyyMmDd: string): string | null {
  const hay = haystack(decision)
  const birth = parseBirthToUtcMidnight(birthYyyyMmDd)
  const allIso = [...collectIsoDatesFromText(hay), ...collectSlashDatesAsIso(hay)].filter((s) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s),
  )
  if (allIso.length === 0) return null

  const dates = allIso
    .map((s) => ({ s, t: Date.parse(s + 'T12:00:00Z') }))
    .filter((x) => !Number.isNaN(x.t))

  if (dates.length === 0) return null

  if (birth) {
    const afterBirth = dates.filter((x) => x.t > birth.getTime() + 864e5 * 30)
    if (afterBirth.length) {
      afterBirth.sort((a, b) => b.t - a.t)
      return afterBirth[0].s
    }
  }

  dates.sort((a, b) => b.t - a.t)
  return dates[0].s
}

function isIsoDateBeforeLocalToday(isoYyyyMmDd: string): boolean {
  const s = isoYyyyMmDd.trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const doc = new Date(y, m - 1, d)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return doc.getTime() < today.getTime()
}

/** Construye el mismo formato “card” que el paso OCR (mensajes ✓). Sin fecha de vencimiento manual: se infiere de Didit. */
export function buildRegisterVerificationComparison(
  decision: unknown,
  input: {
    firstName: string
    lastName: string
    nationalId: string
    birthdate: string
  },
): RegisterVerificationLite {
  const hay = haystack(decision)
  const hayU = hay.toUpperCase()
  const fn = input.firstName.trim()
  const ln = input.lastName.trim()
  const idDigits = normDigits(input.nationalId)

  const firstNameOk = wordsLikelyPresent(hayU, fn)
  const lastNameOk = wordsLikelyPresent(hayU, ln)
  const idOk = idDigits.length >= 7 && hayHasCiDigits(hayNorm(hay), idDigits)

  const bdOk = hayHasDate(hay, normalizeDateForCompare(input.birthdate))

  const expiryIso = extractLikelyExpiryIsoFromDecision(decision, input.birthdate)
  let expMessage: string
  let extractedExpiry: string | undefined
  if (!expiryIso) {
    expMessage =
      '⚠️ No pudimos determinar la fecha de vencimiento del documento con los datos devueltos por Didit. Probá de nuevo o usá la opción de subir foto del DNI.'
  } else {
    extractedExpiry = expiryIso
    if (isIsoDateBeforeLocalToday(expiryIso)) {
      expMessage = `✗ El documento figura vencido (vencimiento ${expiryIso}). No podés crear la cuenta hasta renovar la cédula.`
    } else {
      expMessage = `✓ Documento vigente: vencimiento ${expiryIso} (según datos de Didit).`
    }
  }

  const firstNameEntry = {
    provided: fn,
    extracted: firstNameOk ? fn.toUpperCase() : undefined,
    message: firstNameOk
      ? '✓ Nombre verificado correctamente (Didit)'
      : '✗ No encontramos el nombre en la respuesta de Didit. Probá subir una foto del DNI abajo.',
  }
  const lastNameEntry = {
    provided: ln,
    extracted: lastNameOk ? ln.toUpperCase() : undefined,
    message: lastNameOk
      ? '✓ Apellidos verificados correctamente (Didit)'
      : '✗ No encontramos los apellidos en la respuesta de Didit. Probá subir una foto del DNI abajo.',
  }
  const nationalIdEntry = {
    provided: input.nationalId.trim(),
    extracted: idOk ? input.nationalId.trim() : undefined,
    message: idOk
      ? '✓ Cédula verificada correctamente (Didit)'
      : '✗ No encontramos la cédula en la respuesta de Didit. Probá subir una foto del DNI abajo.',
  }
  const birthEntry = {
    provided: input.birthdate.trim(),
    extracted: bdOk ? input.birthdate.trim() : undefined,
    message: bdOk
      ? '✓ Fecha de nacimiento verificada correctamente (Didit)'
      : '⚠️ No encontramos esa fecha en el texto que devolvió Didit; confirmala o usá foto del DNI abajo.',
  }
  const expEntry = {
    provided: '—',
    extracted: extractedExpiry,
    message: expMessage,
  }

  const ver: RegisterVerificationLite['verification'] = {
    firstName: firstNameEntry,
    lastName: lastNameEntry,
    nationalId: nationalIdEntry,
    birthdate: birthEntry,
    nationalIdDocumentExpiresAt: expEntry,
  }

  let okFields = 0
  let totalFields = Object.keys(ver).length
  for (const k of Object.keys(ver) as (keyof typeof ver)[]) {
    const m = String(ver[k].message ?? '')
    if (m.includes('✓')) okFields++
  }

  return {
    verifiedFields: okFields,
    totalFields,
    verification: ver,
  }
}
