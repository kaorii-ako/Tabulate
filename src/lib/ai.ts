import type { AIConfig, Cluster, TabSignal } from './types'

const SYSTEM = [
  'You are a browser-tab clustering engine.',
  'Group the given tabs into a small number of meaningful clusters by task or topic,',
  'using the title, URL, and content signal of each tab.',
  'Respond with ONLY a JSON object. No markdown, no code fences, no commentary.',
  'Schema: {"clusters":[{"name":string,"summary":string,"tabIds":number[]}]}',
  'Rules: name is <= 4 words; summary is one line <= 12 words;',
  'every input tabId must appear in exactly one cluster; aim for 2 to 7 clusters.',
].join(' ')

const MAX_TOKENS = 4096

export async function callAI(cfg: AIConfig, tabs: TabSignal[]): Promise<Cluster[]> {
  if (!cfg.baseUrl) throw new Error('No API base URL configured')
  try {
    const u = new URL(cfg.baseUrl)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      throw new Error('Invalid API base URL protocol')
    }
  } catch {
    throw new Error('Invalid API base URL')
  }

  const payload = tabs.map((t) => ({
    id: t.id,
    title: t.title.slice(0, 160),
    url: t.url.slice(0, 200),
    signal: t.signal,
  }))
  const userText = 'Tabs:\n' + JSON.stringify(payload)

  let text: string
  if (cfg.kind === 'anthropic') text = await callAnthropic(cfg, userText)
  else if (cfg.kind === 'gemini') text = await callGemini(cfg, userText)
  else text = await callOpenAI(cfg, userText)

  return parseClusters(text)
}

async function fail(res: Response, provider: string): Promise<never> {
  const body = await res.text().catch(() => '')
  throw new Error(`${provider} API ${res.status}: ${body.slice(0, 300)}`)
}

async function callAnthropic(cfg: AIConfig, userText: string): Promise<string> {
  const res = await fetch(`${cfg.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: MAX_TOKENS,
      system: SYSTEM,
      messages: [{ role: 'user', content: userText }],
    }),
  })
  if (!res.ok) await fail(res, 'Anthropic')
  const data = await res.json()
  return data?.content?.[0]?.text ?? ''
}

async function callOpenAI(cfg: AIConfig, userText: string): Promise<string> {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userText },
      ],
    }),
  })
  if (!res.ok) await fail(res, 'OpenAI-compatible')
  const data = await res.json()
  return data?.choices?.[0]?.message?.content ?? ''
}

async function callGemini(cfg: AIConfig, userText: string): Promise<string> {
  const url =
    `${cfg.baseUrl}/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent` +
    `?key=${encodeURIComponent(cfg.apiKey)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: MAX_TOKENS },
    }),
  })
  if (!res.ok) await fail(res, 'Gemini')
  const data = await res.json()
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
}

function sanitizeText(s: string): string {
  return s.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, '').trim()
}

function parseClusters(text: string): Cluster[] {
  let s = text.trim()
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  }
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start !== -1 && end > start && (start > 0 || end < s.length - 1)) {
    s = s.slice(start, end + 1)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(s)
  } catch {
    throw new Error('AI returned non-JSON output')
  }

  const raw =
    parsed && typeof parsed === 'object' && Array.isArray((parsed as any).clusters)
      ? (parsed as any).clusters
      : []

  return raw
    .map(
      (c: any): Cluster => ({
        name: sanitizeText(String(c?.name ?? 'Untitled')).slice(0, 60),
        summary: sanitizeText(String(c?.summary ?? '')).slice(0, 200),
        tabIds: Array.isArray(c?.tabIds)
          ? c.tabIds.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n))
          : [],
      }),
    )
    .filter((c: Cluster) => c.tabIds.length > 0)
}
