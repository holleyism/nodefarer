import type { Bundle, BundleEdge, BundleNode } from './bundle'
import type { Candidate, EntryMode, ExpandRule, GraphSource, Predicate, View, ViewBounds } from './GraphSource'
import { Materializer, assembleView, collapseView, filterView } from './viewBuilder'

const DEFAULT_MAX_NODES = 250
const DEFAULT_EXPAND_LIMIT = 12

// Serves the GraphSource contract over the whole (already-bounded) bundle held
// in memory. Topology (entry/expand/neighbors) comes from local adjacency;
// collapse/filter are the shared client-side view ops; render mapping is shared
// via Materializer/assembleView (identical to ApiSource).
export class StaticBundleSource implements GraphSource {
  private bnode = new Map<string, BundleNode>()
  private bedge = new Map<string, BundleEdge>()
  private adj = new Map<string, { edgeId: string; other: string }[]>()
  private mat = new Materializer()

  constructor(private bundle: Bundle) {
    for (const n of bundle.nodes) this.bnode.set(n.id, n)
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

  // Materialize a node/edge id set into a View, inducing edges from adjacency.
  private buildView(
    ids: Set<string>,
    meta: { anchorId: string; corridor: string[]; addedBy: Map<string, string>; bounds: ViewBounds },
  ): View {
    const nodes = []
    for (const id of ids) {
      const b = this.bnode.get(id)
      if (b) nodes.push(this.mat.node(b))
    }
    const edges = []
    const seen = new Set<string>()
    for (const id of ids) {
      for (const { edgeId, other } of this.neighborsOf(id)) {
        if (!ids.has(other) || seen.has(edgeId)) continue
        seen.add(edgeId)
        edges.push(this.mat.edge(this.bedge.get(edgeId)!))
      }
    }
    return assembleView(nodes, edges, meta)
  }

  private defaultAnchor(): string {
    const seed = this.bundle.meta.seeds?.find((s) => this.bnode.has(s))
    if (seed) return seed
    let best = this.bundle.nodes[0]
    for (const n of this.bundle.nodes) if ((n.pagerank ?? 0) > (best.pagerank ?? 0)) best = n
    return best.id
  }

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
    return collapseView(view, nodeId)
  }

  async filter(view: View, predicate: Predicate): Promise<View> {
    return filterView(view, predicate)
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
