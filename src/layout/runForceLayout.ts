import { forceSimulation, forceLink, forceManyBody, forceCenter, forceX, forceY, forceZ } from 'd3-force-3d'
import type { Graph, GraphNode } from '../types'

// A nebula grouping that acts as a LAYOUT FORCE (Plan H): nodes are pulled toward
// their group's centroid, so changing the grouping re-spatializes the universe.
// `strength` (0..1) blends with the link/charge forces — 0 = pure force-directed,
// 1 = a near-hard spatial partition by group. A node with no group key isn't
// pulled.
export interface ClusterSpec {
  strength: number
  groupOf: (n: GraphNode) => string | null
  centroid: (key: string) => [number, number, number]
}

interface LayoutOpts {
  // Incremental: nodes that already have a position are pinned (fx/fy/fz) and
  // only newly-added nodes settle. Keeps the universe stable underfoot when a
  // view expands — the blast doors cover the brief recompute.
  pin?: boolean
  // Additionally fix these specific nodes (beyond `pin`). Used to hold the
  // viewpoint node still while the universe reforms around it (Plan H watch mode).
  pinIds?: Set<string>
  // Nebula grouping force (Plan H). Pinned nodes ignore it (they're fixed), so
  // an incremental expand still only settles new nodes — toward their centroids.
  cluster?: ClusterSpec
}

const placed = (n: GraphNode) => n.x != null && n.y != null && n.z != null

// Configure (but don't run) the simulation: seed/pin per opts, wire link/charge/
// center + the optional nebula cluster force. Exposed so a caller can tick it
// over animation frames (watch-the-reform) instead of to convergence at once.
export function buildSimulation(graph: Graph, opts: LayoutOpts = {}) {
  if (opts.pin) {
    // Seed new nodes near an already-placed neighbor so they don't fly in from
    // the origin; pin everything that's already positioned.
    for (const n of graph.nodes) {
      if (placed(n)) {
        n.fx = n.x
        n.fy = n.y
        n.fz = n.z
      }
    }
    for (const n of graph.nodes) {
      if (placed(n)) continue
      const anchor = (graph.neighbors.get(n.id) ?? [])
        .map((id) => graph.nodeById.get(id))
        .find((m) => m && placed(m))
      const jitter = () => (Math.random() - 0.5) * 30
      n.x = (anchor?.x ?? 0) + jitter()
      n.y = (anchor?.y ?? 0) + jitter()
      n.z = (anchor?.z ?? 0) + jitter()
    }
  }

  if (opts.pinIds) {
    for (const n of graph.nodes) {
      if (opts.pinIds.has(n.id) && placed(n)) {
        n.fx = n.x
        n.fy = n.y
        n.fz = n.z
      }
    }
  }

  const links = graph.edges.map((e) => ({ source: e.source, target: e.target }))
  const simulation = forceSimulation(graph.nodes, 3)
    .force(
      'link',
      forceLink(links)
        .id((d: { id: string }) => d.id)
        .distance(34)
        .strength(0.6),
    )
    .force('charge', forceManyBody().strength(-80).distanceMax(400))
    .force('center', forceCenter(0, 0, 0))

  // Nebula clustering: pull each grouped node toward its centroid (per-node
  // strength 0 for ungrouped nodes, so they keep floating by link/charge).
  if (opts.cluster && opts.cluster.strength > 0) {
    const c = opts.cluster
    const cache = new Map<string, [number, number, number]>()
    const cen = (n: GraphNode): [number, number, number] | null => {
      const k = c.groupOf(n)
      if (k == null) return null
      let v = cache.get(k)
      if (!v) {
        v = c.centroid(k)
        cache.set(k, v)
      }
      return v
    }
    const s = (n: GraphNode) => (cen(n) ? c.strength : 0)
    simulation
      .force('cluster-x', forceX((n: GraphNode) => cen(n)?.[0] ?? n.x ?? 0).strength(s))
      .force('cluster-y', forceY((n: GraphNode) => cen(n)?.[1] ?? n.y ?? 0).strength(s))
      .force('cluster-z', forceZ((n: GraphNode) => cen(n)?.[2] ?? n.z ?? 0).strength(s))
  }

  return simulation.stop()
}

// Clear every fixed-position pin (positions remain in x/y/z). Safe on unpinned
// nodes. Call after a run so a later full relayout can move them.
export function unpinAll(graph: Graph) {
  for (const n of graph.nodes) {
    n.fx = undefined
    n.fy = undefined
    n.fz = undefined
  }
}

// Runs the simulation to convergence synchronously and leaves positions fixed.
// An egocentric camera needs a stable universe — nodes must not drift underfoot.
export function runForceLayout(graph: Graph, opts: LayoutOpts = {}) {
  const simulation = buildSimulation(graph, opts)
  const ticks = opts.pin ? 160 : 400
  for (let i = 0; i < ticks; i++) simulation.tick()
  unpinAll(graph)
}
