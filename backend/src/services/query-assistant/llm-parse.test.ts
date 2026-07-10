import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }))

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

import { parseQuestionWithLlm } from './llm-parse.js'

const ORIGINAL_KEY = process.env.OPENAI_API_KEY
const ORIGINAL_PROVIDER = process.env.QUERY_ASSISTANT_LLM_PROVIDER
const ORIGINAL_OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL

beforeEach(() => {
  createMock.mockReset()
  process.env.OPENAI_API_KEY = 'sk-test-key'
  delete process.env.QUERY_ASSISTANT_LLM_PROVIDER
  delete process.env.OLLAMA_BASE_URL
  delete process.env.QUERY_ASSISTANT_DISABLE_HEURISTIC
})

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.OPENAI_API_KEY
  else process.env.OPENAI_API_KEY = ORIGINAL_KEY
  if (ORIGINAL_PROVIDER === undefined) delete process.env.QUERY_ASSISTANT_LLM_PROVIDER
  else process.env.QUERY_ASSISTANT_LLM_PROVIDER = ORIGINAL_PROVIDER
  if (ORIGINAL_OLLAMA_BASE_URL === undefined) delete process.env.OLLAMA_BASE_URL
  else process.env.OLLAMA_BASE_URL = ORIGINAL_OLLAMA_BASE_URL
})

describe('parseQuestionWithLlm — fast path heurístico', () => {
  it('resuelve "horas trabajadas mayo" sin llamar a OpenAI', async () => {
    const r = await parseQuestionWithLlm('horas trabajadas mayo', { defaultYear: 2026 })
    expect(r.intent).toBe('HOURS_WORKED_SUMMARY')
    expect(r.params.month).toBe(5)
    expect(r.params.year).toBe(2026)
    expect(createMock).not.toHaveBeenCalled()
  })

  it('resuelve "lista de usuarios" sin tokens', async () => {
    const r = await parseQuestionWithLlm('lista de usuarios', { defaultYear: 2026 })
    expect(r.intent).toBe('USERS_ADMIN_SNAPSHOT')
    expect(createMock).not.toHaveBeenCalled()
  })

  it('respeta QUERY_ASSISTANT_DISABLE_HEURISTIC=1 y cae al LLM', async () => {
    process.env.QUERY_ASSISTANT_DISABLE_HEURISTIC = '1'
    createMock.mockResolvedValue({
      choices: [
        { message: { content: JSON.stringify({ intent: 'HOURS_WORKED_SUMMARY', params: { month: 5, year: 2026 }, reply: 'ok' }) } },
      ],
    })
    await parseQuestionWithLlm('horas trabajadas mayo', { defaultYear: 2026 })
    expect(createMock).toHaveBeenCalledTimes(1)
  })
})

describe('parseQuestionWithLlm — fallback al LLM', () => {
  it('llama a OpenAI cuando la heurística no clasifica', async () => {
    createMock.mockResolvedValue({
      choices: [
        { message: { content: JSON.stringify({ intent: 'AUDIT_LOG_SUMMARY', params: { month: 5, year: 2026 }, reply: 'ok' }) } },
      ],
    })
    const r = await parseQuestionWithLlm('mostrame cosas indescifrables xyzzy', { defaultYear: 2026 })
    expect(r.intent).toBe('AUDIT_LOG_SUMMARY')
    expect(createMock).toHaveBeenCalledTimes(1)
  })

  it('el prompt de clasificación NO arrastra el esquema completo de tablas (ahorro de tokens)', async () => {
    createMock.mockResolvedValue({
      choices: [
        { message: { content: JSON.stringify({ intent: 'UNKNOWN', params: {}, reply: 'ok' }) } },
      ],
    })
    await parseQuestionWithLlm('mostrame cosas indescifrables xyzzy', { defaultYear: 2026 })
    const arg = createMock.mock.calls[0][0]
    const system = arg.messages.find((m: { role: string }) => m.role === 'system')
    const user = arg.messages.find((m: { role: string }) => m.role === 'user')
    expect(system.content).toContain('Mapa semántico')
    expect(system.content).not.toContain('Tabla "AuditLog"')
    // El contexto volátil (fecha/año) viaja en el mensaje del usuario, no en el system.
    expect(user.content).toContain('Consulta:')
  })

  it('con QUERY_ASSISTANT_LLM_PROVIDER=ollama usa prompt compacto', async () => {
    process.env.QUERY_ASSISTANT_LLM_PROVIDER = 'ollama'
    process.env.OLLAMA_BASE_URL = 'http://127.0.0.1:11434'
    createMock.mockResolvedValue({
      choices: [
        { message: { content: JSON.stringify({ intent: 'UNKNOWN', params: {}, reply: 'ok' }) } },
      ],
    })
    await parseQuestionWithLlm('consulta libre para clasificación', { defaultYear: 2026 })
    const arg = createMock.mock.calls[0][0]
    const system = arg.messages.find((m: { role: string }) => m.role === 'system')
    expect(system.content).toContain('Clasificá la consulta en un JSON válido')
    expect(system.content).not.toContain('Mapa semántico')
  })
})
