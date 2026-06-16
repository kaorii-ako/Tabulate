export interface TabSignal {
  id: number
  title: string
  url: string
  favIconUrl?: string
  signal: string
}

export interface Cluster {
  name: string
  summary: string
  tabIds: number[]
}

export interface ArchivedTab {
  title: string
  url: string
  favIconUrl?: string
}

export interface CachedClustering {
  windowId: number
  createdAt: number
  clusters: Cluster[]
  tabs: Record<number, ArchivedTab>
}

export interface ArchivedSession {
  key: string
  archivedAt: number
  name: string
  summary: string
  tabs: ArchivedTab[]
}

export type ClusterRequest = { type: 'CLUSTER'; force?: boolean }
export type InvalidateRequest = { type: 'INVALIDATE' }
export type BackgroundRequest = ClusterRequest | InvalidateRequest

export type ClusterResponse =
  | { ok: true; result: CachedClustering }
  | { ok: false; error: string }
