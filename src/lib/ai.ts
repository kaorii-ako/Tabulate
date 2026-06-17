import type { Cluster, TabSignal } from './types'

const API_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-4-6'

const SYSTEM = [
  'You are a browser-tab clustering engine.',
  'Group the given tabs into a small number of meaningful clusters by task or topic,',
  'using the title, URL, and content signal of each tab.',
  'Respond with ONLY a JSON object. No markdown, no code fences, no commentary.',
  'Schema: {"clusters":[{"name":string,"summary":string,"tabIds":number[]}]}',
  'Rules: name is <= 4 words; summary is one line <= 12 words;',
  'every input tabId must appear in exactly one cluster; aim for 2 to 7 clusters.',
].join(' ')

export async function callAnthropic(
  apiKey: string,
  tabs: TabSignal[],
): Promise<Cluster[]> {
  const payload = tabs.map((t) => ({
    id: t.id,
    title: t.title.slice(0, 160),
    url: t.url.slice(0, 200),
    signal: t.signal,
  }))

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM,
      messages: [{ role: 'user', content: 'Tabs:\n' + JSON.stringify(payload) }],
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 300)}`)
  }

  const data = await res.json()
  const text: string = data?.content?.[0]?.text ?? ''
  return parseClusters(text)
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
        name: String(c?.name ?? 'Untitled'),
        summary: String(c?.summary ?? ''),
        tabIds: Array.isArray(c?.tabIds)
          ? c.tabIds.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n))
          : [],
      }),
    )
    .filter((c: Cluster) => c.tabIds.length > 0)
}
