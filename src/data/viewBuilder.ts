import type { Graph, GraphEdge, GraphNode, NodeType } from '../types'
import type { BundleEdge, BundleNode } from './bundle'
import type { View, ViewBounds } from './GraphSource'

// Shared bundle→renderable mapping + View assembly, used by BOTH the static and
// API sources so the scene behaves identically against either. Community colour
// is a *pure function of the id* (modulo the palette) so it's stable regardless
// of which nodes have arrived — the API streams communities incrementally.

const COMMUNITY_COLORS = [
  '#66b8ff', '#ffb86b', '#7dffa8', '#ff7de9', '#fff37d',
  '#9d8bff', '#6bffe0', '#ff8a8a', '#b8ff6b', '#7da9ff',
  '#ff9d5c', '#5cffd6', '#d68bff', '#a8ff7d', '#7d8bff',
]
const TYPE_COLORS: Record<NodeType, string> = {
  work: '#66b8ff', // works are normally coloured by community
  author: '#8fa9c8',
  concept: '#7dffa8',
  venue: '#ffd37d',
  institution: '#ff9db1',
}

function coerce(v: unknown): string | number {
  if (typeof v === 'number' || typeof v === 'string') return v
  return String(v)
}

function communityColor(c: number): string {
  const L = COMMUNITY_COLORS.length
  return COMMUNITY_COLORS[((c % L) + L) % L]
}

function displayProps(b: BundleNode): Record<string, string | number> {
  const p: Record<string, string | number> = {}
  const put = (k: string, v: unknown) => {
    if (v != null && v !== '') p[k] = coerce(v)
  }
  switch (b.type) {
    case 'work':
      put('Year', b.year)
      put('Field', b.field)
      put('Cited by', b.cited_by)
      put('Community', b.community)
      break
    case 'concept':
      put('Level', b.level)
      break
    case 'venue':
      put('Type', b.venue_type)
      break
    case 'institution':
      put('Country', b.country)
      put('Type', b.inst_type)
      break
  }
  return p
}

// Caches materialized instances by id so positions assigned by the layout
// persist across views (expand reuses the same GraphNode; only new ones lay out).
export class Materializer {
  private rnode = new Map<string, GraphNode>()
  private redge = new Map<string, GraphEdge>()

  node(b: BundleNode): GraphNode {
    const cached = this.rnode.get(b.id)
    if (cached) return cached
    const color = b.community != null ? communityColor(b.community) : TYPE_COLORS[b.type]
    // Some OpenAlex records have no display_name — fall back to the id.
    const node: GraphNode = {
      id: b.id,
      name: b.name ?? b.id,
      type: b.type,
      community: b.community,
      pagerank: b.pagerank,
      color,
      properties: displayProps(b),
    }
    this.rnode.set(b.id, node)
    return node
  }

  edge(b: BundleEdge): GraphEdge {
    const cached = this.redge.get(b.id)
    if (cached) return cached
    const props: Record<string, string | number> = {}
    if (b.kind === 'semantic') {
      const sim = b.props?.similarity ?? b.props?.Similarity
      if (sim != null) props.Similarity = sim as string | number
    } else if (b.props) {
      for (const [k, v] of Object.entries(b.props)) props[k] = coerce(v)
    }
    const edge: GraphEdge = {
      id: b.id,
      source: b.source,
      target: b.target,
      kind: b.kind,
      label: b.label,
      props,
    }
    this.redge.set(b.id, edge)
    return edge
  }

  getNode(id: string): GraphNode | undefined {
    return this.rnode.get(id)
  }
}

// Build a renderable Graph + View metadata from already-materialized instances.
export function assembleView(
  nodes: GraphNode[],
  edges: GraphEdge[],
  meta: { anchorId: string; corridor: string[]; addedBy: Map<string, string>; bounds: ViewBounds },
): View {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  // Keep only edges whose endpoints are both present.
  const kept = edges.filter((e) => nodeById.has(e.source) && nodeById.has(e.target))
  const edgeById = new Map(kept.map((e) => [e.id, e]))
  const neighbors = new Map<string, string[]>()
  const incident = new Map<string, GraphEdge[]>()
  for (const n of nodes) {
    neighbors.set(n.id, [])
    incident.set(n.id, [])
  }
  for (const e of kept) {
    neighbors.get(e.source)?.push(e.target)
    neighbors.get(e.target)?.push(e.source)
    incident.get(e.source)?.push(e)
    incident.get(e.target)?.push(e)
  }
  const graph: Graph = { nodes, edges: kept, nodeById, edgeById, neighbors, incident }
  return { ...graph, anchorId: meta.anchorId, corridor: meta.corridor, addedBy: meta.addedBy, bounds: meta.bounds }
}

// ── client-side view operations (shared by both sources) ────────────────────

// Remove nodes the given node introduced that aren't on the corridor and have
// no other in-view neighbor — folds an expansion back up.
export function collapseView(view: View, nodeId: string): View {
  const keep = new Set(view.nodes.map((n) => n.id))
  const addedBy = new Map(view.addedBy)
  for (const [id, parent] of view.addedBy) {
    if (parent !== nodeId || view.corridor.includes(id)) continue
    const others = (view.neighbors.get(id) ?? []).filter((o) => o !== nodeId && keep.has(o))
    if (others.length === 0) {
      keep.delete(id)
      addedBy.delete(id)
    }
  }
  const nodes = view.nodes.filter((n) => keep.has(n.id))
  return assembleView(nodes, view.edges, {
    anchorId: view.anchorId,
    corridor: view.corridor.filter((id) => keep.has(id)),
    addedBy,
    bounds: view.bounds,
  })
}

// Mask the current view by a predicate (anchor + corridor always kept).
export function filterView(
  view: View,
  predicate: {
    nodeTypes?: string[]
    pagerankMin?: number
    yearMin?: number
    yearMax?: number
  },
): View {
  const keep = (n: GraphNode): boolean => {
    if (n.id === view.anchorId || view.corridor.includes(n.id)) return true
    if (predicate.nodeTypes && !predicate.nodeTypes.includes(n.type)) return false
    if (predicate.pagerankMin != null && (n.pagerank ?? 0) < predicate.pagerankMin) return false
    const year = n.properties['Year']
    if (predicate.yearMin != null && (typeof year !== 'number' || year < predicate.yearMin)) return false
    if (predicate.yearMax != null && (typeof year !== 'number' || year > predicate.yearMax)) return false
    return true
  }
  const nodes = view.nodes.filter(keep)
  const ids = new Set(nodes.map((n) => n.id))
  const addedBy = new Map([...view.addedBy].filter(([id]) => ids.has(id)))
  return assembleView(nodes, view.edges, {
    anchorId: view.anchorId,
    corridor: view.corridor.filter((id) => ids.has(id)),
    addedBy,
    bounds: { ...view.bounds, predicate },
  })
}
