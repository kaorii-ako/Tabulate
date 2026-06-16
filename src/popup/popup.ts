import type {
  ArchivedSession,
  ArchivedTab,
  CachedClustering,
  Cluster,
  ClusterResponse,
} from '../lib/types'

const app = document.getElementById('app') as HTMLDivElement

let view: 'clusters' | 'archived' = 'clusters'
let current: CachedClustering | null = null

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

function favicon(url?: string): HTMLImageElement {
  const img = el('img', { src: url || '' })
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
  return `${Math.floor(h / 24)}d ago`
}

function header(): HTMLElement {
  const recluster = el(
    'button',
    { className: 'btn', title: 'Re-run clustering' },
    ['Re-cluster'],
  )
  recluster.onclick = () => loadClusters(true)

  const h = el('header', {}, [
    el('h1', {}, [el('span', { className: 'logo-dot' }), 'Tabulate']),
  ])
  if (view === 'clusters') h.append(recluster)
  return h
}

function tabBar(): HTMLElement {
  const mk = (key: typeof view, label: string) => {
    const b = el(
      'button',
      { className: key === view ? 'active' : '' },
      [label],
    )
    b.onclick = () => {
      view = key
      render()
    }
    return b
  }
  return el('div', { className: 'tabs' }, [
    mk('clusters', 'Clusters'),
    mk('archived', 'Archived Sessions'),
  ])
}

function clusterCard(cluster: Cluster, tabs: Record<number, ArchivedTab>): HTMLElement {
  const metas = cluster.tabIds.map((id) => tabs[id]).filter(Boolean)
  const strip = el('div', { className: 'favstrip' })
  metas.slice(0, 8).forEach((m) => strip.append(favicon(m.favIconUrl)))
  if (metas.length > 8) {
    strip.append(el('span', { className: 'more' }, [`+${metas.length - 8}`]))
  }

  const archiveBtn = el('button', { className: 'btn btn-accent' }, ['Archive'])
  archiveBtn.onclick = () => archiveCluster(cluster)

  return el('div', { className: 'card' }, [
    el('div', { className: 'card-head' }, [
      el('span', { className: 'name' }, [cluster.name]),
      el('span', { className: 'count' }, [String(cluster.tabIds.length)]),
    ]),
    el('p', { className: 'summary' }, [cluster.summary || '—']),
    el('div', { className: 'card-foot' }, [strip, archiveBtn]),
  ])
}

function renderClusters() {
  if (!current) {
    app.append(loading('Reading and clustering your tabs…'))
    return
  }
  if (current.clusters.length === 0) {
    app.append(
      el('div', { className: 'center' }, [
        'No clusters. ',
        (() => {
          const b = el('a', { href: '#', className: 'muted' }, ['Re-cluster'])
          b.onclick = (e) => {
            e.preventDefault()
            loadClusters(true)
          }
          return b
        })(),
      ]),
    )
    return
  }
  for (const c of current.clusters) app.append(clusterCard(c, current.tabs))
}

function loading(text: string): HTMLElement {
  return el('div', { className: 'center' }, [
    el('div', { className: 'spinner' }),
    text,
  ])
}

function renderError(error: string) {
  if (error === 'NO_API_KEY') {
    const open = el('button', { className: 'btn btn-accent' }, ['Open options'])
    open.onclick = () => chrome.runtime.openOptionsPage()
    app.append(
      el('div', { className: 'error' }, [
        el('div', {}, ['No API key set.']),
        el('div', { className: 'muted', style: 'margin:6px 0 10px' as any }, [
          'Add your Anthropic API key to start clustering.',
        ]),
        open,
      ]),
    )
    return
  }
  const retry = el('button', { className: 'btn' }, ['Try again'])
  retry.onclick = () => loadClusters(true)
  app.append(
    el('div', { className: 'error' }, [
      el('div', {}, ['Could not cluster tabs.']),
      el('div', { className: 'muted', style: 'margin:6px 0 10px' as any }, [error]),
      retry,
    ]),
  )
}

async function loadClusters(force: boolean) {
  current = null
  render(loading(force ? 'Re-clustering…' : 'Reading and clustering your tabs…'))

  const res = (await chrome.runtime.sendMessage({
    type: 'CLUSTER',
    force,
  })) as ClusterResponse

  if (res.ok) {
    current = res.result
    render()
  } else {
    render()
    renderError(res.error)
  }
}

async function archiveCluster(cluster: Cluster) {
  if (!current) return
  const tabs = cluster.tabIds
    .map((id) => current!.tabs[id])
    .filter((t): t is ArchivedTab => Boolean(t))

  const key = `session_${Date.now()}`
  await chrome.storage.local.set({
    [key]: {
      archivedAt: Date.now(),
      name: cluster.name,
      summary: cluster.summary,
      tabs,
    },
  })

  await chrome.tabs.remove(cluster.tabIds).catch(() => {})

  current = {
    ...current,
    clusters: current.clusters.filter((c) => c !== cluster),
  }
  await chrome.storage.local.set({ lastClustering: current })
  render()
}

async function loadArchived(): Promise<ArchivedSession[]> {
  const all = await chrome.storage.local.get(null)
  return Object.entries(all)
    .filter(([k]) => k.startsWith('session_'))
    .map(([key, v]) => ({ key, ...(v as Omit<ArchivedSession, 'key'>) }))
    .sort((a, b) => b.archivedAt - a.archivedAt)
}

function sessionCard(session: ArchivedSession): HTMLElement {
  const body = el('div', { className: 'session-body' })
  body.style.display = 'none'

  session.tabs.forEach((t) => {
    const row = el('div', { className: 'session-tab' }, [
      favicon(t.favIconUrl),
      el('span', { title: t.url }, [t.title]),
    ])
    body.append(row)
  })

  const reopen = el('button', { className: 'btn btn-accent' }, ['Reopen all'])
  reopen.onclick = (e) => {
    e.stopPropagation()
    for (const t of session.tabs) {
      if (t.url) chrome.tabs.create({ url: t.url, active: false })
    }
  }
  body.append(reopen)

  const chev = el('span', { className: 'chev' }, ['▸'])
  const head = el('div', { className: 'session-head' }, [
    chev,
    el('span', { className: 'name' }, [session.name]),
    el('span', { className: 'count' }, [String(session.tabs.length)]),
    el('span', { className: 'when' }, [timeAgo(session.archivedAt)]),
  ])
  head.onclick = () => {
    const open = body.style.display === 'none'
    body.style.display = open ? 'block' : 'none'
    chev.classList.toggle('open', open)
  }

  return el('div', { className: 'session' }, [head, body])
}

async function renderArchived() {
  const sessions = await loadArchived()
  if (sessions.length === 0) {
    app.append(
      el('div', { className: 'center' }, [
        'No archived sessions yet.',
        el('br'),
        'Archive a cluster to save it here.',
      ]),
    )
    return
  }
  for (const s of sessions) app.append(sessionCard(s))
}

function render(loadingNode?: HTMLElement) {
  app.replaceChildren()
  app.append(header(), tabBar())
  if (loadingNode) {
    app.append(loadingNode)
    return
  }
  if (view === 'clusters') renderClusters()
  else void renderArchived()
}

loadClusters(false)
