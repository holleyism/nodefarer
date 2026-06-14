export type NodeType = 'star' | 'outpost' | 'relay' | 'gate'

// How the viewport decides what to highlight. Proximity (closest-N) and
// adjacent (current node's neighbors) are implemented; the others are
// planned selection modes with their own console controls.
export type ViewMode = 'proximity' | 'adjacent' | 'multi' | 'cluster' | 'semantic'

export interface GraphNode {
  id: string
  name: string
  type: NodeType
  cluster: number
  color: string
  properties: Record<string, string | number>
  // Positions are assigned by the force layout (d3-force-3d mutates nodes in place).
  x?: number
  y?: number
  z?: number
}

// structural = real graph topology (citations, lanes); semantic = an inferred
// link (embedding kNN / "wormhole") with no structural path. The {kind,label,
// props} shape is intentionally generic so it transfers to the real OpenAlex
// bundle without touching the UI.
export type EdgeKind = 'structural' | 'semantic'

export interface GraphEdge {
  id: string
  source: string
  target: string
  kind: EdgeKind
  label: string
  props: Record<string, string | number>
}

export interface Graph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  nodeById: Map<string, GraphNode>
  edgeById: Map<string, GraphEdge>
  neighbors: Map<string, string[]>
  // Edges touching a node, both directions — drives the node panel's link list.
  incident: Map<string, GraphEdge[]>
}
