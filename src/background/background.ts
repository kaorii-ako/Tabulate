import { callAnthropic } from '../lib/ai'
import type {
  ArchivedTab,
  BackgroundRequest,
  CachedClustering,
  TabSignal,
} from '../lib/types'

declare const __BAKED_API_KEY__: string

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

async function getApiKey(): Promise<string> {
  const { apiKey } = await chrome.storage.local.get('apiKey')
  if (typeof apiKey === 'string' && apiKey) return apiKey
  return typeof __BAKED_API_KEY__ !== 'undefined' ? __BAKED_API_KEY__ : ''
}

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
      const title = t.title || '(untitled)'
      const url = t.url || ''
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

async function cluster(force: boolean): Promise<CachedClustering> {
  if (!force) {
    const { lastClustering } = await chrome.storage.local.get('lastClustering')
    if (lastClustering) return lastClustering as CachedClustering
  }

  const key = await getApiKey()
  if (!key) throw new Error('NO_API_KEY')

  const { signals, tabs } = await collectTabs()
  if (signals.length === 0) throw new Error('No open tabs to cluster.')

  const win = await chrome.windows.getCurrent()
  const clusters = await callAnthropic(key, signals)

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
