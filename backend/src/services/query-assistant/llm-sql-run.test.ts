import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const { createMock, queryRawUnsafeMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  queryRawUnsafeMock: vi.fn(),
}))

vi.mock('openai', () => {
  class APIError extends Error {
    status?: number
  }
  return {
    default: class {
      chat = { completions: { create: createMock } }
    },
    APIError,
  }
})

vi.mock('../../db/prisma.js', () => ({ prisma: { $queryRawUnsafe: queryRawUnsafeMock } }))

import { runNaturalLanguageSqlQuery } from './llm-sql.js'

const ORIGINAL_KEY = process.env.OPENAI_API_KEY

function planResponse(sql: string, title = 'Título', summary = 'Resumen') {
  return {
    choices: [{ message: { content: JSON.stringify({ title, summary, sql }) } }],
  }
}

beforeEach(() => {
  createMock.mockReset()
  queryRawUnsafeMock.mockReset()
  process.env.OPENAI_API_KEY = 'sk-test-key'
})

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.OPENAI_API_KEY
  else process.env.OPENAI_API_KEY = ORIGINAL_KEY
})

describe('runNaturalLanguageSqlQuery', () => {
  it('camino feliz: genera SQL, ejecuta y mapea filas (una sola llamada al modelo)', async () => {
    createMock.mockResolvedValue(planResponse('SELECT "User"."email" AS "Email" FROM "User"'))
    queryRawUnsafeMock.mockResolvedValue([{ Email: 'a@a.com' }])

    const r = await runNaturalLanguageSqlQuery('emails de usuarios')

    expect(createMock).toHaveBeenCalledTimes(1)
    expect(r.intent).toBe('SQL_QUERY')
    expect(r.rows).toEqual([{ Email: 'a@a.com' }])
    expect(r.columns).toEqual([{ key: 'Email', label: 'Email' }])
  })

  it('mueve el contexto volátil al mensaje del usuario y deja el system estático', async () => {
    createMock.mockResolvedValue(planResponse('SELECT "User"."email" FROM "User"'))
    queryRawUnsafeMock.mockResolvedValue([])

    await runNaturalLanguageSqlQuery('emails')

    const arg = createMock.mock.calls[0][0]
    const system = arg.messages.find((m: { role: string }) => m.role === 'system')
    const user = arg.messages.find((m: { role: string }) => m.role === 'user')
    expect(system.content).toContain('Tabla "User"')
    expect(system.content).not.toContain('Contexto temporal')
    expect(user.content).toContain('Contexto temporal')
    expect(user.content).toContain('Pregunta:')
  })

  it('repara una vez ante un error de columna inexistente y reintenta', async () => {
    createMock
      .mockResolvedValueOnce(planResponse('SELECT "User"."mail" FROM "User"'))
      .mockResolvedValueOnce(planResponse('SELECT "User"."email" FROM "User"'))
    queryRawUnsafeMock
      .mockRejectedValueOnce(new Error('column "mail" does not exist'))
      .mockResolvedValueOnce([{ email: 'b@b.com' }])

    const r = await runNaturalLanguageSqlQuery('emails')

    expect(createMock).toHaveBeenCalledTimes(2)
    expect(queryRawUnsafeMock).toHaveBeenCalledTimes(2)
    expect(r.rows).toEqual([{ email: 'b@b.com' }])

    // El segundo prompt incluye el error de la base para la auto-corrección.
    const repairMessages = createMock.mock.calls[1][0].messages
    expect(repairMessages.some((m: { content: string }) => m.content.includes('column "mail" does not exist'))).toBe(true)
    expect(repairMessages.some((m: { role: string }) => m.role === 'assistant')).toBe(true)
  })

  it('no reintenta ante errores no reparables y propaga', async () => {
    createMock.mockResolvedValue(planResponse('SELECT "User"."email" FROM "User"'))
    queryRawUnsafeMock.mockRejectedValue(new Error('connection terminated unexpectedly'))

    await expect(runNaturalLanguageSqlQuery('emails')).rejects.toThrow(/connection terminated/)
    expect(createMock).toHaveBeenCalledTimes(1)
  })

  it('rechaza SQL no-SELECT generado por el modelo antes de tocar la base', async () => {
    createMock.mockResolvedValue(planResponse('DELETE FROM "User"'))

    await expect(runNaturalLanguageSqlQuery('borrá todo')).rejects.toThrow('QUERY_ASSISTANT_SQL_NOT_SELECT')
    expect(queryRawUnsafeMock).not.toHaveBeenCalled()
  })
})
