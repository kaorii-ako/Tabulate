import { PROVIDERS, providerById } from '../lib/providers'
import type {
  ArchivedSession,
  ArchivedTab,
  CachedClustering,
  Cluster,
  ClusterResponse,
} from '../lib/types'

const OWN_ORIGIN = chrome.runtime.getURL('')

const titleEl = document.getElementById('title') as HTMLHeadingElement
const actionsEl = document.getElementById('actions') as HTMLDivElement
const contentEl = document.getElementById('content') as HTMLElement
const navEl = document.getElementById('nav') as HTMLElement

type View = 'overview' | 'clusters' | 'archived' | 'settings'
const VIEWS: View[] = ['overview', 'clusters', 'archived', 'settings']

let lastResult: CachedClustering | null = null
let archivedQuery = ''

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  Object.assign(node, props)
  for (const c of children) node.append(c)
  return node
}

function safeUrl(url: string | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

function favicon(url: string | undefined, size = 18): HTMLImageElement {
  const img = el('img', {})
  img.width = size
  img.height = size
  const safe = safeUrl(url)
  if (safe) img.src = safe
  else img.style.visibility = 'hidden'
  img.onerror = () => {
    img.style.visibility = 'hidden'
  }
  return img
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return d === 1 ? 'yesterday' : `${d}d ago`
}

function hueFor(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return h
}

function countUp(node: HTMLElement, to: number, ms = 650) {
  if (to <= 0) {
    node.textContent = '0'
    return
  }
  const start = performance.now()
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / ms)
    const eased = 1 - Math.pow(1 - t, 3)
    node.textContent = String(Math.round(eased * to))
    if (t < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

function stagger(container: HTMLElement) {
  Array.from(container.children).forEach((child, i) =>
    (child as HTMLElement).style.setProperty('--i', String(i)),
  )
}

function trackSpotlight(node: HTMLElement) {
  node.addEventListener('pointermove', (e) => {
    const r = node.getBoundingClientRect()
    node.style.setProperty('--mx', `${e.clientX - r.left}px`)
    node.style.setProperty('--my', `${e.clientY - r.top}px`)
  })
}

function spinner(text: string): HTMLElement {
  return el('div', { className: 'center fade' }, [
    el('div', { className: 'spinner' }),
    text,
  ])
}

function empty(icon: string, ...lines: string[]): HTMLElement {
  const box = el('div', { className: 'center fade' }, [
    el('div', { className: 'big' }, [icon]),
  ])
  lines.forEach((l, i) => box.append(i ? el('div', { className: 'muted' }, [l]) : l))
  return box
}

async function getOpenTabs(): Promise<chrome.tabs.Tab[]> {
  const tabs = await chrome.tabs.query({ currentWindow: true })
  return tabs.filter((t) => !(t.url || '').startsWith(OWN_ORIGIN))
}

async function getCache(): Promise<CachedClustering | null> {
  const { lastClustering } = await chrome.storage.local.get('lastClustering')
  return (lastClustering as CachedClustering) || null
}

async function loadArchived(): Promise<ArchivedSession[]> {
  const all = await chrome.storage.local.get(null)
  return Object.entries(all)
    .filter(([k]) => k.startsWith('session_'))
    .map(([key, v]) => ({ key, ...(v as Omit<ArchivedSession, 'key'>) }))
    .sort((a, b) => b.archivedAt - a.archivedAt)
}

function hostOf(url: string | undefined): string {
  try {
    return new URL(url || '').hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/* ---------- Tab navigation ---------- */

async function goToUrl(url: string) {
  const safe = safeUrl(url)
  if (!safe) return
  const tabs = await chrome.tabs.query({})
  const match = tabs.find((t) => t.url === safe)
  if (match?.id != null) {
    await chrome.tabs.update(match.id, { active: true })
    if (match.windowId != null) await chrome.windows.update(match.windowId, { focused: true })
  } else {
    await chrome.tabs.create({ url: safe })
  }
}

/* ---------- Command palette (Quick Switch) ---------- */

let paletteEl: HTMLElement | null = null

async function openPalette() {
  if (paletteEl) return
  const tabs = (await chrome.tabs.query({})).filter(
    (t) => t.id != null && !(t.url || '').startsWith(OWN_ORIGIN),
  )

  const input = el('input', {
    className: 'pal-input',
    placeholder: 'Jump to an open tab…',
    autocomplete: 'off',
    spellcheck: false,
  }) as HTMLInputElement
  const list = el('div', { className: 'pal-list' })
  const box = el('div', { className: 'pal-box' }, [
    el('div', { className: 'pal-field' }, [el('span', { className: 'pal-ico' }, ['⌕']), input]),
    list,
    el('div', { className: 'pal-foot' }, [
      el('span', {}, ['↑↓ navigate']),
      el('span', {}, ['↵ open']),
      el('span', {}, ['esc close']),
    ]),
  ])
  const overlay = el('div', { className: 'palette fade' }, [box])
  paletteEl = overlay
  document.body.append(overlay)

  let sel = 0
  let view: chrome.tabs.Tab[] = tabs

  const markSel = () =>
    Array.from(list.children).forEach((c, i) =>
      (c as HTMLElement).classList.toggle('sel', i === sel),
    )
  const scrollSel = () =>
    (list.children[sel] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' })

  const choose = async (i: number) => {
    const t = view[i]
    closePalette()
    if (t?.id != null) {
      await chrome.tabs.update(t.id, { active: true })
      if (t.windowId != null) await chrome.windows.update(t.windowId, { focused: true })
    }
  }

  const paint = () => {
    const q = input.value.trim().toLowerCase()
    view = q
      ? tabs.filter(
          (t) =>
            (t.title || '').toLowerCase().includes(q) || (t.url || '').toLowerCase().includes(q),
        )
      : tabs
    if (sel >= view.length) sel = Math.max(0, view.length - 1)
    list.replaceChildren(
      ...(view.length
        ? view.map((t, i) => {
            const row = el('div', { className: 'pal-row' + (i === sel ? ' sel' : '') }, [
              favicon(t.favIconUrl, 16),
              el('span', { className: 'pal-title' }, [t.title || '(untitled)']),
              el('span', { className: 'pal-url' }, [hostOf(t.url)]),
            ])
            row.onmouseenter = () => {
              sel = i
              markSel()
            }
            row.onclick = () => choose(i)
            return row
          })
        : [el('div', { className: 'pal-empty' }, ['No matching tabs'])]),
    )
  }

  input.oninput = () => {
    sel = 0
    paint()
  }
  overlay.onclick = (e) => {
    if (e.target === overlay) closePalette()
  }
  input.onkeydown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      sel = Math.min(view.length - 1, sel + 1)
      markSel()
      scrollSel()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      sel = Math.max(0, sel - 1)
      markSel()
      scrollSel()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (view.length) void choose(sel)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closePalette()
    }
  }

  paint()
  input.focus()
}

function closePalette() {
  paletteEl?.remove()
  paletteEl = null
}

/* ---------- Overview ---------- */

async function renderOverview() {
  setActions()
  contentEl.replaceChildren(spinner('Loading…'))

  const [openTabs, cache, sessions] = await Promise.all([
    getOpenTabs(),
    getCache(),
    loadArchived(),
  ])
  const tabsArchived = sessions.reduce((n, s) => n + s.tabs.length, 0)

  const stat = (num: number | null, label: string) => {
    const numEl = el('div', { className: 'num' }, [num === null ? '—' : '0'])
    if (num !== null) countUp(numEl, num)
    const card = el('div', { className: 'stat' }, [numEl, el('div', { className: 'label' }, [label])])
    trackSpotlight(card)
    return card
  }

  const grid = el('div', { className: 'stat-grid' }, [
    stat(openTabs.length, 'Open tabs (this window)'),
    stat(cache ? cache.clusters.length : null, 'Current clusters'),
    stat(sessions.length, 'Archived sessions'),
    stat(tabsArchived, 'Tabs archived total'),
  ])
  stagger(grid)

  const cta = el('button', { className: 'btn btn-accent' }, [
    cache ? 'View clusters' : 'Cluster my tabs',
  ])
  cta.onclick = () => {
    location.hash = '#clusters'
  }

  const wrap = el('div', { className: 'fade' }, [
    grid,
    el('div', { style: 'margin-bottom:28px' as any }, [cta]),
  ])

  if (sessions.length > 0) {
    wrap.append(el('div', { className: 'section-title' }, ['Recent archives']))
    for (const s of sessions.slice(0, 4)) {
      const row = el('div', { className: 'session' }, [
        el('div', { className: 'session-head' }, [
          el('span', { className: 'name' }, [s.name]),
          el('span', { className: 'sum' }, [s.summary || '']),
          el('span', { className: 'count' }, [`${s.tabs.length}`]),
          el('span', { className: 'when' }, [timeAgo(s.archivedAt)]),
        ]),
      ])
      row.onclick = () => {
        location.hash = '#archived'
      }
      row.style.cursor = 'pointer'
      wrap.append(row)
    }
  }

  contentEl.replaceChildren(wrap)
}

/* ---------- Clusters ---------- */

function setActions(...nodes: HTMLElement[]) {
  actionsEl.replaceChildren(...nodes)
}

async function renameCluster(cluster: Cluster, name: string) {
  cluster.name = name
  if (lastResult) await chrome.storage.local.set({ lastClustering: lastResult })
}

async function closeTabInCluster(cluster: Cluster, tabId: number, url: string) {
  const live = await chrome.tabs.query({})
  const match = live.find((t) => t.id === tabId && t.url === url) || live.find((t) => t.url === url)
  if (match?.id != null) await chrome.tabs.remove(match.id).catch(() => {})
  cluster.tabIds = cluster.tabIds.filter((id) => id !== tabId)
  if (lastResult) await chrome.storage.local.set({ lastClustering: lastResult })
  renderClusters()
}

function clusterCard(cluster: Cluster, tabs: Record<number, ArchivedTab>): HTMLElement {
  const metas = cluster.tabIds
    .map((id) => ({ id, meta: tabs[id] }))
    .filter((x) => x.meta) as { id: number; meta: ArchivedTab }[]

  const strip = el('div', { className: 'favstrip' })
  metas.slice(0, 10).forEach((m) => strip.append(favicon(m.meta.favIconUrl)))
  if (metas.length > 10) {
    strip.append(el('span', { className: 'more' }, [`+${metas.length - 10}`]))
  }

  const hue = hueFor(cluster.name)

  // Expandable tab list — activate or close individual tabs.
  const body = el('div', { className: 'cluster-tabs' })
  body.style.display = 'none'
  metas.forEach(({ id, meta }) => {
    const title = el('span', { className: 't' }, [meta.title])
    const close = el('button', { className: 'ctab-x', title: 'Close tab' }, ['✕'])
    close.onclick = (e) => {
      e.stopPropagation()
      void closeTabInCluster(cluster, id, meta.url)
    }
    const row = el('div', { className: 'ctab', title: meta.url }, [
      favicon(meta.favIconUrl, 15),
      title,
      el('span', { className: 'ctab-go' }, ['↗']),
      close,
    ])
    row.onclick = () => void goToUrl(meta.url)
    body.append(row)
  })

  const dot = el('span', { className: 'dot' })
  const name = el('span', { className: 'name', title: 'Double-click to rename' }, [cluster.name])
  const count = el('span', { className: 'count' }, [String(cluster.tabIds.length)])
  const chev = el('span', { className: 'chev' }, ['▸'])

  const head = el('div', { className: 'card-head' }, [dot, name, count, chev])
  head.onclick = () => {
    const open = body.style.display === 'none'
    body.style.display = open ? 'block' : 'none'
    chev.classList.toggle('open', open)
  }

  // Inline rename on double-click.
  name.ondblclick = (e) => {
    e.stopPropagation()
    const input = el('input', { className: 'rename', value: cluster.name }) as HTMLInputElement
    name.replaceWith(input)
    input.focus()
    input.select()
    const commit = async () => {
      const v = input.value.trim() || cluster.name
      await renameCluster(cluster, v)
      renderClusters()
    }
    input.onkeydown = (ev) => {
      if (ev.key === 'Enter') input.blur()
      else if (ev.key === 'Escape') {
        input.value = cluster.name
        input.blur()
      }
    }
    input.onblur = () => void commit()
    input.onclick = (ev) => ev.stopPropagation()
  }

  const archiveBtn = el('button', { className: 'btn btn-accent btn-sm' }, ['Archive'])
  archiveBtn.onclick = () => archiveCluster(cluster)

  const card = el('div', { className: 'card fade' }, [
    head,
    el('p', { className: 'summary' }, [cluster.summary || '—']),
    el('div', { className: 'card-foot' }, [strip, archiveBtn]),
    body,
  ])
  card.style.setProperty('--hue', String(hue))
  return card
}

function reclusterBtn(): HTMLElement {
  const b = el('button', { className: 'btn' }, ['↻ Re-cluster'])
  b.onclick = () => loadClusters(true)
  return b
}

async function loadClusters(force: boolean) {
  setActions(reclusterBtn())
  contentEl.replaceChildren(
    spinner(force ? 'Re-clustering your tabs…' : 'Reading and clustering your tabs…'),
  )

  const res = (await chrome.runtime.sendMessage({
    type: 'CLUSTER',
    force,
  })) as ClusterResponse

  if (res.ok) {
    lastResult = res.result
    renderClusters()
  } else {
    renderClusterError(res.error)
  }
}

function renderClusters() {
  setActions(reclusterBtn())
  if (!lastResult || lastResult.clusters.length === 0) {
    contentEl.replaceChildren(
      empty('⛶', 'No clusters yet.', 'Hit Re-cluster to analyze your open tabs.'),
    )
    return
  }
  const grid = el('div', { className: 'grid' })
  for (const c of lastResult.clusters) grid.append(clusterCard(c, lastResult.tabs))
  stagger(grid)
  contentEl.replaceChildren(
    el('div', { className: 'fade' }, [
      el('div', { className: 'section-title' }, [
        `${lastResult.clusters.length} clusters · clustered ${timeAgo(lastResult.createdAt)}`,
      ]),
      grid,
    ]),
  )
}

function renderClusterError(error: string) {
  setActions(reclusterBtn())
  if (error === 'NO_API_KEY') {
    const open = el('button', { className: 'btn btn-accent' }, ['Go to Settings'])
    open.onclick = () => {
      location.hash = '#settings'
    }
    contentEl.replaceChildren(
      el('div', { className: 'error fade' }, [
        el('div', { className: 'hd' }, ['No API key set']),
        el('div', { className: 'ms' }, ['Add your Anthropic API key in Settings to start clustering.']),
        open,
      ]),
    )
    return
  }
  const retry = el('button', { className: 'btn' }, ['Try again'])
  retry.onclick = () => loadClusters(true)
  contentEl.replaceChildren(
    el('div', { className: 'error fade' }, [
      el('div', { className: 'hd' }, ['Could not cluster tabs']),
      el('div', { className: 'ms' }, [error]),
      retry,
    ]),
  )
}

async function archiveCluster(cluster: Cluster) {
  if (!lastResult) return
  const knownIds = cluster.tabIds.filter((id) => lastResult!.tabs[id])
  const tabs = knownIds.map((id) => lastResult!.tabs[id])

  const stamp = Date.now()
  await chrome.storage.local.set({
    [`session_${stamp}`]: {
      archivedAt: stamp,
      name: cluster.name,
      summary: cluster.summary,
      tabs,
    },
  })

  // Only close tabs whose live URL still matches the snapshot — guards against
  // reused/stale tab IDs from a cached clustering closing the wrong tab.
  const live = await chrome.tabs.query({ currentWindow: true })
  const liveUrl = new Map(live.map((t) => [t.id, t.url]))
  const toClose = knownIds.filter((id) => liveUrl.get(id) === lastResult!.tabs[id].url)
  if (toClose.length > 0) await chrome.tabs.remove(toClose).catch(() => {})

  lastResult = {
    ...lastResult,
    clusters: lastResult.clusters.filter((c) => c !== cluster),
  }
  await chrome.storage.local.set({ lastClustering: lastResult })
  renderClusters()
}

/* ---------- Archived ---------- */

async function renderArchived() {
  setActions()
  const sessions = await loadArchived()

  const search = el('input', {
    className: 'search',
    placeholder: 'Search archived sessions…',
    value: archivedQuery,
  }) as HTMLInputElement
  search.oninput = () => {
    archivedQuery = search.value
    paintSessions(list, sessions)
  }

  const list = el('div', {})
  const toolbar = el('div', { className: 'toolbar' }, [search])
  contentEl.replaceChildren(el('div', { className: 'fade' }, [toolbar, list]))
  paintSessions(list, sessions)
}

function paintSessions(list: HTMLElement, sessions: ArchivedSession[]) {
  const q = archivedQuery.trim().toLowerCase()
  const filtered = q
    ? sessions.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.summary.toLowerCase().includes(q) ||
          s.tabs.some((t) => t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q)),
      )
    : sessions

  if (sessions.length === 0) {
    list.replaceChildren(
      empty('▤', 'No archived sessions yet.', 'Archive a cluster to save it here.'),
    )
    return
  }
  if (filtered.length === 0) {
    list.replaceChildren(empty('🔍', 'No sessions match your search.'))
    return
  }
  list.replaceChildren(...filtered.map(sessionCard))
}

function sessionCard(session: ArchivedSession): HTMLElement {
  const body = el('div', { className: 'session-body' })
  body.style.display = 'none'

  session.tabs.forEach((t) => {
    const row = el('a', {
      className: 'session-tab',
      href: safeUrl(t.url) || '#',
      target: '_blank',
      rel: 'noreferrer',
      title: t.url,
    }) as HTMLAnchorElement
    row.append(
      favicon(t.favIconUrl, 16),
      el('span', { className: 't' }, [t.title]),
      el('span', { className: 'open-ico' }, ['↗']),
    )
    body.append(row)
  })

  const reopen = el('button', { className: 'btn btn-accent btn-sm' }, ['Reopen all'])
  reopen.onclick = (e) => {
    e.stopPropagation()
    for (const t of session.tabs) {
      const url = safeUrl(t.url)
      if (url) chrome.tabs.create({ url, active: false })
    }
  }
  const del = el('button', { className: 'btn btn-danger btn-sm' }, ['Delete'])
  del.onclick = async (e) => {
    e.stopPropagation()
    await chrome.storage.local.remove(session.key)
    renderArchived()
  }
  body.append(el('div', { className: 'session-body-foot' }, [reopen, del]))

  const chev = el('span', { className: 'chev' }, ['▸'])
  const head = el('div', { className: 'session-head' }, [
    chev,
    el('span', { className: 'name' }, [session.name]),
    el('span', { className: 'sum' }, [session.summary || '']),
    el('span', { className: 'count' }, [`${session.tabs.length}`]),
    el('span', { className: 'when' }, [timeAgo(session.archivedAt)]),
  ])
  head.onclick = () => {
    const open = body.style.display === 'none'
    body.style.display = open ? 'block' : 'none'
    chev.classList.toggle('open', open)
  }

  return el('div', { className: 'session fade' }, [head, body])
}

/* ---------- Backup ---------- */

async function exportArchives(): Promise<number> {
  const sessions = await loadArchived()
  const payload = {
    app: 'tabulate',
    version: 1,
    exportedAt: Date.now(),
    sessions: sessions.map(({ key: _key, ...s }) => s),
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = el('a', { href: url, download: `tabulate-archives-${new Date().toISOString().slice(0, 10)}.json` })
  a.click()
  URL.revokeObjectURL(url)
  return sessions.length
}

async function importArchives(file: File): Promise<number> {
  const text = await file.text()
  const data = JSON.parse(text)
  const list: any[] = Array.isArray(data) ? data : Array.isArray(data?.sessions) ? data.sessions : []
  let added = 0
  const writes: Record<string, unknown> = {}
  list.forEach((s, i) => {
    if (!s || !Array.isArray(s.tabs)) return
    const stamp = (Number(s.archivedAt) || Date.now()) + i
    writes[`session_${stamp}`] = {
      archivedAt: stamp,
      name: String(s.name ?? 'Imported session'),
      summary: String(s.summary ?? ''),
      tabs: s.tabs
        .filter((t: any) => t && typeof t.url === 'string')
        .map((t: any) => ({ title: String(t.title ?? t.url), url: t.url, favIconUrl: t.favIconUrl })),
    }
    added++
  })
  if (added > 0) await chrome.storage.local.set(writes)
  return added
}

/* ---------- Settings ---------- */

async function renderSettings() {
  setActions()
  const st = await chrome.storage.local.get(['provider', 'apiKey', 'model', 'baseUrl'])
  const apiKey = st.apiKey
  const sessions = await loadArchived()

  let provider = providerById(typeof st.provider === 'string' ? st.provider : undefined)

  const select = el('select', { className: 'select' }) as HTMLSelectElement
  PROVIDERS.forEach((p) => {
    const opt = el('option', { value: p.id }, [p.label]) as HTMLOptionElement
    if (p.id === provider.id) opt.selected = true
    select.append(opt)
  })

  const input = el('input', {
    type: 'password',
    placeholder: provider.keyHint,
    value: typeof apiKey === 'string' ? apiKey : '',
    autocomplete: 'off',
    spellcheck: false,
  }) as HTMLInputElement

  const model = el('input', {
    placeholder: provider.defaultModel || 'model id',
    value: typeof st.model === 'string' ? st.model : '',
    autocomplete: 'off',
    spellcheck: false,
  }) as HTMLInputElement

  const baseUrl = el('input', {
    placeholder: 'https://api.example.com/v1',
    value: typeof st.baseUrl === 'string' ? st.baseUrl : '',
    autocomplete: 'off',
    spellcheck: false,
  }) as HTMLInputElement
  const baseRow = el('div', { className: 'sub-field' }, [
    el('label', {}, ['Base URL']),
    baseUrl,
  ])

  const syncProvider = () => {
    baseRow.style.display = provider.custom ? 'block' : 'none'
    input.placeholder = provider.keyHint
    model.placeholder = provider.defaultModel || 'model id'
  }
  select.onchange = () => {
    provider = providerById(select.value)
    syncProvider()
  }
  syncProvider()

  const status = el('span', { className: 'status' })
  let statusTimer: number | undefined
  const flash = (t: string) => {
    status.textContent = t
    if (statusTimer) clearTimeout(statusTimer)
    statusTimer = window.setTimeout(() => (status.textContent = ''), 2000)
  }

  const reveal = el('button', { className: 'btn btn-sm btn-ghost' }, ['Show'])
  reveal.onclick = () => {
    const hidden = input.type === 'password'
    input.type = hidden ? 'text' : 'password'
    reveal.textContent = hidden ? 'Hide' : 'Show'
  }

  const save = el('button', { className: 'btn btn-accent' }, ['Save'])
  save.onclick = async () => {
    await chrome.storage.local.set({
      provider: provider.id,
      apiKey: input.value.trim(),
      model: model.value.trim(),
      baseUrl: baseUrl.value.trim(),
    })
    await chrome.runtime.sendMessage({ type: 'INVALIDATE' }).catch(() => {})
    flash('Saved')
    renderSettings()
  }
  const clear = el('button', { className: 'btn' }, ['Clear key'])
  clear.onclick = async () => {
    input.value = ''
    await chrome.storage.local.remove('apiKey')
    await chrome.runtime.sendMessage({ type: 'INVALIDATE' }).catch(() => {})
    flash('Cleared')
  }

  const keyPanel = el('div', { className: 'panel' }, [
    el('h2', {}, ['AI provider']),
    el('p', { className: 'desc' }, [
      'Use any provider. Key, model and base URL are stored locally via chrome.storage.local — never synced, sent only to the provider you pick.',
    ]),
    el('label', {}, ['Provider']),
    el('div', { className: 'field' }, [select]),
    baseRow,
    el('label', { style: 'margin-top:14px' as any }, ['Model']),
    el('div', { className: 'field' }, [model]),
    el('label', { style: 'margin-top:14px' as any }, ['API key']),
    el('div', { className: 'field' }, [input, reveal]),
    el('div', { className: 'row' }, [save, clear, status]),
  ])

  const baked = !(typeof apiKey === 'string' && apiKey) && provider.kind === 'anthropic'
  const infoPanel = el('div', { className: 'panel' }, [
    el('h2', {}, ['Active configuration']),
    el('div', { className: 'kv' }, [
      el('span', { className: 'k' }, ['Provider']),
      el('span', { className: 'v' }, [provider.label]),
    ]),
    el('div', { className: 'kv' }, [
      el('span', { className: 'k' }, ['Model']),
      el('span', { className: 'v' }, [
        (typeof st.model === 'string' && st.model) || provider.defaultModel || '—',
      ]),
    ]),
    el('div', { className: 'kv' }, [
      el('span', { className: 'k' }, ['Endpoint']),
      el('span', { className: 'v' }, [
        provider.custom ? (typeof st.baseUrl === 'string' && st.baseUrl) || '—' : provider.baseUrl,
      ]),
    ]),
    el('div', { className: 'kv' }, [
      el('span', { className: 'k' }, ['Key source']),
      el('span', { className: 'v' }, [
        typeof apiKey === 'string' && apiKey ? 'settings' : baked ? 'build / none' : 'none',
      ]),
    ]),
  ])

  const clearCache = el('button', { className: 'btn btn-danger btn-sm' }, ['Clear'])
  clearCache.onclick = async () => {
    await chrome.runtime.sendMessage({ type: 'INVALIDATE' }).catch(() => {})
    lastResult = null
    flash('Cache cleared')
  }
  const wipe = el('button', { className: 'btn btn-danger btn-sm' }, [
    `Delete ${sessions.length}`,
  ])
  wipe.onclick = async () => {
    if (sessions.length === 0) return
    if (!confirm(`Delete all ${sessions.length} archived sessions? This cannot be undone.`)) return
    await chrome.storage.local.remove(sessions.map((s) => s.key))
    flash('Deleted')
    wipe.textContent = 'Delete 0'
  }

  const status2 = el('span', { className: 'status' })
  let status2Timer: number | undefined
  const flash2 = (t: string) => {
    status2.textContent = t
    if (status2Timer) clearTimeout(status2Timer)
    status2Timer = window.setTimeout(() => (status2.textContent = ''), 2000)
  }

  const exportBtn = el('button', { className: 'btn btn-sm' }, [`Export ${sessions.length}`])
  exportBtn.onclick = async () => {
    const n = await exportArchives()
    flash2(n > 0 ? `Exported ${n}` : 'Nothing to export')
  }
  const fileInput = el('input', { type: 'file', accept: 'application/json' }) as HTMLInputElement
  fileInput.style.display = 'none'
  fileInput.onchange = async () => {
    const f = fileInput.files?.[0]
    if (!f) return
    try {
      const n = await importArchives(f)
      flash2(n > 0 ? `Imported ${n}` : 'No sessions found')
    } catch {
      flash2('Invalid file')
    }
    fileInput.value = ''
  }
  const importBtn = el('button', { className: 'btn btn-sm' }, ['Import…'])
  importBtn.onclick = () => fileInput.click()

  const backupPanel = el('div', { className: 'panel' }, [
    el('h2', {}, ['Backup & restore']),
    el('p', { className: 'desc' }, [
      'Export archived sessions to a JSON file, or import a previous backup. Imports merge — they never overwrite existing sessions.',
    ]),
    el('div', { className: 'row' }, [exportBtn, importBtn, fileInput, status2]),
  ])

  const dangerPanel = el('div', { className: 'panel danger' }, [
    el('h2', {}, ['Danger zone']),
    el('div', { className: 'danger-row' }, [
      el('div', { className: 'lbl' }, [
        'Cached clustering',
        el('small', {}, ['Forget the last clustering result.']),
      ]),
      clearCache,
    ]),
    el('div', { className: 'danger-row' }, [
      el('div', { className: 'lbl' }, [
        'Archived sessions',
        el('small', {}, ['Permanently remove all saved sessions.']),
      ]),
      wipe,
    ]),
  ])

  contentEl.replaceChildren(
    el('div', { className: 'fade' }, [keyPanel, infoPanel, backupPanel, dangerPanel]),
  )
}

/* ---------- Router ---------- */

function currentView(): View {
  const h = location.hash.replace('#', '') as View
  return VIEWS.includes(h) ? h : 'overview'
}

function setNavActive(view: View) {
  navEl.querySelectorAll('a').forEach((a) => {
    a.classList.toggle('active', a.getAttribute('data-view') === view)
  })
}

function route() {
  const view = currentView()
  setNavActive(view)
  titleEl.textContent =
    view === 'overview'
      ? 'Overview'
      : view === 'clusters'
        ? 'Clusters'
        : view === 'archived'
          ? 'Archived Sessions'
          : 'Settings'

  if (view === 'overview') void renderOverview()
  else if (view === 'clusters') {
    if (lastResult) renderClusters()
    else void loadClusters(false)
  } else if (view === 'archived') void renderArchived()
  else void renderSettings()
}

window.addEventListener('hashchange', route)

document.getElementById('quickswitch')?.addEventListener('click', () => void openPalette())

window.addEventListener('keydown', (e) => {
  // Quick switch — Cmd/Ctrl+K from anywhere.
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    void openPalette()
    return
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  // "/" also opens quick switch; number keys jump between views.
  if (e.key === '/') {
    e.preventDefault()
    void openPalette()
    return
  }
  const idx = Number(e.key) - 1
  if (idx >= 0 && idx < VIEWS.length) location.hash = `#${VIEWS[idx]}`
})

route()
