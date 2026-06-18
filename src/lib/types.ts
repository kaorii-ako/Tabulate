import type { ProviderKind } from './providers'

export interface AIConfig {
  provider: string
  kind: ProviderKind
  baseUrl: string
  model: string
  apiKey: string
}

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
export type GroupRequest = { type: 'GROUP'; only?: number }
export type WindowRequest = { type: 'WINDOW'; only: number }
export type UngroupRequest = { type: 'UNGROUP' }
export type BackgroundRequest =
  | ClusterRequest
  | InvalidateRequest
  | GroupRequest
  | WindowRequest
  | UngroupRequest

export type ClusterResponse =
  | { ok: true; result: CachedClustering }
  | { ok: false; error: string }

export type GroupResponse =
  | { ok: true; result: { groups: number; tabs: number } }
  | { ok: false; error: string }

export type ActionResponse =
  | { ok: true; result: { count: number } }
  | { ok: false; error: string }
