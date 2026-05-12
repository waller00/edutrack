/**
 * Demo operativa: liceo (~10 docentes, ~6 meses de historia).
 *
 * ADVERTENCIA — BORRA datos operativos y deja UN usuario admin (por username o email).
 *
 *   cd backend
 *   node prisma/seed-liceo-6months.mjs
 *
 * Variables opcionales:
 *   ADMIN_USERNAME (default: admin)
 *   ADMIN_EMAIL    (si lo seteás, busca también por email exacto)
 *   LICEO_HISTORY_MONTHS (default 6)
 *   LICEO_TEACHER_COUNT  (default 10, máx. 10 con plantilla fija)
 *   LICEO_TEACHER_PASSWORD (default: liceo-demo-123)
 *   LICEO_RESET_ADMIN_PASSWORD (si seteás, re-hashea la contraseña del admin preservado)
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import argon2 from 'argon2'

const prisma = new PrismaClient()

const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || 'admin').toLowerCase()
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim()
const HISTORY_MONTHS = Number(process.env.LICEO_HISTORY_MONTHS || 6)
const TEACHER_COUNT = Math.min(10, Math.max(1, Number(process.env.LICEO_TEACHER_COUNT || 10)))
const TEACHER_DEMO_PASSWORD = process.env.LICEO_TEACHER_PASSWORD || 'liceo-demo-123'
const NOTE_TAG = '[DEMO-LICEO]'

function buildValidCi(baseNumber) {
  const base7 = String(Math.abs(baseNumber) % 9_999_999).padStart(7, '0')
  const weights = [2, 9, 8, 7, 6, 3, 4]
  const sum = base7.split('').reduce((acc, digit, index) => acc + Number(digit) * weights[index], 0)
  const checkDigit = (10 - (sum % 10)) % 10
  return `${base7}${checkDigit}`
}

function utcMidnightFromParts(y, monthIndex0, day) {
  return new Date(Date.UTC(y, monthIndex0, day, 0, 0, 0, 0))
}

function startOfUtcDay(d) {
  return utcMidnightFromParts(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

function addUtcDays(date, delta) {
  const out = new Date(date.getTime())
  out.setUTCDate(out.getUTCDate() + delta)
  return out
}

function utcFormatYmd(d) {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const da = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${da}`
}

function getMondayUtc(anchorDate) {
  const d = startOfUtcDay(anchorDate)
  const dow = d.getUTCDay()
  const diff = dow === 0 ? -6 : 1 - dow
  d.setUTCDate(d.getUTCDate() + diff)
  return d
}

function utcWithTimeOnDay(dayDate, hourUtc, minuteUtc) {
  return new Date(
    Date.UTC(dayDate.getUTCFullYear(), dayDate.getUTCMonth(), dayDate.getUTCDate(), hourUtc, minuteUtc, 0, 0),
  )
}

function rngFactory(seedInt) {
  let s = seedInt >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

const TEACHERS_TEMPLATE = [
  { firstName: 'Ana María', lastName: 'Martínez' },
  { firstName: 'Gustavo', lastName: 'Silva' },
  { firstName: 'Laura', lastName: 'Rodríguez' },
  { firstName: 'Pablo', lastName: 'Fernández' },
  { firstName: 'Carolina', lastName: 'López' },
  { firstName: 'Andrés', lastName: 'Pérez' },
  { firstName: 'Valentina', lastName: 'Gómez' },
  { firstName: 'Martín', lastName: 'Viera' },
  { firstName: 'Florencia', lastName: 'Nuñez' },
  { firstName: 'Diego', lastName: 'Sosa' },
]

const DEMO_COURSES = [
  { name: 'Matemática · 4° año', code: 'MAT4' },
  { name: 'Lengua y Literatura · 3° año', code: 'LEN3' },
  { name: 'Historia · 2° año', code: 'HIS2' },
  { name: 'Biología · 3° año', code: 'BIO3' },
  { name: 'Física · 5° año', code: 'FIS5' },
  { name: 'Química · 4° año', code: 'QUI4' },
  { name: 'Inglés · 2° año', code: 'ING2' },
  { name: 'Orientación Tutorial · Ciclo medio', code: 'OOT' },
  { name: 'Educación física · 1° año', code: 'EDF1' },
  { name: 'Informática aplicada · 5° año', code: 'INF5' },
  { name: 'Arte visual · Ciclo medio', code: 'ART' },
  { name: 'Taller proyecto interdisciplinario', code: 'TPI' },
]

const WEEK_SLOTS = [
  { dow: 1, startH: 14, startM: 0, durMin: 90 },
  { dow: 1, startH: 16, startM: 30, durMin: 85 },
  { dow: 2, startH: 13, startM: 30, durMin: 90 },
  { dow: 2, startH: 17, startM: 0, durMin: 60 },
  { dow: 3, startH: 13, startM: 0, durMin: 90 },
  { dow: 3, startH: 16, startM: 30, durMin: 90 },
  { dow: 4, startH: 14, startM: 30, durMin: 90 },
  { dow: 4, startH: 17, startM: 15, durMin: 60 },
  { dow: 5, startH: 13, startM: 45, durMin: 90 },
]

async function findAdminUser() {
  const or = [{ username: { equals: ADMIN_USERNAME, mode: 'insensitive' } }]
  if (ADMIN_EMAIL) {
    or.push({ email: { equals: ADMIN_EMAIL, mode: 'insensitive' } })
  }

  const u = await prisma.user.findFirst({
    where: { OR: or },
    select: {
      id: true,
      email: true,
      username: true,
      orgRole: { select: { code: true } },
    },
  })

  return u
}

async function wipeOperationalData(adminId) {
  await prisma.attendanceIncident.deleteMany()
  await prisma.attendance.deleteMany()
  await prisma.medicalLeave.deleteMany()
  await prisma.event.updateMany({ data: { parentEventId: null } })
  await prisma.event.deleteMany()
  await prisma.course.deleteMany()
  await prisma.auditLog.deleteMany()
  await prisma.inAppNotification.deleteMany()
  await prisma.passwordReset.deleteMany()
  await prisma.emailVerification.deleteMany()
  await prisma.refreshToken.deleteMany()
  await prisma.webPushSubscription.deleteMany()
  await prisma.livenessSession.deleteMany()
  await prisma.biometricPunch.deleteMany()
  await prisma.biometricUserMapping.deleteMany()
  await prisma.user.deleteMany({ where: { id: { not: adminId } } })
}

/** Licencias ACTIVE que cubren día (solo esas generan ausencia justificada en métricas). */
function coveredByActiveLeave(dayStart, leaves) {
  const ymd = utcFormatYmd(dayStart)
  return leaves.some((l) => {
    if (l.status !== 'ACTIVE') return false
    const s = utcFormatYmd(startOfUtcDay(l.startDate))
    const e = utcFormatYmd(startOfUtcDay(l.endDate))
    return ymd >= s && ymd <= e
  })
}

function pickAttendance(rng, justifiedByLeave) {
  if (justifiedByLeave) return { inS: 'ABSENT_JUSTIFIED', outS: null, delayMin: 0 }
  const r = rng()
  if (r < 0.028) return { inS: 'ABSENT_NOT_JUSTIFIED', outS: null, delayMin: 0 }
  if (r < 0.115) return { inS: 'LATE', outS: 'EXIT', delayMin: 8 + Math.floor(rng() * 13) }
  return { inS: 'PRESENT', outS: rng() > 0.068 ? 'EXIT' : 'EARLY_EXIT', delayMin: -3 }
}

/** Días UTC (medianoche) donde aplica cada evento dentro del período historia…hoy inclusivo corte pasado para asistencia. */
function enumerateOccurrenceDates(ev, historyStartInclusive, enumerationEndInclusive) {
  const out = []
  if (!ev.isRecurring) {
    const d0 = startOfUtcDay(ev.startDate)
    if (d0 >= historyStartInclusive && d0 <= enumerationEndInclusive) out.push(new Date(d0.getTime()))
    return out
  }

  /** Último día calendario a expandir según recurrenceEnd vs “hoy” (operativa liceo sólo retrospectiva cargada hasta hoy). */
  let recurrenceCap = enumerationEndInclusive
  if (ev.recurrenceEnd) {
    const r = startOfUtcDay(ev.recurrenceEnd)
    recurrenceCap = r < recurrenceCap ? r : recurrenceCap
  }

  let cursor =
    utcFormatYmd(ev.startDate) >= utcFormatYmd(historyStartInclusive)
      ? startOfUtcDay(ev.startDate)
      : new Date(historyStartInclusive.getTime())
  cursor = startOfUtcDay(cursor)

  while (cursor <= recurrenceCap) {
    const dow = cursor.getUTCDay()
    if (ev.daysOfWeek.includes(dow)) {
      out.push(new Date(cursor.getTime()))
    }
    cursor = addUtcDays(cursor, 1)
  }
  return out
}

async function flushAttendances(buffer) {
  const chunkSize = 400
  for (let i = 0; i < buffer.length; i += chunkSize) {
    const slice = buffer.slice(i, i + chunkSize)
    await prisma.attendance.createMany({ data: slice })
  }
}

async function main() {
  const now = new Date()
  const historyStartMonday = addUtcDays(getMondayUtc(now), -(HISTORY_MONTHS * 30))
  /** Último día UTC (medianoche inicio día) inclusivo para expandir recurrentes antes de cargar CHECK_IN hasta “ayer”. */
  const enumerationEndInclusive = startOfUtcDay(now)
  const horizonEnd = addUtcDays(now, 21)

  console.log('='.repeat(72))
  console.log(' EduTrack · seed liceo (~%s meses) — modo destructivo', HISTORY_MONTHS)
  console.log(' Rango historia (UTC día): desde %s', utcFormatYmd(historyStartMonday))
  console.log('='.repeat(72))

  const teacherRoleId = await prisma.orgRole.findFirst({ where: { code: 'TEACHER' } }).then((x) => x?.id)
  if (!teacherRoleId) throw new Error('OrgRole TEACHER no existe. Ejecutá: npm run seed (en backend) antes.')

  console.log('[1/8] Detectando usuario admin a preservar (username="%s")...', ADMIN_USERNAME)
  const adminBefore = await findAdminUser()
  if (!adminBefore) {
    console.error('No existe usuario para preservar con ADMIN_USERNAME="%s"', ADMIN_USERNAME)
    if (!ADMIN_EMAIL) console.error('Podés usar ADMIN_EMAIL=correo@ejemplo como alternativa.')
    process.exitCode = 1
    return
  }
  if (adminBefore.orgRole.code !== 'ADMIN') {
    console.warn('[liceo] Aviso: usuario preservado tiene rol %s (no ADMIN según código).', adminBefore.orgRole.code)
  }

  console.log('[2/8] Purga operativa...')
  await wipeOperationalData(adminBefore.id)

  const passwordHashTeachers = await argon2.hash(TEACHER_DEMO_PASSWORD, { type: argon2.argon2id })
  const resetAdminPw = process.env.LICEO_RESET_ADMIN_PASSWORD?.trim()
  console.log('[3/8] Ajustando admin...')
  await prisma.user.update({
    where: { id: adminBefore.id },
    data: {
      emailVerifiedAt: now,
      isApproved: true,
      approvedAt: now,
      isActive: true,
      failedLoginAttempts: 0,
      lockUntil: null,
      ...(resetAdminPw ? { passwordHash: await argon2.hash(resetAdminPw, { type: argon2.argon2id }) } : {}),
    },
  })

  console.log('[4/8] Cursos demo...')
  await prisma.course.createMany({
    data: DEMO_COURSES.map((c) => ({
      name: `${c.name} ${NOTE_TAG}`.slice(0, 120),
      code: `${c.code}-DEMO`,
      isActive: true,
    })),
  })
  const courses = await prisma.course.findMany({
    where: { code: { endsWith: '-DEMO' } },
    select: { id: true, name: true, code: true },
    orderBy: { code: 'asc' },
  })

  console.log('[5/8] Docentes (%s)...', TEACHER_COUNT)
  const teachers = []
  for (let idx = 0; idx < TEACHER_COUNT; idx++) {
    const t = TEACHERS_TEMPLATE[idx]
    const slug = `${t.firstName}.${t.lastName}`
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[^a-z0-9.]+/g, '')
    const email = `${slug}.${idx + 1}@liceo.demo`
    const username = `doc.${String(idx + 1).padStart(2, '0')}.${slug.slice(0, 32)}`

    teachers.push(
      await prisma.user.create({
        data: {
          email,
          username: username.slice(0, 120),
          firstName: t.firstName,
          lastName: t.lastName,
          name: `${t.firstName} ${t.lastName}`,
          phone: `+598991${String(20000 + idx).slice(-5)}`,
          nationalId: buildValidCi(4_900_123 + idx * 911),
          birthdate: utcMidnightFromParts(1985 + idx, idx % 12, (idx % 26) + 1),
          roleId: teacherRoleId,
          passwordHash: passwordHashTeachers,
          emailVerifiedAt: now,
          isApproved: true,
          approvedAt: now,
          isActive: true,
        },
      }),
    )
  }

  console.log('[6/8] Eventos (CLASE recurrente + algunas reuniones/cap.)...')
  const eventsPayload = []

  teachers.forEach((teacher, ti) => {
    const rng = rngFactory(ti * 7_917 + 1)
    const slotIndices = []
    const used = new Set()
    while (slotIndices.length < 5) {
      const wi = Math.floor(rng() * WEEK_SLOTS.length)
      const key = String(wi)
      if (!used.has(key)) {
        used.add(key)
        slotIndices.push(wi)
      }
    }

    slotIndices.forEach((slotIdx, serie) => {
      const slot = WEEK_SLOTS[slotIdx]
      const course = courses[(ti + serie + slotIdx) % courses.length]
      let probe = new Date(historyStartMonday.getTime())
      while (probe.getUTCDay() !== slot.dow) probe = addUtcDays(probe, 1)

      const startTime = utcWithTimeOnDay(probe, slot.startH, slot.startM)
      const endTime = new Date(startTime.getTime() + slot.durMin * 60 * 1000)

      eventsPayload.push({
        title: `${course.code.replace('-DEMO', '')} · clase (${teacher.firstName})`,
        description: `${NOTE_TAG} Clase horario liceo (UTC).`,
        type: 'CLASE',
        status: 'SCHEDULED',
        startDate: probe,
        endDate: probe,
        startTime,
        endTime,
        location: `Aula / laboratorio (dow ${slot.dow})`,
        userId: adminBefore.id,
        assignedUserId: teacher.id,
        courseId: course.id,
        recurrenceType: 'WEEKLY',
        recurrenceEnd: horizonEnd,
        isRecurring: true,
        daysOfWeek: [slot.dow],
        createdAt: addUtcDays(probe, -7),
        updatedAt: now,
      })
    })

    for (let h = 0; h < 4; h++) {
      const span = HISTORY_MONTHS * 25 || 130
      const dayOffset = Math.floor(((ti + 1) * 41 + (h + 2) * 53) % span)
      const eventDay = addUtcDays(historyStartMonday, dayOffset + h * 4)
      if (eventDay >= now) continue
      const startTime = utcWithTimeOnDay(eventDay, 11 + h, (h % 2) * 18)
      const endTime = new Date(startTime.getTime() + (h % 2 === 0 ? 90 : 55) * 60 * 1000)
      const typeRoll = rng()
      eventsPayload.push({
        title:
          typeRoll < 0.42 ? `Capacitación · ${teacher.firstName}` : `Reunión pedagógica · ${teacher.lastName}`,
        description: `${NOTE_TAG} Institucional.`,
        type: typeRoll < 0.42 ? 'CAPACITACION' : 'REUNION',
        status: 'COMPLETED',
        startDate: eventDay,
        endDate: eventDay,
        startTime,
        endTime,
        location: 'Sala docente',
        userId: adminBefore.id,
        assignedUserId: teacher.id,
        courseId: courses[(ti + h) % courses.length].id,
        recurrenceType: 'NONE',
        recurrenceEnd: null,
        isRecurring: false,
        daysOfWeek: [],
        createdAt: addUtcDays(eventDay, -3),
        updatedAt: eventDay,
      })
    }
  })

  for (let i = 0; i < eventsPayload.length; i++) {
    await prisma.event.create({ data: eventsPayload[i] })
  }

  const persistedEvents = await prisma.event.findMany({
    where: { description: { contains: NOTE_TAG } },
    select: {
      id: true,
      assignedUserId: true,
      startDate: true,
      recurrenceEnd: true,
      isRecurring: true,
      daysOfWeek: true,
      startTime: true,
      endTime: true,
    },
  })

  console.log('[7/8] Licencias simuladas...')
  const leaveRows = []
  for (let ix = 0; ix < Math.min(7, teachers.length); ix++) {
    const u = teachers[ix]
    const anchor = addUtcDays(historyStartMonday, ix * 19 + 7)
    const len = ix % 3 === 0 ? 4 : ix % 2 === 0 ? 2 : 6
    const end = addUtcDays(anchor, len - 1)
    const startDate = startOfUtcDay(anchor)
    const endDate = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate(), 23, 59, 59, 999))
    const endedInPast = endDate < now
    const shouldBeInactive = ix === 2 || ix === 5 || endedInPast

    leaveRows.push({
      userId: u.id,
      type: ix === 5 ? 'WORK_LEAVE' : 'MEDICAL_LEAVE',
      status: shouldBeInactive ? 'INACTIVE' : 'ACTIVE',
      startDate,
      endDate,
      reason: ix === 5 ? `${NOTE_TAG} Permiso administrativo.` : `${NOTE_TAG} Reposición funcional demo.`,
      doctorName: ix % 3 === 0 ? 'Dr. Demo' : null,
      doctorPhone: null,
      approvedBy: adminBefore.id,
      approvedAt: addUtcDays(anchor, -2),
      notes: `${NOTE_TAG} ${utcFormatYmd(anchor)} → ${utcFormatYmd(end)}`,
      ...(shouldBeInactive
        ? { deactivatedBy: adminBefore.id, deactivatedAt: addUtcDays(endDate, 1) }
        : {}),
    })
  }
  for (const l of leaveRows) {
    await prisma.medicalLeave.create({ data: l })
  }

  const leavesByUser = new Map()
  for (const t of teachers) {
    const list = await prisma.medicalLeave.findMany({
      where: { userId: t.id },
      select: { id: true, startDate: true, endDate: true, status: true },
    })
    leavesByUser.set(t.id, list)
  }

  console.log('[8/8] Asistencias (instancias pasadas)...')
  const attendanceBuffer = []
  let inst = 0

  for (const ev of persistedEvents) {
    if (!ev.assignedUserId || !ev.startTime || !ev.endTime) continue
    const userLeaves = leavesByUser.get(ev.assignedUserId) || []
    const dates = enumerateOccurrenceDates(ev, historyStartMonday, enumerationEndInclusive)
    const rng = rngFactory(ev.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0))

    for (const dayStart of dates) {
      if (dayStart >= startOfUtcDay(now)) continue
      inst += 1

      const justified = coveredByActiveLeave(dayStart, userLeaves)
      const pat = pickAttendance(rng, justified)
      const dateField = startOfUtcDay(dayStart)

      const baseIn = utcWithTimeOnDay(
        dayStart,
        ev.startTime.getUTCHours(),
        ev.startTime.getUTCMinutes(),
      )
      const checkInTime = new Date(
        baseIn.getTime() + (pat.delayMin === 0 ? 0 : pat.delayMin * 60 * 1000),
      )

      attendanceBuffer.push({
        userId: ev.assignedUserId,
        eventId: ev.id,
        type: 'CHECK_IN',
        status: pat.inS,
        date: dateField,
        time: checkInTime,
        notes: `${NOTE_TAG} ingreso simulado`,
      })

      if (pat.outS) {
        const baseOut = utcWithTimeOnDay(
          dayStart,
          ev.endTime.getUTCHours(),
          ev.endTime.getUTCMinutes(),
        )
        const adj = pat.outS === 'EARLY_EXIT' ? -12 * 60 * 1000 : 2 * 60 * 1000
        attendanceBuffer.push({
          userId: ev.assignedUserId,
          eventId: ev.id,
          type: 'CHECK_OUT',
          status: pat.outS,
          date: dateField,
          time: new Date(baseOut.getTime() + adj),
          notes: `${NOTE_TAG} salida simulada`,
        })
      }
    }
  }

  await flushAttendances(attendanceBuffer)

  console.log('')
  console.log('Listo.')
  console.log('- Admin preservado:', adminBefore.username || adminBefore.email, `(${adminBefore.id})`)
  if (resetAdminPw) console.log('  Contraseña admin actualizada (LICEO_RESET_ADMIN_PASSWORD).')
  console.log('- Docentes creados:', teachers.length)
  console.log('- Eventos marcados:', persistedEvents.length)
  console.log('- Instancias con asistencias generadas (aprox. filas CHECK_IN)', inst)
  console.log('- Movimientos de asistencia (filas INSERT):', attendanceBuffer.length)
  console.log('')
  console.log('Credenciales demo docentes — usuario ejemplo:', teachers[0]?.username || teachers[0]?.email)
  console.log(`  Contraseña unificada: ${TEACHER_DEMO_PASSWORD}`)
  console.log(`  Prefijo usuarios doc.* @liceo.demo`)
  console.log('')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
