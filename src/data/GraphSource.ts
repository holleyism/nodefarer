import type { Graph } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// The exploration contract (Plan A spine). One interface, two implementations:
//   - StaticBundleSource — runs client-side over an in-memory bundle (demo).
//   - ApiSource          — Go/Chi over Neo4j (live; Plan C).
// The app and the (future) agent both speak only this interface, so the
// exploration UX is built once and the data source swaps underneath.
// See docs/exploration-design.md.
// ─────────────────────────────────────────────────────────────────────────────

// The initial query. `node` lands on a node; `overview` opens the nebula map
// (needs community LOD — not in the static source yet); `search` finds an
// anchor by text/semantic match then lands there.
export type EntryMode =
  | { mode: 'node'; id?: string }
  | { mode: 'overview' }
  | { mode: 'search'; query: string; kind?: 'text' | 'semantic' }

// How an expansion pulls neighbors: which relationship, ranked how, capped.
export interface ExpandRule {
  relType?: string // bundle `rel` (cites, authored_by, …); undefined = any
  rank?: 'pagerank' | 'similarity' | 'degree'
  limit?: number
  direction?: 'out' | 'in' | 'both'
}

// A node/edge filter — the "bounds" knobs. Re-queried live (ApiSource) or
// applied as a client mask (StaticBundleSource).
export interface Predicate {
  nodeTypes?: string[]
  relTypes?: string[]
  yearMin?: number
  yearMax?: number
  pagerankMin?: number
  similarityMin?: number
}

export interface Candidate {
  id: string
  name: string
  score?: number // pagerank / similarity / distance, per call
}

export interface ViewBounds {
  anchor: string
  maxNodes: number
  predicate?: Predicate
}

// A bounded, parameterized lens. It *is* a renderable Graph (so the scene
// consumes it directly) plus the exploration metadata that produced it.
export interface View extends Graph {
  anchorId: string
  // The visited path — drives breadcrumbs + corridor auto-collapse.
  corridor: string[]
  bounds: ViewBounds
  // nodeId -> the node whose expansion introduced it (for collapse provenance).
  addedBy: Map<string, string>
}

export interface GraphSource {
  entry(e: EntryMode): Promise<View>
  expand(view: View, nodeId: string, rule?: ExpandRule): Promise<View>
  collapse(view: View, nodeId: string): Promise<View>
  filter(view: View, predicate: Predicate): Promise<View>
  search(query: string, kind?: 'text' | 'semantic'): Promise<Candidate[]>
  neighbors(nodeId: string, rule?: ExpandRule): Promise<Candidate[]>
}
