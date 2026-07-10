import { afterEach, describe, expect, it } from 'vitest'
import {
  defaultIntentModelForProvider,
  defaultModelForProvider,
  getQueryAssistantLlmClient,
} from './llm-client.js'

const ORIGINALS = {
  provider: process.env.QUERY_ASSISTANT_LLM_PROVIDER,
  openAiKey: process.env.OPENAI_API_KEY,
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL,
  ollamaKey: process.env.OLLAMA_API_KEY,
}

afterEach(() => {
  if (ORIGINALS.provider === undefined) delete process.env.QUERY_ASSISTANT_LLM_PROVIDER
  else process.env.QUERY_ASSISTANT_LLM_PROVIDER = ORIGINALS.provider
  if (ORIGINALS.openAiKey === undefined) delete process.env.OPENAI_API_KEY
  else process.env.OPENAI_API_KEY = ORIGINALS.openAiKey
  if (ORIGINALS.ollamaBaseUrl === undefined) delete process.env.OLLAMA_BASE_URL
  else process.env.OLLAMA_BASE_URL = ORIGINALS.ollamaBaseUrl
  if (ORIGINALS.ollamaKey === undefined) delete process.env.OLLAMA_API_KEY
  else process.env.OLLAMA_API_KEY = ORIGINALS.ollamaKey
})

describe('llm-client', () => {
  it('crea cliente Ollama y normaliza baseUrl a /v1', () => {
    process.env.QUERY_ASSISTANT_LLM_PROVIDER = 'ollama'
    process.env.OLLAMA_BASE_URL = 'http://100.90.10.20:11434'
    delete process.env.OLLAMA_API_KEY

    const result = getQueryAssistantLlmClient()

    expect(result.provider).toBe('ollama')
    expect(result.client.baseURL).toBe('http://100.90.10.20:11434/v1')
  })

  it('rechaza proveedor no soportado', () => {
    process.env.QUERY_ASSISTANT_LLM_PROVIDER = 'otro'
    expect(() => getQueryAssistantLlmClient()).toThrow('QUERY_ASSISTANT_LLM_PROVIDER_INVALID')
  })

  it('mantiene defaults de modelo por proveedor', () => {
    expect(defaultModelForProvider('openai')).toBe('gpt-4.1-mini')
    expect(defaultModelForProvider('ollama')).toBe('qwen2.5-coder:1.5b')
    expect(defaultIntentModelForProvider('openai')).toBe('gpt-4o-mini')
    expect(defaultIntentModelForProvider('ollama')).toBe('qwen2.5:1.5b')
  })
})
