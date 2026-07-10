import OpenAI from 'openai'

export type QueryAssistantLlmProvider = 'openai' | 'ollama'

type ProviderConfig = {
  provider: QueryAssistantLlmProvider
  client: OpenAI
}

function parseProvider(raw: string | undefined): QueryAssistantLlmProvider {
  const value = raw?.trim().toLowerCase()
  if (!value || value === 'openai') return 'openai'
  if (value === 'ollama') return 'ollama'
  throw new Error(
    `QUERY_ASSISTANT_LLM_PROVIDER_INVALID: Valor no soportado "${raw}". Usá "openai" o "ollama".`,
  )
}

function createOpenAiClient(): ProviderConfig {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) throw new Error('OPENAI_API_KEY_NOT_CONFIGURED')
  if (!apiKey.startsWith('sk-')) {
    throw new Error(
      'OPENAI_API_KEY_INVALID_FORMAT: Usá una "Secret key" de OpenAI que empiece con sk- (creada en https://platform.openai.com/api-keys). Sin comillas ni espacios en el .env.',
    )
  }
  return {
    provider: 'openai',
    client: new OpenAI({ apiKey }),
  }
}

function normalizeOllamaBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`
}

function createOllamaClient(): ProviderConfig {
  const baseUrlRaw = process.env.OLLAMA_BASE_URL?.trim()
  if (!baseUrlRaw) {
    throw new Error('OLLAMA_BASE_URL_NOT_CONFIGURED')
  }
  return {
    provider: 'ollama',
    // Ollama no requiere API key; se usa un valor dummy para cumplir el SDK.
    client: new OpenAI({ apiKey: process.env.OLLAMA_API_KEY?.trim() || 'ollama-local', baseURL: normalizeOllamaBaseUrl(baseUrlRaw) }),
  }
}

export function getQueryAssistantLlmClient(): ProviderConfig {
  const provider = parseProvider(process.env.QUERY_ASSISTANT_LLM_PROVIDER)
  return provider === 'ollama' ? createOllamaClient() : createOpenAiClient()
}

export function defaultModelForProvider(provider: QueryAssistantLlmProvider): string {
  return provider === 'ollama' ? 'qwen2.5-coder:1.5b' : 'gpt-4.1-mini'
}

export function defaultIntentModelForProvider(provider: QueryAssistantLlmProvider): string {
  return provider === 'ollama' ? 'qwen2.5:1.5b' : 'gpt-4o-mini'
}

export function isQueryAssistantConfigErrorMessage(message: string): boolean {
  return (
    message === 'OPENAI_API_KEY_NOT_CONFIGURED' ||
    message.startsWith('OPENAI_API_KEY_INVALID_FORMAT:') ||
    message === 'OLLAMA_BASE_URL_NOT_CONFIGURED' ||
    message.startsWith('QUERY_ASSISTANT_LLM_PROVIDER_INVALID:')
  )
}
