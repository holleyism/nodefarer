import type { GraphEdge, GraphNode } from '../types'

// The property used to BOTH order the Links list and decide which edges the
// "edges / node" slider keeps (clip). The value shown on each link row is this
// property too, so it's clear what's driving the cut.
export type EdgeSortKey = 'pagerank' | 'cited_by' | 'year' | 'similarity' | 'name'

export const EDGE_SORT_OPTIONS: { key: EdgeSortKey; label: string }[] = [
  { key: 'pagerank', label: 'rank' },
  { key: 'cited_by', label: 'cites' },
  { key: 'year', label: 'year' },
  { key: 'similarity', label: 'sim' },
  { key: 'name', label: 'name' },
]

function other(edge: GraphEdge, fromId: string): string {
  return edge.source === fromId ? edge.target : edge.source
}

// Numeric metric of an edge as seen from `fromId` (higher = ranked first).
// Most keys read the *other* endpoint; similarity reads the edge.
export function edgeValue(
  edge: GraphEdge,
  fromId: string,
  nodeById: Map<string, GraphNode>,
  key: EdgeSortKey,
): number {
  if (key === 'similarity') return edge.kind === 'semantic' ? Number(edge.props.Similarity ?? 0) : -1
  const o = nodeById.get(other(edge, fromId))
  if (!o) return 0
  if (key === 'pagerank') return o.pagerank ?? 0
  const v = o.properties[key === 'cited_by' ? 'Cited by' : 'Year']
  return typeof v === 'number' ? v : 0
}

// Comparator (descending for numeric keys, A→Z for name).
export function compareEdges(
  a: GraphEdge,
  b: GraphEdge,
  fromId: string,
  nodeById: Map<string, GraphNode>,
  key: EdgeSortKey,
): number {
  if (key === 'name') {
    const na = nodeById.get(other(a, fromId))?.name ?? ''
    const nb = nodeById.get(other(b, fromId))?.name ?? ''
    return na.localeCompare(nb)
  }
  return edgeValue(b, fromId, nodeById, key) - edgeValue(a, fromId, nodeById, key)
}

// Short label for the value chip on a link row (empty → fall back to edge.label).
export function edgeValueLabel(
  edge: GraphEdge,
  fromId: string,
  nodeById: Map<string, GraphNode>,
  key: EdgeSortKey,
): string {
  if (key === 'name') return ''
  if (key === 'similarity') return edge.kind === 'semantic' ? `≈ ${edge.props.Similarity}` : ''
  const v = edgeValue(edge, fromId, nodeById, key)
  if (!v) return ''
  if (key === 'pagerank') return `pr ${v.toFixed(3)}`
  if (key === 'year') return String(v)
  if (key === 'cited_by') return v >= 1000 ? `${(v / 1000).toFixed(1)}k cites` : `${v} cites`
  return ''
}
