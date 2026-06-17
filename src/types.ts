// Node types in the scholarly graph (OpenAlex). The renderer keys size/feel off
// these; colours come from community (works) or a fixed per-type palette.
export type NodeType = 'work' | 'author' | 'concept' | 'venue' | 'institution'

// How the viewport decides what to highlight. Proximity (closest-N) and
// adjacent (current node's neighbors) are implemented; the others are
// planned selection modes with their own console controls.
export type ViewMode = 'proximity' | 'adjacent' | 'multi' | 'cluster' | 'semantic'

export interface GraphNode {
  id: string
  name: string
  type: NodeType
  // Louvain community (works only); drives the "galaxy" colour. Undefined for
  // attribute nodes (authors/concepts/venues/institutions).
  community?: number
  // PageRank centrality (works only) — the "brightest star" cue.
  pagerank?: number
  color: string
  // Flattened display fields for the node panel (Year, Field, Cited by, …).
  properties: Record<string, string | number>
  // Positions are assigned by the force layout (d3-force-3d mutates nodes in place).
  x?: number
  y?: number
  z?: number
  // Fixed-position pins used by incremental relayout (set/cleared by runForceLayout).
  fx?: number
  fy?: number
  fz?: number
}

// structural = real graph topology (citations, authorship, concepts, …);
// semantic = an inferred link (embedding kNN / "wormhole") with no structural
// path. The {kind,label,props} shape is generic so the same renderer handles
// both the static bundle and the live API.
export type EdgeKind = 'structural' | 'semantic'

export interface GraphEdge {
  id: string
  source: string
  target: string
  kind: EdgeKind
  // Raw relationship type (cites, authored_by, has_concept, …) — drives
  // edge-type filtering. Falls back to kind when a source omits it.
  rel?: string
  label: string
  props: Record<string, string | number>
}

// The renderable, indexed graph — i.e. whatever is *currently in scope*. A
// `View` (see GraphSource) is a Graph plus exploration metadata.
export interface Graph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  nodeById: Map<string, GraphNode>
  edgeById: Map<string, GraphEdge>
  neighbors: Map<string, string[]>
  // Edges touching a node, both directions — drives the node panel's link list.
  incident: Map<string, GraphEdge[]>
}
