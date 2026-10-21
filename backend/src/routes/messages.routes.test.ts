import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import cookieParser from 'cookie-parser'
import { signAccessToken } from '../test-utils/bearer-token.js'

const { prismaMock, pushMock, hitRateLimitMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
    conversation: { upsert: vi.fn(), update: vi.fn() },
    conversationMember: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    directMessage: { findMany: vi.fn(), create: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
  pushMock: vi.fn(),
  hitRateLimitMock: vi.fn(),
}))

vi.mock('../db/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../services/webPush.js', () => ({ sendWebPushPayloadToUser: pushMock }))
vi.mock('../middlewares/rate-limit.js', () => ({ hitRateLimit: hitRateLimitMock }))

import messagesRoutes from './messages.js'

function app() {
  const a = express()
  a.use(express.json())
  a.use(cookieParser())
  a.use('/messages', messagesRoutes)
  return a
}

const ME = '00000000-0000-4000-8000-000000000001'
const OTHER = '00000000-0000-4000-8000-000000000002'
const CONV = '00000000-0000-4000-8000-0000000000c1'

const auth = (role = 'TEACHER', sub = ME) => ({
  Authorization: `Bearer ${signAccessToken({ sub, email: `${sub}@x.com`, role: role as 'TEACHER' })}`,
})

const contact = (id: string, firstName: string, lastName: string, label = 'Docente') => ({
  id,
  firstName,
  lastName,
  name: null,
  orgRole: { label },
})

describe('mensajería (/messages)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hitRateLimitMock.mockResolvedValue({ limited: false })
    pushMock.mockResolvedValue({ sent: 1, failed: 0 })
    prismaMock.$queryRaw.mockResolvedValue([])
    prismaMock.conversationMember.findUnique.mockResolvedValue({ lastReadAt: null, starred: false })
    prismaMock.$transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops))
  })

  it('pide sesión', async () => {
    expect((await request(app()).get('/messages/summary')).status).toBe(401)
  })

  it('todo el personal la usa, incluido Personal', async () => {
    for (const role of ['TEACHER', 'STAFF', 'ADSCRIPTO', 'DIRECCION', 'ADMIN']) {
      const res = await request(app()).get('/messages/summary').set(auth(role))
      expect(res.status, role).toBe(200)
    }
  })

  it('el resumen cuenta conversaciones y mensajes sin leer', async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      { conversationId: 'c1', unread: 2 },
      { conversationId: 'c2', unread: 1 },
    ])
    const res = await request(app()).get('/messages/summary').set(auth())
    expect(res.body).toEqual({ unreadConversations: 2, unreadMessages: 3 })
  })

  describe('contactos', () => {
    it('busca sin tildes, nunca a uno mismo, y sólo devuelve nombre y perfil', async () => {
      prismaMock.user.findMany.mockResolvedValue([
        contact(OTHER, 'Leopoldo', 'Giménez'),
        contact('00000000-0000-4000-8000-000000000003', 'Ana', 'García', 'Dirección'),
      ])
      const res = await request(app()).get('/messages/contacts?q=gimenez').set(auth())

      expect(res.status).toBe(200)
      expect(res.body.data).toEqual([{ id: OTHER, name: 'Leopoldo Giménez', roleLabel: 'Docente' }])
      const where = prismaMock.user.findMany.mock.calls[0][0].where
      expect(where).toMatchObject({ isActive: true, isApproved: true, id: { not: ME } })
      expect(where.orgRole.grants.some.permission.code).toBe('messaging.use')
      // Nada de correo, cédula ni teléfono en el directorio.
      const select = prismaMock.user.findMany.mock.calls[0][0].select
      expect(Object.keys(select).sort()).toEqual(['firstName', 'id', 'lastName', 'name', 'orgRole'])
    })
  })

  describe('empezar una conversación', () => {
    it('reutiliza la del par por pairKey', async () => {
      prismaMock.user.findFirst.mockResolvedValue({ id: OTHER })
      prismaMock.conversation.upsert.mockResolvedValue({ id: CONV })
      prismaMock.conversationMember.findFirst.mockResolvedValue({ user: contact(OTHER, 'Leo', 'Giménez') })

      const res = await request(app()).post('/messages/conversations').set(auth()).send({ userId: OTHER })

      expect(res.status).toBe(201)
      expect(res.body.data).toMatchObject({ id: CONV, starred: false, other: { id: OTHER, name: 'Leo Giménez' } })
      const upsert = prismaMock.conversation.upsert.mock.calls[0][0]
      expect(upsert.where.pairKey).toBe([ME, OTHER].sort().join(':'))
      expect(upsert.create.members.create).toEqual([{ userId: ME }, { userId: OTHER }])
    })

    it('no deja escribirse a uno mismo ni a alguien que no puede recibir', async () => {
      const self = await request(app()).post('/messages/conversations').set(auth()).send({ userId: ME })
      expect(self.status).toBe(400)

      prismaMock.user.findFirst.mockResolvedValue(null)
      const inactive = await request(app()).post('/messages/conversations').set(auth()).send({ userId: OTHER })
      expect(inactive.status).toBe(409)
      expect(prismaMock.conversation.upsert).not.toHaveBeenCalled()
    })
  })

  describe('lista de conversaciones', () => {
    it('trae el otro, la vista previa, los no leídos y si está destacada', async () => {
      const at = new Date('2026-10-21T13:00:00.000Z')
      prismaMock.conversationMember.findMany.mockResolvedValue([
        {
          starred: true,
          conversation: {
            id: CONV,
            lastMessageAt: at,
            members: [{ user: contact(OTHER, 'Leo', 'Giménez') }],
            messages: [{ body: 'Hola\nJorge', authorUserId: ME, createdAt: at }],
          },
        },
      ])
      prismaMock.$queryRaw.mockResolvedValue([{ conversationId: CONV, unread: 3 }])

      const res = await request(app()).get('/messages/conversations').set(auth())

      expect(res.body.data).toEqual([
        {
          id: CONV,
          starred: true,
          unread: 3,
          lastMessageAt: at.toISOString(),
          other: { id: OTHER, name: 'Leo Giménez', roleLabel: 'Docente' },
          lastMessage: { preview: 'Hola Jorge', mine: true, createdAt: at.toISOString() },
        },
      ])
    })

    it('filtra por el nombre del otro', async () => {
      prismaMock.conversationMember.findMany.mockResolvedValue([
        { starred: false, conversation: { id: 'a', lastMessageAt: new Date(), members: [{ user: contact(OTHER, 'Leo', 'Giménez') }], messages: [] } },
        { starred: false, conversation: { id: 'b', lastMessageAt: new Date(), members: [{ user: contact('x', 'Ana', 'García') }], messages: [] } },
      ])
      const res = await request(app()).get('/messages/conversations?q=ana').set(auth())
      expect(res.body.data.map((c: { id: string }) => c.id)).toEqual(['b'])
    })
  })

  describe('mensajes', () => {
    it('quien no es miembro no ve nada (404, no se revela que existe)', async () => {
      prismaMock.conversationMember.findUnique.mockResolvedValue(null)
      for (const call of [
        request(app()).get(`/messages/conversations/${CONV}/messages`).set(auth()),
        request(app()).post(`/messages/conversations/${CONV}/messages`).set(auth()).send({ body: 'hola' }),
        request(app()).post(`/messages/conversations/${CONV}/read`).set(auth()),
      ]) {
        expect((await call).status).toBe(404)
      }
      expect(prismaMock.directMessage.findMany).not.toHaveBeenCalled()
      expect(prismaMock.directMessage.create).not.toHaveBeenCalled()
    })

    it('un id que no es uuid es 404 sin consultar la base', async () => {
      const res = await request(app()).get('/messages/conversations/no-existe/messages').set(auth())
      expect(res.status).toBe(404)
      expect(prismaMock.conversationMember.findUnique).not.toHaveBeenCalled()
    })

    it('trae los últimos en orden cronológico y avisa si hay anteriores', async () => {
      const rows = [3, 2, 1].map((n) => ({
        id: `m${n}`,
        body: `msg ${n}`,
        authorUserId: n === 2 ? ME : OTHER,
        createdAt: new Date(`2026-10-21T13:0${n}:00.000Z`),
      }))
      prismaMock.directMessage.findMany.mockResolvedValue(rows)

      const res = await request(app()).get(`/messages/conversations/${CONV}/messages?take=2`).set(auth())

      expect(res.body.hasMore).toBe(true)
      expect(res.body.data.map((m: { id: string; mine: boolean }) => [m.id, m.mine])).toEqual([
        ['m2', true],
        ['m3', false],
      ])
    })

    it('con `after` trae sólo lo nuevo (polling) y con `before`, lo anterior', async () => {
      prismaMock.directMessage.findMany.mockResolvedValue([])
      const cursor = encodeURIComponent('2026-10-21T13:00:00.000Z|m1')

      await request(app()).get(`/messages/conversations/${CONV}/messages?after=${cursor}`).set(auth())
      const afterArgs = prismaMock.directMessage.findMany.mock.calls[0][0]
      expect(afterArgs.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }])
      expect(afterArgs.where.OR[0].createdAt.gt).toEqual(new Date('2026-10-21T13:00:00.000Z'))

      await request(app()).get(`/messages/conversations/${CONV}/messages?before=${cursor}`).set(auth())
      const beforeArgs = prismaMock.directMessage.findMany.mock.calls[1][0]
      expect(beforeArgs.where.OR[0].createdAt.lt).toEqual(new Date('2026-10-21T13:00:00.000Z'))
    })

    it('mandar guarda, sube la conversación, la da por leída al autor y avisa al otro por push', async () => {
      const now = new Date('2026-10-21T14:00:00.000Z')
      prismaMock.directMessage.create.mockResolvedValue({ id: 'm9', body: 'Hola', authorUserId: ME, createdAt: now })
      prismaMock.conversation.update.mockResolvedValue({})
      prismaMock.conversationMember.update.mockResolvedValue({})
      prismaMock.user.findUnique.mockResolvedValue({ firstName: 'Jorge', lastName: 'Marrero', name: null })
      prismaMock.conversationMember.findMany.mockResolvedValue([{ userId: OTHER }])

      const res = await request(app())
        .post(`/messages/conversations/${CONV}/messages`)
        .set(auth())
        .send({ body: '  Hola  ' })

      expect(res.status).toBe(201)
      expect(res.body.data).toMatchObject({ id: 'm9', body: 'Hola', mine: true })
      expect(prismaMock.directMessage.create.mock.calls[0][0].data).toMatchObject({ conversationId: CONV, authorUserId: ME, body: 'Hola' })
      expect(prismaMock.conversationMember.update.mock.calls[0][0]).toMatchObject({
        where: { conversationId_userId: { conversationId: CONV, userId: ME } },
      })
      await vi.waitFor(() =>
        expect(pushMock).toHaveBeenCalledWith(
          OTHER,
          expect.objectContaining({ title: 'Jorge Marrero', body: 'Hola', url: `/mensajes?c=${CONV}`, tag: `msg-${CONV}` }),
        ),
      )
      expect(pushMock).not.toHaveBeenCalledWith(ME, expect.anything())
    })

    it('rechaza un mensaje vacío o demasiado largo', async () => {
      const empty = await request(app()).post(`/messages/conversations/${CONV}/messages`).set(auth()).send({ body: '   ' })
      const huge = await request(app()).post(`/messages/conversations/${CONV}/messages`).set(auth()).send({ body: 'x'.repeat(4001) })
      expect(empty.status).toBe(400)
      expect(huge.status).toBe(400)
    })

    it('limita los envíos por persona', async () => {
      hitRateLimitMock.mockResolvedValue({ limited: true, retryAfterSeconds: 20 })
      const res = await request(app()).post(`/messages/conversations/${CONV}/messages`).set(auth()).send({ body: 'hola' })
      expect(res.status).toBe(429)
      expect(res.headers['retry-after']).toBe('20')
      expect(hitRateLimitMock).toHaveBeenCalledWith(expect.objectContaining({ bucket: 'messages-send' }), ME)
      expect(prismaMock.directMessage.create).not.toHaveBeenCalled()
    })
  })

  it('marcar leída y destacar actúan sobre la membresía propia', async () => {
    prismaMock.conversationMember.update.mockResolvedValue({})

    await request(app()).post(`/messages/conversations/${CONV}/read`).set(auth())
    const star = await request(app()).put(`/messages/conversations/${CONV}/star`).set(auth()).send({ starred: true })

    expect(star.body).toEqual({ ok: true, starred: true })
    const [read, starred] = prismaMock.conversationMember.update.mock.calls.map(([arg]) => arg)
    expect(read).toMatchObject({ where: { conversationId_userId: { conversationId: CONV, userId: ME } }, data: { lastReadAt: expect.any(Date) } })
    expect(starred).toMatchObject({ where: { conversationId_userId: { conversationId: CONV, userId: ME } }, data: { starred: true } })
  })
})
