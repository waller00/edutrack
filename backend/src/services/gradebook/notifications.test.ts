import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  endorsedNotification,
  excerpt,
  messageNotification,
  notifyGradeBook,
  observationNotification,
  resolveGradeBookRecipients,
} from './notifications.js'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    gradeBook: { findUnique: vi.fn() },
    inAppNotification: { createMany: vi.fn() },
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.inAppNotification.createMany.mockResolvedValue({ count: 1 })
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
    await expect(notifyGradeBook([{ userId: 'a' }], notification, prismaMock as any)).resolves.toBe(0)
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
    expect(n.actionUrl).toBe('/libreta/gb-1/visados')
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
      .toBe('/libreta/gb-1/visados')
    expect(messageNotification({ subjectName: 'M', authorName: 'Ana', body: 'Hola', gradeBookId: 'gb-1' }).actionUrl)
      .toBe('/libreta/gb-1/mensajes')
  })

  it('un mensaje sin autor conocido no rompe el texto', () => {
    const n = messageNotification({ subjectName: 'M', authorName: null, body: 'Hola', gradeBookId: 'gb-1' })
    expect(n.body).toBe('Alguien: Hola')
  })
})
