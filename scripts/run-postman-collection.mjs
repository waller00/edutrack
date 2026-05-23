#!/usr/bin/env node
import fs from 'node:fs'

const collectionPath = process.argv[2]
const variablesPath = process.argv[3]

if (!collectionPath || !variablesPath) {
  console.error('Uso: node scripts/run-postman-collection.mjs <collection.json> <variables.json>')
  process.exit(2)
}

const collection = JSON.parse(fs.readFileSync(collectionPath, 'utf8'))
const inputVariables = JSON.parse(fs.readFileSync(variablesPath, 'utf8'))

const variables = new Map()
for (const v of collection.variable || []) variables.set(v.key, v.value)
for (const [key, value] of Object.entries(inputVariables)) variables.set(key, String(value))

const timestamp = String(Date.now())
variables.set('runSchoolYearCode', variables.get('runSchoolYearCode') || '2100')

function replaceVars(value) {
  if (value == null) return value
  let out = String(value)
  for (let i = 0; i < 5; i++) {
    const next = out
      .replaceAll('{{$timestamp}}', timestamp)
      .replaceAll('{{$guid}}', crypto.randomUUID())
      .replace(/\{\{([^}]+)\}\}/g, (_m, key) => variables.get(key) ?? '')
    if (next === out) return out
    out = next
  }
  return out
}

function flattenItems(items, folder = []) {
  const out = []
  for (const item of items || []) {
    if (item.item) out.push(...flattenItems(item.item, [...folder, item.name]))
    else out.push({ ...item, folder })
  }
  return out
}

function headersArrayToObject(headers = []) {
  const out = {}
  for (const h of headers) {
    if (!h?.key || h.disabled) continue
    out[h.key] = replaceVars(h.value ?? '')
  }
  return out
}

function expectedStatuses(headers) {
  const raw = headers['X-Expected-Status']
  if (!raw) return []
  return raw.split(',').map((x) => Number(x.trim())).filter(Boolean)
}

class CookieJar {
  constructor() {
    this.cookies = new Map()
  }

  header() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  }

  store(setCookieHeaders) {
    for (const raw of setCookieHeaders) {
      const first = raw.split(';')[0]
      const idx = first.indexOf('=')
      if (idx <= 0) continue
      const key = first.slice(0, idx).trim()
      const value = first.slice(idx + 1).trim()
      if (!value) this.cookies.delete(key)
      else this.cookies.set(key, value)
    }
  }

  clear() {
    this.cookies.clear()
  }
}

function collectSetCookie(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie()
  const raw = headers.get('set-cookie')
  return raw ? [raw] : []
}

async function requestWithJar(req, jar) {
  const headers = headersArrayToObject(req.request.header || [])
  delete headers['X-Expected-Status']
  const cookie = jar?.header()
  if (cookie) headers.Cookie = cookie

  const init = { method: req.request.method, headers, redirect: 'manual' }
  const body = req.request.body
  if (body?.mode === 'raw' && !['GET', 'HEAD'].includes(init.method)) init.body = replaceVars(body.raw)

  const res = await fetch(replaceVars(req.request.url), init)
  if (jar) jar.store(collectSetCookie(res.headers))
  const contentType = res.headers.get('content-type') || ''
  const bytes = Buffer.from(await res.arrayBuffer())
  let json = null
  if (contentType.includes('application/json')) {
    try {
      json = JSON.parse(bytes.toString('utf8'))
    } catch {}
  }
  return { status: res.status, contentType, bytes, json }
}

function captureVariables(name, json) {
  if (!json || typeof json !== 'object') return
  const pairs = [
    ['id', 'lastId'],
    ['exportId', 'exportId'],
    ['token', 'lastToken'],
    ['twoFactorToken', 'twoFactorToken'],
    ['sessionId', 'diditSessionId'],
    ['diditSessionId', 'diditSessionId'],
    ['verificationUrl', 'diditVerificationUrl'],
    ['courseOfferingId', 'courseOfferingId'],
  ]
  for (const [key, variable] of pairs) {
    if (json[key]) variables.set(variable, String(json[key]))
  }
  if (json.id && name.includes('Crear curso')) variables.set('courseId', String(json.id))
  if (json.id && name.includes('Crear evento')) variables.set('eventId', String(json.id))
  if (json.id && name.includes('Crear estudiante')) variables.set('studentId', String(json.id))
  if (json.id && name.includes('Crear licencia')) variables.set('licenseId', String(json.id))
  if (json.id && name.includes('Crear día no laborable')) variables.set('nonWorkingDayId', String(json.id))
  if (json.id && name.includes('Crear ciclo')) variables.set('targetSchoolYearId', String(json.id))
  if (json.token && name.includes('Resetear contraseña')) variables.set('resetToken', String(json.token))
  if (json.data && Array.isArray(json.data) && json.data[0]?.id) variables.set('lastListId', String(json.data[0].id))
}

async function login(jar, identifier, password) {
  jar.clear()
  const res = await fetch(`${variables.get('baseUrl')}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  })
  jar.store(collectSetCookie(res.headers))
  return res.status
}

function needsNoSession(name) {
  return name.includes('sin sesión') || name.includes('Bloquear acceso admin sin sesión')
}

function needsNoPermission(name) {
  return name.includes('Bloquear acceso admin sin permiso') ||
    name.includes('Bloquear edición de asistencia sin permiso') ||
    name.includes('Bloquear creación de exportación sin permiso') ||
    name.includes('Bloquear creación de licencia sin permiso')
}

function isAuthLoginScenario(name) {
  return name.includes('Login correcto') ||
    name.includes('Login con contraseña incorrecta') ||
    name.includes('Login de cuenta desactivada')
}

function isPublicScenario(name) {
  return name.includes('Opciones de registro') ||
    name.includes('Consultar nombre de usuario disponible') ||
    name.includes('Registrar usuario') ||
    name.includes('Registro con') ||
    name.includes('Verificar correo') ||
    name.includes('Solicitar recuperación') ||
    name.includes('Restablecer contraseña') ||
    name.includes('Crear sesión Didit') ||
    name.includes('Verificar campos Didit') ||
    name.includes('Consultar estado Didit') ||
    name.includes('Ingesta ADMS')
}

const items = flattenItems(collection.item)
const initialVariables = new Map(variables)
const adminJar = new CookieJar()
const emptyJar = new CookieJar()
const noPermissionJar = new CookieJar()
const teacherJar = new CookieJar()

const adminLoginStatus = await login(adminJar, variables.get('adminEmail'), variables.get('adminPassword'))
const noPermissionLoginStatus = await login(noPermissionJar, variables.get('noPermissionEmail'), variables.get('noPermissionPassword'))
const teacherLoginStatus = await login(teacherJar, variables.get('noPermissionEmail'), variables.get('noPermissionPassword'))

const results = []

for (const item of items) {
  const name = item.name
  const headers = headersArrayToObject(item.request.header || [])
  const expected = expectedStatuses(headers)

  let jar = adminJar
  if (needsNoSession(name) || isAuthLoginScenario(name) || isPublicScenario(name)) jar = emptyJar
  if (needsNoPermission(name)) jar = noPermissionJar
  if (name.includes('API-ATT-001') || name.includes('API-ATT-002')) jar = teacherJar

  if (jar === adminJar && adminJar.cookies.size === 0) {
    await login(adminJar, variables.get('adminEmail'), variables.get('adminPassword'))
  }

  if (name.includes('API-COURSE-004')) variables.set('courseId', '00000000-0000-4000-8000-000000000000')
  else variables.set('courseId', initialVariables.get('courseId') ?? variables.get('courseId') ?? '')

  if (name.includes('API-EVT-006')) variables.set('eventId', '00000000-0000-4000-8000-000000000000')
  else variables.set('eventId', initialVariables.get('eventId') ?? variables.get('eventId') ?? '')

  variables.set('subjectId', initialVariables.get('subjectId') ?? variables.get('subjectId') ?? '')

  let status = 0
  let ok = false
  let detail = ''
  try {
    const res = await requestWithJar(item, jar)
    status = res.status
    ok = expected.length ? expected.includes(status) : status >= 200 && status < 300
    captureVariables(name, res.json)
    if (name.includes('Cerrar sesión')) adminJar.clear()
    if (!ok) {
      detail = res.json ? JSON.stringify(res.json).slice(0, 500) : res.bytes.toString('utf8').slice(0, 500)
    }
  } catch (error) {
    detail = error instanceof Error ? error.message : String(error)
  }

  results.push({
    name,
    folder: item.folder.join(' / '),
    expected: expected.join(','),
    status,
    ok,
    detail,
  })
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${status || 'ERR'} ${name}`)
}

const passed = results.filter((r) => r.ok).length
const failed = results.length - passed
const summary = {
  collection: collection.info?.name,
  baseUrl: variables.get('baseUrl'),
  startedWith: { adminLoginStatus, noPermissionLoginStatus, teacherLoginStatus },
  total: results.length,
  passed,
  failed,
  results,
}

fs.writeFileSync('/tmp/postman-run-report.json', JSON.stringify(summary, null, 2))
console.log(JSON.stringify({ total: results.length, passed, failed, report: '/tmp/postman-run-report.json' }, null, 2))
process.exit(failed > 0 ? 1 : 0)
