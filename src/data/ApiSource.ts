import type { BundleEdge, BundleNode } from './bundle'
import type { Candidate, EntryMode, ExpandRule, GraphSource, PathResult, Predicate, View } from './GraphSource'
import { deriveSchema, type GraphSchema } from './graphSchema'
import { Materializer, assembleView, collapseAlongPath, collapseView, filterView } from './viewBuilder'

// Landing density when the caller doesn't specify EntryMode.maxNodes; aligned
// with the bundle so the live scene lands as tight/clean. Stories can override.
const DEFAULT_MAX_NODES = 120

interface ServerView {
  anchor?: string
  nodes: BundleNode[]
  edges: BundleEdge[]
}

// Live source: the Go/Chi backend over Neo4j (backend/). The server returns
// bundle-shaped JSON, so render mapping + collapse/filter reuse the exact shared
// code StaticBundleSource uses — only topology (entry/expand/search/neighbors)
// goes over the wire.
export class ApiSource implements GraphSource {
  private mat = new Materializer()

  constructor(
    private baseUrl: string,
    private token?: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  private headers(json = false): HeadersInit {
    const h: Record<string, string> = {}
    if (json) h['Content-Type'] = 'application/json'
    if (this.token) h['Authorization'] = `Bearer ${this.token}`
    return h
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}/api/v1${path}`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`${path} ${res.status}: ${await res.text()}`)
    return res.json() as Promise<T>
  }

  private async get<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v != null && v !== '') q.set(k, String(v))
    const res = await fetch(`${this.baseUrl}/api/v1${path}?${q}`, { headers: this.headers() })
    if (!res.ok) throw new Error(`${path} ${res.status}: ${await res.text()}`)
    return res.json() as Promise<T>
  }

  // Derive the schema from everything loaded so far (grows as the user expands).
  // TODO(live, phase 3): back this with a Neo4j introspection endpoint
  // (db.schema.nodeTypeProperties / relationshipTypes) for full-dataset ranges.
  async schema(): Promise<GraphSchema> {
    return deriveSchema(this.mat.allNodes(), this.mat.allEdges())
  }

  async entry(e: EntryMode): Promise<View> {
    const maxNodes = ('maxNodes' in e && e.maxNodes) || DEFAULT_MAX_NODES
    const body =
      e.mode === 'search'
        ? { mode: 'search', query: e.query, kind: e.kind, maxNodes }
        : { mode: 'node', id: e.mode === 'node' ? e.id : undefined, maxNodes }
    const sv = await this.post<ServerView>('/entry', body)
    const anchor = sv.anchor ?? sv.nodes[0]?.id ?? ''
    const nodes = sv.nodes.map((n) => this.mat.node(n))
    const edges = sv.edges.map((ed) => this.mat.edge(ed))
    return assembleView(nodes, edges, {
      anchorId: anchor,
      corridor: [anchor],
      addedBy: new Map(),
      bounds: { anchor, maxNodes },
    })
  }

  async expand(view: View, nodeId: string, rule: ExpandRule = {}): Promise<View> {
    const have = view.nodes.map((n) => n.id)
    const sv = await this.post<ServerView>('/expand', {
      id: nodeId,
      have,
      rel: rule.relType,
      limit: rule.limit,
    })
    const haveSet = new Set(have)
    // Merge delta into the in-hand view, reusing cached instances (positions).
    const nodeById = new Map(view.nodes.map((n) => [n.id, n]))
    const addedBy = new Map(view.addedBy)
    for (const bn of sv.nodes) {
      nodeById.set(bn.id, this.mat.node(bn))
      if (!haveSet.has(bn.id) && !addedBy.has(bn.id)) addedBy.set(bn.id, nodeId)
    }
    const edgeById = new Map(view.edges.map((ed) => [ed.id, ed]))
    for (const be of sv.edges) edgeById.set(be.id, this.mat.edge(be))
    const corridor = view.corridor.includes(nodeId) ? view.corridor : [...view.corridor, nodeId]
    return assembleView([...nodeById.values()], [...edgeById.values()], {
      anchorId: view.anchorId,
      corridor,
      addedBy,
      bounds: view.bounds,
    })
  }

  // Collapse along the TRUE shortest path (Neo4j /path), so the node's
  // shortest-path edge is canonical (reappearing if a prior collapse removed
  // it). Falls back to a visible-view path if /path is unavailable.
  async collapse(view: View, nodeId: string, fromId: string): Promise<View> {
    if (nodeId === fromId) return collapseAlongPath(view, nodeId, [fromId], fromId)
    try {
      const r = await this.path(view, fromId, nodeId)
      if (r) return collapseAlongPath(r.view, nodeId, r.route, fromId)
    } catch {
      // /path unavailable — fall through to the visible-view collapse.
    }
    return collapseView(view, nodeId, fromId)
  }

  async filter(view: View, predicate: Predicate): Promise<View> {
    return filterView(view, predicate)
  }

  // True shortest path over the full Neo4j graph; merges any path nodes not yet
  // loaded into the view (like expand) so the ship can fly the real route.
  async path(view: View, fromId: string, toId: string): Promise<PathResult | null> {
    const have = view.nodes.map((n) => n.id)
    const sv = await this.post<ServerView & { route?: string[] }>('/path', {
      from: fromId,
      to: toId,
      have,
    })
    if (!sv.route || sv.route.length < 1) return null
    const haveSet = new Set(have)
    const nodeById = new Map(view.nodes.map((n) => [n.id, n]))
    const addedBy = new Map(view.addedBy)
    for (const bn of sv.nodes) {
      nodeById.set(bn.id, this.mat.node(bn))
      if (!haveSet.has(bn.id) && !addedBy.has(bn.id)) addedBy.set(bn.id, fromId)
    }
    const edgeById = new Map(view.edges.map((ed) => [ed.id, ed]))
    for (const be of sv.edges) edgeById.set(be.id, this.mat.edge(be))
    const newView = assembleView([...nodeById.values()], [...edgeById.values()], {
      anchorId: view.anchorId,
      corridor: view.corridor,
      addedBy,
      bounds: view.bounds,
    })
    return { view: newView, route: sv.route }
  }

  async search(query: string, kind: 'text' | 'semantic' = 'text'): Promise<Candidate[]> {
    if (!query.trim()) return []
    return this.get<Candidate[]>('/search', { q: query, kind })
  }

  // Semantic neighbors of a work via the vector index (server /similar).
  async similar(id: string, limit?: number): Promise<Candidate[]> {
    return this.get<Candidate[]>('/similar', { id, limit })
  }

  async neighbors(nodeId: string, rule: ExpandRule = {}): Promise<Candidate[]> {
    return this.get<Candidate[]>('/neighbors', { id: nodeId, rel: rule.relType, limit: rule.limit })
  }
}
