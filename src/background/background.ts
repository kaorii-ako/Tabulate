import { callAI } from '../lib/ai'
import { providerById } from '../lib/providers'
import type {
  AIConfig,
  ArchivedTab,
  BackgroundRequest,
  CachedClustering,
  TabSignal,
} from '../lib/types'

declare const __BAKED_API_KEY__: string

const DASHBOARD_URL = chrome.runtime.getURL('dashboard.html')
const OWN_ORIGIN = chrome.runtime.getURL('')

const RESTRICTED = [
  /^chrome:\/\//i,
  /^chrome-extension:\/\//i,
  /^edge:\/\//i,
  /^brave:\/\//i,
  /^about:/i,
  /^devtools:\/\//i,
  /^view-source:/i,
  /^https:\/\/chrome\.google\.com\/webstore/i,
  /^https:\/\/chromewebstore\.google\.com/i,
]

function isEligible(url: string | undefined): url is string {
  if (!url) return false
  if (url.toLowerCase().split('?')[0].endsWith('.pdf')) return false
  return !RESTRICTED.some((r) => r.test(url))
}

function grabSignal(): string {
  const pick = (sel: string, attr?: string) => {
    const el = document.querySelector(sel)
    if (!el) return ''
    return (attr ? el.getAttribute(attr) : el.textContent) || ''
  }
  const text =
    pick('meta[name="description"]', 'content') ||
    pick('meta[property="og:description"]', 'content') ||
    pick('h1') ||
    pick('h2')
  return text.replace(/\s+/g, ' ').trim().slice(0, 300)
}

async function getConfig(): Promise<AIConfig> {
  const st = await chrome.storage.local.get(['provider', 'apiKey', 'model', 'baseUrl'])
  const p = providerById(typeof st.provider === 'string' ? st.provider : undefined)

  let key = typeof st.apiKey === 'string' ? st.apiKey : ''
  // Baked key only applies to the default (Anthropic) provider.
  if (!key && p.kind === 'anthropic' && typeof __BAKED_API_KEY__ !== 'undefined') {
    key = __BAKED_API_KEY__
  }

  const baseUrl = (p.custom ? String(st.baseUrl || '') : p.baseUrl).replace(/\/+$/, '')
  const model = typeof st.model === 'string' && st.model ? st.model : p.defaultModel

  return { provider: p.id, kind: p.kind, baseUrl, model, apiKey: key }
}

async function openDashboard() {
  const existing = await chrome.tabs.query({ url: DASHBOARD_URL })
  if (existing.length > 0 && existing[0].id != null) {
    await chrome.tabs.update(existing[0].id, { active: true })
    if (existing[0].windowId != null) {
      await chrome.windows.update(existing[0].windowId, { focused: true })
    }
    return
  }
  await chrome.tabs.create({ url: DASHBOARD_URL })
}

chrome.action.onClicked.addListener(() => {
  void openDashboard()
})

async function collectTabs(): Promise<{
  signals: TabSignal[]
  tabs: Record<number, ArchivedTab>
}> {
  const open = await chrome.tabs.query({ currentWindow: true })
  const tabs: Record<number, ArchivedTab> = {}
  const signals: TabSignal[] = []

  await Promise.all(
    open.map(async (t) => {
      if (t.id == null) return
      const url = t.url || ''
      if (url.startsWith(OWN_ORIGIN)) return
      const title = t.title || '(untitled)'
      tabs[t.id] = { title, url, favIconUrl: t.favIconUrl }

      let signal = ''
      if (isEligible(url)) {
        try {
          const [res] = await chrome.scripting.executeScript({
            target: { tabId: t.id },
            func: grabSignal,
          })
          signal = (res?.result as string) || ''
        } catch {
          signal = ''
        }
      }
      signals.push({
        id: t.id,
        title,
        url,
        favIconUrl: t.favIconUrl,
        signal: signal.slice(0, 200),
      })
    }),
  )

  signals.sort((a, b) => a.id - b.id)
  return { signals, tabs }
}

function sanitizeClusters(
  raw: { name: string; summary: string; tabIds: number[] }[],
  signals: TabSignal[],
): { name: string; summary: string; tabIds: number[] }[] {
  const valid = new Set(signals.map((s) => s.id))
  const seen = new Set<number>()
  const clusters = raw
    .map((c) => ({
      ...c,
      tabIds: c.tabIds.filter((id) => {
        if (!valid.has(id) || seen.has(id)) return false
        seen.add(id)
        return true
      }),
    }))
    .filter((c) => c.tabIds.length > 0)

  const leftover = signals.filter((s) => !seen.has(s.id)).map((s) => s.id)
  if (leftover.length > 0) {
    clusters.push({
      name: 'Ungrouped',
      summary: 'Tabs the model did not place in a cluster.',
      tabIds: leftover,
    })
  }
  return clusters
}

async function cluster(force: boolean): Promise<CachedClustering> {
  const win = await chrome.windows.getCurrent()

  if (!force) {
    const { lastClustering } = await chrome.storage.local.get('lastClustering')
    // Only reuse the cache for the window it was built from — tab IDs are
    // per-window, so a cross-window hit would render the wrong tabs.
    if (lastClustering && (lastClustering as CachedClustering).windowId === win.id) {
      return lastClustering as CachedClustering
    }
  }

  const cfg = await getConfig()
  if (!cfg.apiKey) throw new Error('NO_API_KEY')
  if (!cfg.baseUrl) throw new Error('No API base URL set for this provider.')

  const { signals, tabs } = await collectTabs()
  if (signals.length === 0) throw new Error('No clusterable tabs in this window.')
  const raw = await callAI(cfg, signals)
  const clusters = sanitizeClusters(raw, signals)

  const result: CachedClustering = {
    windowId: win.id ?? -1,
    createdAt: Date.now(),
    clusters,
    tabs,
  }
  await chrome.storage.local.set({ lastClustering: result })
  return result
}

chrome.runtime.onMessage.addListener(
  (msg: BackgroundRequest, _sender, sendResponse) => {
    if (msg?.type === 'CLUSTER') {
      cluster(!!msg.force)
        .then((result) => sendResponse({ ok: true, result }))
        .catch((err) =>
          sendResponse({ ok: false, error: err?.message || String(err) }),
        )
      return true
    }
    if (msg?.type === 'INVALIDATE') {
      chrome.storage.local
        .remove('lastClustering')
        .then(() => sendResponse({ ok: true }))
      return true
    }
    return false
  },
)
