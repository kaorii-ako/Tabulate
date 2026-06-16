import type {
  ArchivedSession,
  ArchivedTab,
  CachedClustering,
  Cluster,
  ClusterResponse,
} from '../lib/types'

const MODEL = 'claude-sonnet-4-6'
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

function favicon(url: string | undefined, size = 18): HTMLImageElement {
  const img = el('img', { src: url || '' })
  img.width = size
  img.height = size
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

  const stat = (num: string | number, label: string) =>
    el('div', { className: 'stat' }, [
      el('div', { className: 'num' }, [String(num)]),
      el('div', { className: 'label' }, [label]),
    ])

  const grid = el('div', { className: 'stat-grid' }, [
    stat(openTabs.length, 'Open tabs (this window)'),
    stat(cache ? cache.clusters.length : '—', 'Current clusters'),
    stat(sessions.length, 'Archived sessions'),
    stat(tabsArchived, 'Tabs archived total'),
  ])

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

function clusterCard(cluster: Cluster, tabs: Record<number, ArchivedTab>): HTMLElement {
  const metas = cluster.tabIds.map((id) => tabs[id]).filter(Boolean) as ArchivedTab[]
  const strip = el('div', { className: 'favstrip' })
  metas.slice(0, 10).forEach((m) => strip.append(favicon(m.favIconUrl)))
  if (metas.length > 10) {
    strip.append(el('span', { className: 'more' }, [`+${metas.length - 10}`]))
  }

  const archiveBtn = el('button', { className: 'btn btn-accent btn-sm' }, ['Archive'])
  archiveBtn.onclick = () => archiveCluster(cluster)

  return el('div', { className: 'card fade' }, [
    el('div', { className: 'card-head' }, [
      el('span', { className: 'name' }, [cluster.name]),
      el('span', { className: 'count' }, [String(cluster.tabIds.length)]),
    ]),
    el('p', { className: 'summary' }, [cluster.summary || '—']),
    el('div', { className: 'card-foot' }, [strip, archiveBtn]),
  ])
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
  const tabs = cluster.tabIds
    .map((id) => lastResult!.tabs[id])
    .filter((t): t is ArchivedTab => Boolean(t))

  await chrome.storage.local.set({
    [`session_${Date.now()}`]: {
      archivedAt: Date.now(),
      name: cluster.name,
      summary: cluster.summary,
      tabs,
    },
  })
  await chrome.tabs.remove(cluster.tabIds).catch(() => {})

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
      href: t.url || '#',
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
    for (const t of session.tabs) if (t.url) chrome.tabs.create({ url: t.url, active: false })
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

/* ---------- Settings ---------- */

async function renderSettings() {
  setActions()
  const { apiKey } = await chrome.storage.local.get('apiKey')
  const sessions = await loadArchived()

  const input = el('input', {
    type: 'password',
    placeholder: 'sk-ant-...',
    value: typeof apiKey === 'string' ? apiKey : '',
    autocomplete: 'off',
    spellcheck: false,
  }) as HTMLInputElement

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

  const save = el('button', { className: 'btn btn-accent' }, ['Save key'])
  save.onclick = async () => {
    await chrome.storage.local.set({ apiKey: input.value.trim() })
    await chrome.runtime.sendMessage({ type: 'INVALIDATE' }).catch(() => {})
    flash('Saved')
  }
  const clear = el('button', { className: 'btn' }, ['Clear'])
  clear.onclick = async () => {
    input.value = ''
    await chrome.storage.local.remove('apiKey')
    await chrome.runtime.sendMessage({ type: 'INVALIDATE' }).catch(() => {})
    flash('Cleared')
  }

  const keyPanel = el('div', { className: 'panel' }, [
    el('h2', {}, ['Anthropic API key']),
    el('p', { className: 'desc' }, [
      'Stored locally via chrome.storage.local — never synced. Used only for requests to the Anthropic API.',
    ]),
    el('label', {}, ['API key']),
    el('div', { className: 'field' }, [input, reveal]),
    el('div', { className: 'row' }, [save, clear, status]),
  ])

  const infoPanel = el('div', { className: 'panel' }, [
    el('h2', {}, ['Model']),
    el('div', { className: 'kv' }, [
      el('span', { className: 'k' }, ['Model']),
      el('span', { className: 'v' }, [MODEL]),
    ]),
    el('div', { className: 'kv' }, [
      el('span', { className: 'k' }, ['API calls']),
      el('span', { className: 'v' }, ['1 per clustering pass']),
    ]),
    el('div', { className: 'kv' }, [
      el('span', { className: 'k' }, ['Key source']),
      el('span', { className: 'v' }, [
        typeof apiKey === 'string' && apiKey ? 'options' : 'build / none',
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
    el('div', { className: 'fade' }, [keyPanel, infoPanel, dangerPanel]),
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
route()
