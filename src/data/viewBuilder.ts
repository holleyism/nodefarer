import type { Graph, GraphEdge, GraphNode, NodeType } from '../types'
import type { BundleEdge, BundleNode } from './bundle'
import type { Predicate, View, ViewBounds } from './GraphSource'
import { compareEdges, type EdgeSortKey } from './edgeSort'
import { shortestPath } from './shortestPath'

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
      rel: b.rel,
      label: b.label,
      props,
    }
    this.redge.set(b.id, edge)
    return edge
  }

  getNode(id: string): GraphNode | undefined {
    return this.rnode.get(id)
  }

  // Everything materialized so far — lets the API source derive a schema from
  // the nodes/edges it has actually loaded (grows as the user expands).
  allNodes(): GraphNode[] {
    return [...this.rnode.values()]
  }
  allEdges(): GraphEdge[] {
    return [...this.redge.values()]
  }
}

// Build a renderable Graph + View metadata from already-materialized instances.
export function assembleView(
  nodes: GraphNode[],
  edges: GraphEdge[],
  meta: { anchorId: string; corridor: string[]; addedBy: Map<string, string>; bounds: ViewBounds },
): View {
  // Dedupe nodes by id (defensive against data artifacts / repeated ids).
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const uniqNodes = [...nodeById.values()]
  // Keep edges with both endpoints present; drop self-loops (e.g. a work that
  // cites itself in OpenAlex) and duplicate ids — both break React keys.
  const edgeById = new Map<string, GraphEdge>()
  for (const e of edges) {
    if (e.source === e.target) continue
    if (!nodeById.has(e.source) || !nodeById.has(e.target)) continue
    if (!edgeById.has(e.id)) edgeById.set(e.id, e)
  }
  const kept = [...edgeById.values()]
  const neighbors = new Map<string, string[]>()
  const incident = new Map<string, GraphEdge[]>()
  for (const n of uniqNodes) {
    neighbors.set(n.id, [])
    incident.set(n.id, [])
  }
  for (const e of kept) {
    neighbors.get(e.source)?.push(e.target)
    neighbors.get(e.target)?.push(e.source)
    incident.get(e.source)?.push(e)
    incident.get(e.target)?.push(e)
  }
  const graph: Graph = { nodes: uniqNodes, edges: kept, nodeById, edgeById, neighbors, incident }
  return { ...graph, anchorId: meta.anchorId, corridor: meta.corridor, addedBy: meta.addedBy, bounds: meta.bounds }
}

// ── client-side view operations (shared by both sources) ────────────────────

// Collapse `nodeId` along a precomputed `route` (the true shortest path from the
// current node to it). The node is re-anchored to its shortest-path edge and
// folded to a stub: that edge stays (reappearing if a prior collapse removed
// it), ALL of the node's other edges are removed, and any node left unreachable
// from `fromId` is pruned. The collapsed node itself always stays (re-expandable)
// — it's only ever removed as a cascade when it loses every path. Collapsing the
// current node clears everything but it. O(V+E) over a bounded view.
export function collapseAlongPath(
  view: View,
  nodeId: string,
  route: string[],
  fromId: string,
): View {
  if (nodeId === fromId || route.length < 2) {
    const root = view.nodeById.get(fromId)
    return assembleView(root ? [root] : [], [], {
      anchorId: view.anchorId,
      corridor: [fromId],
      addedBy: new Map(),
      bounds: view.bounds,
    })
  }

  // Keep only the node's shortest-path edge (to its predecessor on the route);
  // drop every other edge touching it.
  const pred = route[route.length - 2]
  const edges = view.edges.filter((e) => {
    if (e.source !== nodeId && e.target !== nodeId) return true
    return (
      (e.source === pred && e.target === nodeId) || (e.target === pred && e.source === nodeId)
    )
  })

  // Prune: keep only what's still reachable from the current node over the
  // remaining edges (so a node with another visible path stays).
  const adj = new Map<string, string[]>()
  const link = (a: string, b: string) => {
    const l = adj.get(a)
    if (l) l.push(b)
    else adj.set(a, [b])
  }
  for (const e of edges) {
    link(e.source, e.target)
    link(e.target, e.source)
  }
  const keep = new Set<string>([fromId])
  const queue = [fromId]
  while (queue.length) {
    const cur = queue.shift()!
    for (const nb of adj.get(cur) ?? []) {
      if (keep.has(nb)) continue
      keep.add(nb)
      queue.push(nb)
    }
  }

  const keepNodes = view.nodes.filter((n) => keep.has(n.id))
  const finalEdges = edges.filter((e) => keep.has(e.source) && keep.has(e.target))
  const addedBy = new Map([...view.addedBy].filter(([id]) => keep.has(id)))
  return assembleView(keepNodes, finalEdges, {
    anchorId: view.anchorId,
    corridor: view.corridor.filter((id) => keep.has(id)),
    addedBy,
    bounds: view.bounds,
  })
}

// Fallback collapse when the source can't supply a true (dataset) shortest path:
// anchor to the shortest path over the *visible* view instead.
export function collapseView(view: View, nodeId: string, fromId: string): View {
  const route = shortestPath(view, fromId, nodeId) ?? [fromId, nodeId]
  return collapseAlongPath(view, nodeId, route, fromId)
}

// Auto-collapse "paths not taken": keep the corridor (visited trail) and the
// current node's local frontier, and fold away branches that are only reachable
// *through* an earlier corridor stop. Reversible render-time mask (reuses
// instances, no relayout). BFS out from the current node treating corridor nodes
// as walls — kept but not expanded — so their off-corridor subtrees drop out
// while the corridor chain itself stays connected.
export function corridorView(
  view: View,
  trail: string[],
  currentId: string,
  alsoKeep: Set<string> = new Set(),
): View {
  const corridor = new Set(trail)
  const keep = new Set<string>([...trail, ...alsoKeep, currentId])
  const queue = [currentId]
  const seen = new Set([currentId])
  while (queue.length) {
    const cur = queue.shift()!
    for (const nb of view.neighbors.get(cur) ?? []) {
      if (seen.has(nb)) continue
      seen.add(nb)
      keep.add(nb)
      if (!corridor.has(nb)) queue.push(nb) // don't expand through corridor walls
    }
  }
  const nodes = view.nodes.filter((n) => keep.has(n.id))
  const ids = new Set(nodes.map((n) => n.id))
  const edges = view.edges.filter((e) => ids.has(e.source) && ids.has(e.target))
  const addedBy = new Map([...view.addedBy].filter(([id]) => ids.has(id)))
  return assembleView(nodes, edges, {
    anchorId: view.anchorId,
    corridor: view.corridor.filter((id) => ids.has(id)),
    addedBy,
    bounds: view.bounds,
  })
}

// The egocentric landing view: keep ONLY the travelled corridor plus the current
// node's immediate (1-hop) neighbourhood — everything else (earlier stops'
// ego-nets, off-corridor branches) is dropped. Unlike corridorView's reversible
// render mask, this rebuilds the working view itself, so arriving on a node
// leaves you with exactly "the nodes you travelled on + the adjacent nodes to
// the destination" and nothing more.
export function egoView(view: View, currentId: string): View {
  const keep = new Set<string>([...view.corridor, currentId])
  for (const nb of view.neighbors.get(currentId) ?? []) keep.add(nb)
  const nodes = view.nodes.filter((n) => keep.has(n.id))
  const ids = new Set(nodes.map((n) => n.id))
  const edges = view.edges.filter((e) => ids.has(e.source) && ids.has(e.target))
  const addedBy = new Map([...view.addedBy].filter(([id]) => ids.has(id)))
  return assembleView(nodes, edges, {
    anchorId: view.anchorId,
    corridor: view.corridor.filter((id) => ids.has(id)),
    addedBy,
    bounds: view.bounds,
  })
}

// Render-time declutter: keep each node's top-`budget` structural edges (ranked
// by the other endpoint's PageRank); wormholes always pass. An edge shows only
// if it's within BOTH endpoints' budget (mutual top-N) — so a hub collapses to
// its strongest links instead of a hairball. Per-edge `shown`/`hidden`
// overrides win; nodes left with no visible edge drop out unless `specials`.
// `kinds` is the global per-kind on/off (structural edges vs. wormholes); edges
// in `exempt` (the active travel lane) ignore that toggle so the course is
// always visible in flight. Pure over the laid-out view (no relayout); reuses
// node/edge instances.
export function budgetView(
  view: View,
  budget: number,
  shown: Set<string>,
  hidden: Set<string>,
  specials: Set<string>,
  sortKey: EdgeSortKey = 'pagerank',
  kinds: { edges: boolean; wormholes: boolean } = { edges: true, wormholes: true },
  exempt: Set<string> = new Set(),
): { display: View; visibleEdgeIds: Set<string> } {
  const topPerNode = new Map<string, Set<string>>()
  for (const n of view.nodes) {
    const structural = (view.incident.get(n.id) ?? []).filter((e) => e.kind !== 'semantic')
    structural.sort((a, b) => compareEdges(a, b, n.id, view.nodeById, sortKey))
    topPerNode.set(n.id, new Set(structural.slice(0, budget).map((e) => e.id)))
  }
  const passes = (e: GraphEdge) =>
    e.kind === 'semantic' ||
    (!!topPerNode.get(e.source)?.has(e.id) && !!topPerNode.get(e.target)?.has(e.id))

  const visibleEdgeIds = new Set<string>()
  const edges: GraphEdge[] = []
  for (const e of view.edges) {
    if (hidden.has(e.id)) continue
    // The active travel lane / plotted course is always shown — it bypasses BOTH
    // the per-kind toggle AND the budget clip, so a course is never broken up by
    // an edge falling outside a hub's top-N. (Without this, only the per-kind
    // toggle was bypassed and a plotted path through a hub would lose edges.)
    if (exempt.has(e.id)) {
      visibleEdgeIds.add(e.id)
      edges.push(e)
      continue
    }
    if (!(e.kind === 'semantic' ? kinds.wormholes : kinds.edges)) continue
    if (shown.has(e.id) || passes(e)) {
      visibleEdgeIds.add(e.id)
      edges.push(e)
    }
  }
  const nodeIds = new Set(specials)
  for (const e of edges) {
    nodeIds.add(e.source)
    nodeIds.add(e.target)
  }
  const nodes = view.nodes.filter((n) => nodeIds.has(n.id))
  const display = assembleView(nodes, edges, {
    anchorId: view.anchorId,
    corridor: view.corridor,
    addedBy: view.addedBy,
    bounds: view.bounds,
  })
  return { display, visibleEdgeIds }
}

// Mask the current view by a schema-driven predicate (anchor + corridor +
// `alwaysKeep` — e.g. the current/selected node — are never filtered out). A
// property constraint only affects nodes that actually carry that property; a
// node missing it passes (so e.g. a year filter doesn't drop authors). relType
// constraints drop edges, which can in turn orphan attribute nodes.
export function filterView(view: View, predicate: Predicate, alwaysKeep: Set<string> = new Set()): View {
  const propVal = (n: GraphNode, key: string): string | number | undefined =>
    key === 'pagerank' ? n.pagerank : n.properties[key]

  const keep = (n: GraphNode): boolean => {
    if (n.id === view.anchorId || view.corridor.includes(n.id) || alwaysKeep.has(n.id)) return true
    if (predicate.nodeTypes && !predicate.nodeTypes.includes(n.type)) return false
    if (predicate.num) {
      for (const [key, r] of Object.entries(predicate.num)) {
        const v = propVal(n, key)
        if (typeof v !== 'number') continue // node lacks it → unaffected
        if (r.min != null && v < r.min) return false
        if (r.max != null && v > r.max) return false
      }
    }
    if (predicate.cat) {
      for (const [key, allowed] of Object.entries(predicate.cat)) {
        if (!allowed.length) continue
        const v = n.properties[key]
        if (v == null) continue // node lacks it → unaffected
        if (!allowed.includes(String(v))) return false
      }
    }
    return true
  }

  const nodes = view.nodes.filter(keep)
  const ids = new Set(nodes.map((n) => n.id))

  // Edge filter: relationship type + edge-property constraints (a missing prop
  // passes, same as nodes).
  const edgeOk = (e: GraphEdge): boolean => {
    if (predicate.relTypes && !predicate.relTypes.includes(e.rel ?? e.kind)) return false
    if (predicate.edgeNum) {
      for (const [key, r] of Object.entries(predicate.edgeNum)) {
        const v = e.props[key]
        if (typeof v !== 'number') continue
        if (r.min != null && v < r.min) return false
        if (r.max != null && v > r.max) return false
      }
    }
    if (predicate.edgeCat) {
      for (const [key, allowed] of Object.entries(predicate.edgeCat)) {
        if (!allowed.length) continue
        const v = e.props[key]
        if (v == null) continue
        if (!allowed.includes(String(v))) return false
      }
    }
    return true
  }
  const edgeFiltered = predicate.relTypes || predicate.edgeNum || predicate.edgeCat
  const edges = edgeFiltered ? view.edges.filter(edgeOk) : view.edges
  const addedBy = new Map([...view.addedBy].filter(([id]) => ids.has(id)))
  return assembleView(nodes, edges, {
    anchorId: view.anchorId,
    corridor: view.corridor.filter((id) => ids.has(id)),
    addedBy,
    bounds: { ...view.bounds, predicate },
  })
}
