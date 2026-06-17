export type ProviderKind = 'anthropic' | 'openai' | 'gemini'

export interface Provider {
  id: string
  label: string
  kind: ProviderKind
  baseUrl: string
  defaultModel: string
  keyHint: string
  custom?: boolean // base URL is user-supplied
}

// Most vendors expose an OpenAI-compatible /chat/completions endpoint, so one
// "openai" code path covers the long tail. Anthropic and Gemini get their own.
export const PROVIDERS: Provider[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', defaultModel: 'claude-sonnet-4-6', keyHint: 'sk-ant-...' },
  { id: 'openai', label: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini', keyHint: 'sk-...' },
  { id: 'gemini', label: 'Google Gemini', kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com', defaultModel: 'gemini-2.0-flash', keyHint: 'AIza...' },
  { id: 'groq', label: 'Groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile', keyHint: 'gsk_...' },
  { id: 'openrouter', label: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'openai/gpt-4o-mini', keyHint: 'sk-or-...' },
  { id: 'deepseek', label: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-chat', keyHint: 'sk-...' },
  { id: 'mistral', label: 'Mistral', kind: 'openai', baseUrl: 'https://api.mistral.ai/v1', defaultModel: 'mistral-small-latest', keyHint: '...' },
  { id: 'xai', label: 'xAI (Grok)', kind: 'openai', baseUrl: 'https://api.x.ai/v1', defaultModel: 'grok-2-latest', keyHint: 'xai-...' },
  { id: 'together', label: 'Together AI', kind: 'openai', baseUrl: 'https://api.together.xyz/v1', defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', keyHint: '...' },
  { id: 'mimo', label: 'Xiaomi MiMo', kind: 'openai', baseUrl: 'https://api.xiaomimimo.com/v1', defaultModel: 'mimo-v2-flash', keyHint: 'API key' },
  { id: 'custom', label: 'Custom (OpenAI-compatible)', kind: 'openai', baseUrl: '', defaultModel: '', keyHint: 'API key', custom: true },
]

export function providerById(id: string | undefined): Provider {
  return PROVIDERS.find((p) => p.id === id) || PROVIDERS[0]
}
