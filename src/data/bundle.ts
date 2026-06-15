import type { EdgeKind, NodeType } from '../types'

// The on-disk shape emitted by ingest/export_bundle.py. Kept deliberately close
// to the JSON so loading is a straight parse; the render mapping lives in
// StaticBundleSource.
export interface BundleNode {
  id: string
  type: NodeType
  name: string
  community?: number
  pagerank?: number
  // type-specific extras: year, cited_by, field, abstract (work); level
  // (concept); venue_type (venue); country, inst_type (institution); …
  [k: string]: unknown
}

export interface BundleEdge {
  id: string
  source: string
  target: string
  kind: EdgeKind
  rel: string // cites | authored_by | concept | published_in | affiliated_with | semantic
  label: string
  props?: Record<string, string | number>
}

export interface BundleCommunity {
  id: number
  size: number
  representative: { id: string; name: string }
  dominantConcept: string | null
}

export interface Bundle {
  meta: {
    seeds?: string[]
    counts?: Record<string, unknown>
    communities?: number
    embeddingModel?: string | null
    [k: string]: unknown
  }
  nodes: BundleNode[]
  edges: BundleEdge[]
  communities: BundleCommunity[]
}
