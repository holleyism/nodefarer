import type { Graph, GraphEdge, GraphNode, NodeType } from '../types'
import type { Bundle, BundleEdge, BundleNode } from './bundle'
import type {
  Candidate,
  EntryMode,
  ExpandRule,
  GraphSource,
  Predicate,
  View,
  ViewBounds,
} from './GraphSource'

// Community → galaxy colour (works); cycled deterministically by sorted id.
const COMMUNITY_COLORS = [
  '#66b8ff', '#ffb86b', '#7dffa8', '#ff7de9', '#fff37d',
  '#9d8bff', '#6bffe0', '#ff8a8a', '#b8ff6b', '#7da9ff',
  '#ff9d5c', '#5cffd6', '#d68bff', '#a8ff7d', '#7d8bff',
]
// Attribute nodes have no community — fixed, muted, per-type colours.
const TYPE_COLORS: Record<NodeType, string> = {
  work: '#66b8ff', // overridden by community below
  author: '#8fa9c8',
  concept: '#7dffa8',
  venue: '#ffd37d',
  institution: '#ff9db1',
}

const DEFAULT_MAX_NODES = 250
const DEFAULT_EXPAND_LIMIT = 12

function coerce(v: unknown): string | number {
  if (typeof v === 'number' || typeof v === 'string') return v
  return String(v)
}

// StaticBundleSource holds the whole (already-bounded) bundle in memory and
// serves the GraphSource contract over it. The materialized GraphNode/GraphEdge
// instances are cached so positions assigned by the layout persist across views
// (expand reuses the same instances; only new ones get laid out).
export class StaticBundleSource implements GraphSource {
  private bnode = new Map<string, BundleNode>()
  private bedge = new Map<string, BundleEdge>()
  private adj = new Map<string, { edgeId: string; other: string }[]>()
  private commColor = new Map<number, string>()

  private rnode = new Map<string, GraphNode>()
  private redge = new Map<string, GraphEdge>()

  constructor(private bundle: Bundle) {
    for (const n of bundle.nodes) this.bnode.set(n.id, n)
    const comms = [...new Set(bundle.nodes.map((n) => n.community).filter((c): c is number => c != null))]
    comms.sort((a, b) => a - b)
    comms.forEach((c, i) => this.commColor.set(c, COMMUNITY_COLORS[i % COMMUNITY_COLORS.length]))

    for (const e of bundle.edges) {
      this.bedge.set(e.id, e)
      this.push(e.source, e.id, e.target)
      this.push(e.target, e.id, e.source)
    }
  }

  private push(id: string, edgeId: string, other: string) {
    const a = this.adj.get(id)
    if (a) a.push({ edgeId, other })
    else this.adj.set(id, [{ edgeId, other }])
  }

  private neighborsOf(id: string) {
    return this.adj.get(id) ?? []
  }

  private pr(id: string) {
    return (this.bnode.get(id)?.pagerank as number) ?? 0
  }

  // ── render mapping ──────────────────────────────────────────────────────
  private materializeNode(id: string): GraphNode | undefined {
    const cached = this.rnode.get(id)
    if (cached) return cached
    const b = this.bnode.get(id)
    if (!b) return undefined
    const color = b.community != null ? this.commColor.get(b.community)! : TYPE_COLORS[b.type]
    const node: GraphNode = {
      id: b.id,
      // Some OpenAlex records have no display_name — fall back to the id so the
      // UI (sort/labels/search) never hits a null name.
      name: b.name ?? b.id,
      type: b.type,
      community: b.community,
      pagerank: b.pagerank,
      color,
      properties: this.displayProps(b),
    }
    this.rnode.set(id, node)
    return node
  }

  private displayProps(b: BundleNode): Record<string, string | number> {
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

  private materializeEdge(edgeId: string): GraphEdge {
    const cached = this.redge.get(edgeId)
    if (cached) return cached
    const b = this.bedge.get(edgeId)!
    const props: Record<string, string | number> = {}
    if (b.kind === 'semantic') {
      // NodePanel reads `Similarity` for the wormhole chip.
      const sim = b.props?.similarity ?? b.props?.Similarity
      if (sim != null) props.Similarity = sim
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
    this.redge.set(edgeId, edge)
    return edge
  }

  // ── view assembly ───────────────────────────────────────────────────────
  private buildView(
    ids: Set<string>,
    meta: { anchorId: string; corridor: string[]; addedBy: Map<string, string>; bounds: ViewBounds },
  ): View {
    const nodes: GraphNode[] = []
    for (const id of ids) {
      const n = this.materializeNode(id)
      if (n) nodes.push(n)
    }
    const edges: GraphEdge[] = []
    const seenEdge = new Set<string>()
    for (const id of ids) {
      for (const { edgeId, other } of this.neighborsOf(id)) {
        if (!ids.has(other) || seenEdge.has(edgeId)) continue
        seenEdge.add(edgeId)
        edges.push(this.materializeEdge(edgeId))
      }
    }
    const nodeById = new Map(nodes.map((n) => [n.id, n]))
    const edgeById = new Map(edges.map((e) => [e.id, e]))
    const neighbors = new Map<string, string[]>()
    const incident = new Map<string, GraphEdge[]>()
    for (const n of nodes) {
      neighbors.set(n.id, [])
      incident.set(n.id, [])
    }
    for (const e of edges) {
      neighbors.get(e.source)?.push(e.target)
      neighbors.get(e.target)?.push(e.source)
      incident.get(e.source)?.push(e)
      incident.get(e.target)?.push(e)
    }
    const graph: Graph = { nodes, edges, nodeById, edgeById, neighbors, incident }
    return { ...graph, anchorId: meta.anchorId, corridor: meta.corridor, addedBy: meta.addedBy, bounds: meta.bounds }
  }

  // Pick the landing node: explicit id → first seed → highest-pagerank work.
  private defaultAnchor(): string {
    const seed = this.bundle.meta.seeds?.find((s) => this.bnode.has(s))
    if (seed) return seed
    let best = this.bundle.nodes[0]
    for (const n of this.bundle.nodes) if ((n.pagerank ?? 0) > (best.pagerank ?? 0)) best = n
    return best.id
  }

  // ── contract ────────────────────────────────────────────────────────────
  async entry(e: EntryMode): Promise<View> {
    let anchor: string
    if (e.mode === 'search') {
      const hits = await this.search(e.query, e.kind)
      anchor = hits[0]?.id ?? this.defaultAnchor()
    } else if (e.mode === 'node') {
      anchor = e.id ?? this.defaultAnchor()
    } else {
      anchor = this.defaultAnchor() // overview not supported client-side yet
    }

    const maxNodes = DEFAULT_MAX_NODES
    const ids = new Set<string>([anchor])
    let frontier = [anchor]
    while (ids.size < maxNodes && frontier.length) {
      const cand = new Set<string>()
      for (const f of frontier) for (const { other } of this.neighborsOf(f)) if (!ids.has(other)) cand.add(other)
      const ranked = [...cand].sort((a, b) => this.pr(b) - this.pr(a))
      const next: string[] = []
      for (const c of ranked) {
        if (ids.size >= maxNodes) break
        ids.add(c)
        next.push(c)
      }
      frontier = next
    }
    return this.buildView(ids, {
      anchorId: anchor,
      corridor: [anchor],
      addedBy: new Map(),
      bounds: { anchor, maxNodes },
    })
  }

  async expand(view: View, nodeId: string, rule: ExpandRule = {}): Promise<View> {
    const limit = rule.limit ?? DEFAULT_EXPAND_LIMIT
    const ids = new Set(view.nodes.map((n) => n.id))
    const addedBy = new Map(view.addedBy)
    const cand = this.neighborsOf(nodeId)
      .filter(({ edgeId, other }) => {
        if (ids.has(other)) return false
        if (rule.relType && this.bedge.get(edgeId)?.rel !== rule.relType) return false
        return true
      })
      .map(({ other }) => other)
    const ranked = [...new Set(cand)].sort((a, b) => this.pr(b) - this.pr(a))
    for (const c of ranked.slice(0, limit)) {
      ids.add(c)
      if (!addedBy.has(c)) addedBy.set(c, nodeId)
    }
    const corridor = view.corridor.includes(nodeId) ? view.corridor : [...view.corridor, nodeId]
    return this.buildView(ids, { anchorId: view.anchorId, corridor, addedBy, bounds: view.bounds })
  }

  async collapse(view: View, nodeId: string): Promise<View> {
    const ids = new Set(view.nodes.map((n) => n.id))
    const addedBy = new Map(view.addedBy)
    // Remove nodes this node introduced that aren't on the corridor and have no
    // other in-view neighbor besides nodeId.
    for (const [id, parent] of view.addedBy) {
      if (parent !== nodeId || view.corridor.includes(id)) continue
      const others = this.neighborsOf(id).filter(({ other }) => other !== nodeId && ids.has(other))
      if (others.length === 0) {
        ids.delete(id)
        addedBy.delete(id)
      }
    }
    return this.buildView(ids, {
      anchorId: view.anchorId,
      corridor: view.corridor,
      addedBy,
      bounds: view.bounds,
    })
  }

  async filter(view: View, predicate: Predicate): Promise<View> {
    const keep = (id: string): boolean => {
      if (id === view.anchorId || view.corridor.includes(id)) return true
      const b = this.bnode.get(id)
      if (!b) return false
      if (predicate.nodeTypes && !predicate.nodeTypes.includes(b.type)) return false
      if (predicate.pagerankMin != null && (b.pagerank ?? 0) < predicate.pagerankMin) return false
      const year = b.year as number | undefined
      if (predicate.yearMin != null && (year == null || year < predicate.yearMin)) return false
      if (predicate.yearMax != null && (year == null || year > predicate.yearMax)) return false
      return true
    }
    const ids = new Set(view.nodes.map((n) => n.id).filter(keep))
    const addedBy = new Map([...view.addedBy].filter(([id]) => ids.has(id)))
    return this.buildView(ids, {
      anchorId: view.anchorId,
      corridor: view.corridor.filter((id) => ids.has(id)),
      addedBy,
      bounds: { ...view.bounds, predicate },
    })
  }

  async search(query: string, _kind: 'text' | 'semantic' = 'text'): Promise<Candidate[]> {
    // Static source = text only; semantic search needs the vector index (live).
    const q = query.trim().toLowerCase()
    if (!q) return []
    const hits: Candidate[] = []
    for (const n of this.bundle.nodes) {
      if (n.name?.toLowerCase().includes(q)) hits.push({ id: n.id, name: n.name, score: n.pagerank as number })
    }
    hits.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    return hits.slice(0, 25)
  }

  async neighbors(nodeId: string, rule: ExpandRule = {}): Promise<Candidate[]> {
    const out: Candidate[] = []
    for (const { edgeId, other } of this.neighborsOf(nodeId)) {
      if (rule.relType && this.bedge.get(edgeId)?.rel !== rule.relType) continue
      const b = this.bnode.get(other)
      if (b) out.push({ id: other, name: b.name, score: b.pagerank as number })
    }
    out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    return rule.limit ? out.slice(0, rule.limit) : out
  }
}
