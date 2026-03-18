import { Router } from 'express'
import { prisma } from '../prisma.js'
import { authGuard, requireRole } from '../middlewares/auth.js'
import { z } from 'zod'
import { randomBytes } from 'crypto'

const r = Router()
r.use(authGuard, requireRole('ADMIN'))

function onlyDigits(v:string){ return v.replace(/\D/g,'') }
function computeCICheckDigit(base7: string) {
  const weights = [2,9,8,7,6,3,4]
  const padded = base7.padStart(7,'0')
  const sum = padded.split('').map((d,i)=>parseInt(d)*weights[i]).reduce((a,b)=>a+b,0)
  return (10 - (sum % 10)) % 10
}
function isValidUruguayanCI(ci: string) {
  const digits = onlyDigits(ci)
  if (digits.length < 7 || digits.length > 8) return false
  const base = digits.slice(0, -1)
  const check = parseInt(digits.slice(-1))
  return computeCICheckDigit(base) === check
}

// Listar usuarios (paginado + filtro + búsqueda)
r.get('/users', async (req, res) => {
  const page = Number((req.query.page as string) || 1)
  const pageSize = Math.min(Number((req.query.pageSize as string) || 20), 100)
  const role = (req.query.role as string) || undefined
  const q = (req.query.q as string) || ''
  const where: any = {}
  if (role) where.role = role
  if (q) where.OR = [
    { email: { contains: q, mode: 'insensitive' } },
    { username: { contains: q, mode: 'insensitive' } },
    { firstName: { contains: q, mode: 'insensitive' } },
    { lastName: { contains: q, mode: 'insensitive' } },
  ]
  const [total, data] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({ where, skip: (page-1)*pageSize, take: pageSize, orderBy: { createdAt: 'desc' }, select: { id:true, email:true, username:true, role:true, firstName:true, lastName:true, emailVerifiedAt:true, createdAt:true, lockUntil:true, nationalId:true, isApproved:true, approvedAt:true, isActive:true } })
  ])
  res.json({ total, page, pageSize, data })
})

// Crear usuario
r.post('/users', async (req, res) => {
  const parsed = z.object({ email: z.string().email(), role: z.enum(['ADMIN','STAFF','TEACHER']), username: z.string().min(3).max(30).optional() }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos' })
  const { email, role, username } = parsed.data
  const exist = await prisma.user.findUnique({ where: { email } })
  if (exist) return res.status(409).json({ message: 'Email ya registrado' })
  const user = await prisma.user.create({ data: { email, role, username, isApproved: true, approvedAt: new Date(), isActive: true } })
  res.json({ id: user.id })
})

// Editar datos sensibles
r.put('/users/:id', async (req, res) => {
  const id = req.params.id
  const parsed = z.object({
    role: z.enum(['ADMIN','STAFF','TEACHER']).optional(),
    username: z.string().min(3).max(30).optional(),
    nationalId: z.string().min(6).max(20).optional(),
    firstName: z.string().min(1).max(80).optional(),
    lastName: z.string().min(1).max(80).optional(),
    isApproved: z.boolean().optional(),
    isActive: z.boolean().optional(),
  }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos' })
  const data: any = {}
  if (parsed.data.role) data.role = parsed.data.role
  if (parsed.data.username) data.username = parsed.data.username
  if (parsed.data.firstName) data.firstName = parsed.data.firstName
  if (parsed.data.lastName) data.lastName = parsed.data.lastName
  if (parsed.data.firstName || parsed.data.lastName) {
    const current = await prisma.user.findUnique({ where: { id }, select: { firstName: true, lastName: true } })
    const firstName = parsed.data.firstName ?? current?.firstName ?? ''
    const lastName = parsed.data.lastName ?? current?.lastName ?? ''
    data.name = `${firstName} ${lastName}`.trim()
  }
  if (parsed.data.nationalId) {
    if (!isValidUruguayanCI(parsed.data.nationalId)) return res.status(400).json({ message: 'Cédula inválida' })
    data.nationalId = onlyDigits(parsed.data.nationalId)
  }
  if (typeof parsed.data.isApproved === 'boolean') {
    data.isApproved = parsed.data.isApproved
    data.approvedAt = parsed.data.isApproved ? new Date() : null
  }
  if (typeof parsed.data.isActive === 'boolean') {
    data.isActive = parsed.data.isActive
  }
  await prisma.user.update({ where: { id }, data })
  res.json({ ok: true })
})

// Lock / Unlock
r.put('/users/:id/lock', async (req, res) => {
  const id = req.params.id
  const lock = req.query.lock === 'true'
  await prisma.user.update({ where: { id }, data: { lockUntil: lock ? new Date(Date.now()+15*60*1000) : null, failedLoginAttempts: 0 } })
  res.json({ ok: true })
})

// Reset password: genera token de reset y lo retorna (para ahora; en prod enviar email)
r.post('/users/:id/password/reset', async (req, res) => {
  const id = req.params.id
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now()+15*60*1000)
  await prisma.passwordReset.create({ data: { token, userId: id, expiresAt } })
  res.json({ token, expiresAt })
})

export default r 
