import type { Graph } from '../types'
import type { GraphSchema } from './graphSchema'

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
// anchor by text/semantic match then lands there. `maxNodes` sets the landing
// density (omit for the source default) so a story/tour can request a tighter
// or denser lens than ad-hoc exploration.
export type EntryMode =
  | { mode: 'node'; id?: string; maxNodes?: number }
  | { mode: 'overview' }
  | { mode: 'search'; query: string; kind?: 'text' | 'semantic'; maxNodes?: number }

// How an expansion pulls neighbors: which relationship, ranked how, capped.
export interface ExpandRule {
  relType?: string // bundle `rel` (cites, authored_by, …); undefined = any
  rank?: 'pagerank' | 'similarity' | 'degree'
  limit?: number
  direction?: 'out' | 'in' | 'both'
}

// A node/edge filter — the "bounds" knobs. Re-queried live (ApiSource) or
// applied as a client mask (StaticBundleSource). Schema-driven: `num`/`cat` are
// keyed by SchemaProperty.key ('pagerank' or a GraphNode.properties key), so the
// filter generalizes to any graph without hard-coded property names.
export interface Predicate {
  nodeTypes?: string[] // allowed node types (omit = all)
  relTypes?: string[] // allowed edge relationship types (omit = all)
  num?: Record<string, { min?: number; max?: number }> // node numeric property ranges
  cat?: Record<string, string[]> // node categorical property allow-lists
  edgeNum?: Record<string, { min?: number; max?: number }> // edge numeric property ranges
  edgeCat?: Record<string, string[]> // edge categorical property allow-lists
}

export interface Candidate {
  id: string
  name: string
  score?: number // pagerank / similarity / distance, per call
}

// True shortest-path travel: the view extended to include every node on the
// path (so the ship can fly through them) plus the ordered route ids
// (inclusive of both endpoints).
export interface PathResult {
  view: View
  route: string[]
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
  // The filterable schema for this dataset (derived from the bundle, or served
  // by the backend). Drives the FilterPanel.
  schema(): Promise<GraphSchema>
  entry(e: EntryMode): Promise<View>
  expand(view: View, nodeId: string, rule?: ExpandRule): Promise<View>
  // fromId = the current node (BFS root); collapse prunes nodeId's subtree.
  collapse(view: View, nodeId: string, fromId: string): Promise<View>
  filter(view: View, predicate: Predicate): Promise<View>
  // True shortest path over the WHOLE graph (not just the loaded view), with the
  // view extended to include any path nodes that weren't loaded. Null if there's
  // no path at all. The client lays out the new nodes and flies the route.
  path(view: View, fromId: string, toId: string): Promise<PathResult | null>
  search(query: string, kind?: 'text' | 'semantic'): Promise<Candidate[]>
  neighbors(nodeId: string, rule?: ExpandRule): Promise<Candidate[]>
}
