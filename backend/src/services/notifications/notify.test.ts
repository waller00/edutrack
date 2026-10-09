import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, pushMock } = vi.hoisted(() => ({
  prismaMock: { inAppNotification: { createMany: vi.fn() } },
  pushMock: vi.fn(),
}))

vi.mock('../../db/prisma.js', () => ({ prisma: prismaMock }))
vi.mock('../webPush.js', () => ({ sendWebPushPayloadToUser: pushMock }))

import { notifyUsers, pushToUsers } from './notify.js'

const aviso = {
  type: 'GRADEBOOK_MESSAGE' as const,
  title: 'Mensaje en Matemática',
  body: 'Ana: revisá la planificación',
  actionUrl: '/libreta/gb-1/mensajes',
}

/** Los push salen sin esperar: se da una vuelta al ciclo para verlos. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('notifyUsers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.inAppNotification.createMany.mockResolvedValue({ count: 2 })
    pushMock.mockResolvedValue({ sent: 1, failed: 0 })
  })

  it('deja un aviso en la campana por usuario, sin repetir ni vacíos', async () => {
    const created = await notifyUsers(['u1', 'u2', 'u1', null, undefined], aviso)

    expect(created).toBe(2)
    expect(prismaMock.inAppNotification.createMany).toHaveBeenCalledWith({
      data: [
        { userId: 'u1', ...aviso },
        { userId: 'u2', ...aviso },
      ],
    })
  })

  it('manda el push a cada uno, con la pantalla del aviso y una etiqueta propia', async () => {
    await notifyUsers(['u1', 'u2'], aviso)
    await flush()

    expect(pushMock).toHaveBeenCalledTimes(2)
    const [userId, payload] = pushMock.mock.calls[0]
    expect(userId).toBe('u1')
    expect(payload).toMatchObject({ title: aviso.title, body: aviso.body, url: aviso.actionUrl })
    expect(payload.tag).toMatch(/^edutrack-/)
  })

  it('dos avisos seguidos no comparten etiqueta (no se pisan en el celular)', async () => {
    await notifyUsers(['u1'], aviso)
    await notifyUsers(['u1'], aviso)
    await flush()

    expect(pushMock.mock.calls[0][1].tag).not.toBe(pushMock.mock.calls[1][1].tag)
  })

  it('con push: false sólo queda en la campana', async () => {
    await notifyUsers(['u1'], aviso, { push: false })
    await flush()

    expect(prismaMock.inAppNotification.createMany).toHaveBeenCalled()
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('sin destinatarios no hace nada', async () => {
    expect(await notifyUsers([], aviso)).toBe(0)
    expect(prismaMock.inAppNotification.createMany).not.toHaveBeenCalled()
  })

  it('si la base falla no corta la acción, y el push igual sale', async () => {
    prismaMock.inAppNotification.createMany.mockRejectedValue(new Error('db caída'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(notifyUsers(['u1'], aviso)).resolves.toBe(0)
    await flush()

    expect(pushMock).toHaveBeenCalledTimes(1)
    error.mockRestore()
  })

  it('un push que falla no corta nada', async () => {
    pushMock.mockRejectedValue(new Error('410'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(pushToUsers(['u1'], aviso)).resolves.toBeUndefined()
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it('un aviso sin pantalla lleva al inicio', async () => {
    await pushToUsers(['u1'], { ...aviso, actionUrl: null })
    expect(pushMock.mock.calls[0][1].url).toBe('/')
  })
})
