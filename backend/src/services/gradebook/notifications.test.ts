import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  endorsedNotification,
  excerpt,
  messageNotification,
  notifyGradeBook,
  observationNotification,
  resolveGradeBookRecipients,
  SUPERVISION_MESSAGE_ROLES,
  threadsStartedBy,
} from './notifications.js'

const { prismaMock, pushMock } = vi.hoisted(() => ({
  prismaMock: {
    gradeBook: { findUnique: vi.fn() },
    inAppNotification: { createMany: vi.fn() },
  },
  pushMock: vi.fn(),
}))

vi.mock('../webPush.js', () => ({ sendWebPushPayloadToUser: pushMock }))

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.inAppNotification.createMany.mockResolvedValue({ count: 1 })
  pushMock.mockResolvedValue({ sent: 1, failed: 0 })
})

describe('excerpt', () => {
  it('deja el texto corto tal cual', () => {
    expect(excerpt('Falta un alumno.')).toBe('Falta un alumno.')
  })

  it('normaliza saltos de línea y espacios', () => {
    expect(excerpt('Falta\n  un   alumno.')).toBe('Falta un alumno.')
  })

  it('corta sin partir palabras', () => {
    const result = excerpt('palabra '.repeat(40), 30)
    expect(result.endsWith('…')).toBe(true)
    expect(result.length).toBeLessThanOrEqual(31)
    expect(result).not.toMatch(/pala…$/)
  })
})

describe('resolveGradeBookRecipients', () => {
  it('avisa al titular', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue({ teacherUserId: 't-1' })
    expect(await resolveGradeBookRecipients('gb-1', 'otro', prismaMock as any)).toEqual([{ userId: 't-1' }])
  })

  it('NO avisa a quien originó la acción', async () => {
    // Nadie necesita que le notifiquen lo que acaba de hacer.
    prismaMock.gradeBook.findUnique.mockResolvedValue({ teacherUserId: 't-1' })
    expect(await resolveGradeBookRecipients('gb-1', 't-1', prismaMock as any)).toEqual([])
  })

  it('una libreta sin titular no genera avisos', async () => {
    prismaMock.gradeBook.findUnique.mockResolvedValue({ teacherUserId: null })
    expect(await resolveGradeBookRecipients('gb-1', null, prismaMock as any)).toEqual([])
  })
})

describe('notifyGradeBook', () => {
  const notification = { type: 'GRADEBOOK_MESSAGE' as const, title: 'T', body: 'B', actionUrl: '/x' }

  it('inserta un aviso por destinatario', async () => {
    prismaMock.inAppNotification.createMany.mockResolvedValue({ count: 2 })
    const sent = await notifyGradeBook([{ userId: 'a' }, { userId: 'b' }], notification, prismaMock as any)
    expect(sent).toBe(2)
  })

  it('sin destinatarios no toca la base', async () => {
    await notifyGradeBook([], notification, prismaMock as any)
    expect(prismaMock.inAppNotification.createMany).not.toHaveBeenCalled()
  })

  it('un fallo del aviso NO tumba la operación que lo originó', async () => {
    // Observar una libreta tiene que quedar registrado aunque la campana falle.
    prismaMock.inAppNotification.createMany.mockRejectedValue(new Error('db caída'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(notifyGradeBook([{ userId: 'a' }], notification, prismaMock as any)).resolves.toBe(0)
    error.mockRestore()
  })

  it('también sale por push, a la pantalla del aviso', async () => {
    await notifyGradeBook([{ userId: 'a' }], notification, prismaMock as any)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(pushMock).toHaveBeenCalledWith('a', expect.objectContaining({ title: 'T', body: 'B', url: '/x' }))
  })
})

describe('armado de los avisos', () => {
  it('la observación dice sección y período, y apunta a la libreta', () => {
    const n = observationNotification({
      subjectName: 'Matemática',
      periodName: 'Mayo',
      sectionLabel: 'Calificaciones',
      observations: 'Falta un alumno.',
      gradeBookId: 'gb-1',
    })
    expect(n.title).toBe('Observación en Matemática · Mayo')
    expect(n.body).toBe('Calificaciones: Falta un alumno.')
    // El aviso lleva a la sección donde está la observación, no a la portada de la libreta.
    expect(n.actionUrl).toBe('/libreta/gb-1/cierre')
  })

  it('sin período nombra sólo la asignatura', () => {
    const n = observationNotification({
      subjectName: 'Matemática', periodName: null, sectionLabel: 'Cierre',
      observations: 'x', gradeBookId: 'gb-1',
    })
    expect(n.title).toBe('Observación en Matemática')
  })

  it('el visado y el mensaje usan tipos distintos para poder filtrarlos', () => {
    expect(endorsedNotification({ subjectName: 'M', periodName: 'Mayo', gradeBookId: 'gb-1' }).type).toBe('GRADEBOOK_ENDORSED')
    expect(messageNotification({ subjectName: 'M', authorName: 'Ana', body: 'Hola', gradeBookId: 'gb-1' }).type).toBe('GRADEBOOK_MESSAGE')
  })

  it('cada aviso lleva a la sección donde está lo que se avisa', () => {
    // Estas rutas son del front: si el módulo se reorganiza, este test avisa antes que el usuario
    // se coma un 404 desde la campana de notificaciones.
    expect(endorsedNotification({ subjectName: 'M', periodName: 'Mayo', gradeBookId: 'gb-1' }).actionUrl)
      .toBe('/libreta/gb-1/cierre')
    expect(messageNotification({ subjectName: 'M', authorName: 'Ana', body: 'Hola', gradeBookId: 'gb-1' }).actionUrl)
      .toBe('/libreta/gb-1/cierre')
  })

  it('un mensaje sin autor conocido no rompe el texto', () => {
    const n = messageNotification({ subjectName: 'M', authorName: null, body: 'Hola', gradeBookId: 'gb-1' })
    expect(n.body).toBe('Alguien: Hola')
  })
})

describe('mensajes de la supervisión al docente', () => {
  const msg = (id: string, authorRoleCode: string, parentId: string | null = null) => ({ id, authorRoleCode, parentId })

  it('trae los hilos que abrieron Dirección, Administración y Adscripción, con sus respuestas', () => {
    const all = [
      msg('d1', 'DIRECCION'),
      msg('a1', 'ADSCRIPTO'),
      msg('ad1', 'ADMIN'),
      msg('t1', 'TEACHER'),
      msg('r1', 'TEACHER', 'd1'),
      msg('r2', 'TEACHER', 'a1'),
      msg('r3', 'DIRECCION', 'd1'),
      msg('r4', 'TEACHER', 'ad1'),
      msg('r5', 'DIRECCION', 't1'),
    ]
    expect(threadsStartedBy(all, SUPERVISION_MESSAGE_ROLES).map((m) => m.id)).toEqual(['d1', 'a1', 'ad1', 'r1', 'r2', 'r3', 'r4'])
  })

  it('un hilo que abrió el docente no aparece aunque Dirección le haya respondido', () => {
    expect(threadsStartedBy([msg('t1', 'TEACHER'), msg('r1', 'DIRECCION', 't1')], SUPERVISION_MESSAGE_ROLES)).toEqual([])
  })

  it('con un solo rol se queda con los hilos de ese rol', () => {
    expect(threadsStartedBy([msg('a1', 'ADSCRIPTO'), msg('r1', 'DIRECCION', 'a1')], ['DIRECCION'])).toEqual([])
  })

  it('la respuesta del docente le llega a quien supervisa en Visado', () => {
    const n = messageNotification({ subjectName: 'M', authorName: 'Ana', body: 'Listo', gradeBookId: 'gb-1', recipient: 'supervisor' })
    expect(n).toMatchObject({ title: 'Respuesta en M', actionUrl: '/libreta/gb-1/visado' })
  })
})
