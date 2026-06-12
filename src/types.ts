export type NodeType = 'star' | 'outpost' | 'relay' | 'gate'

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

export interface GraphEdge {
  source: string
  target: string
}

export interface Graph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  nodeById: Map<string, GraphNode>
  neighbors: Map<string, string[]>
}
