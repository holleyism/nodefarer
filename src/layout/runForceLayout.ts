import { forceSimulation, forceLink, forceManyBody, forceCenter } from 'd3-force-3d'
import type { Graph, GraphNode } from '../types'

interface LayoutOpts {
  // Incremental: nodes that already have a position are pinned (fx/fy/fz) and
  // only newly-added nodes settle. Keeps the universe stable underfoot when a
  // view expands — the blast doors cover the brief recompute.
  pin?: boolean
}

// Runs the simulation to convergence synchronously and leaves positions fixed.
// An egocentric camera needs a stable universe — nodes must not drift underfoot.
export function runForceLayout(graph: Graph, opts: LayoutOpts = {}) {
  const placed = (n: GraphNode) => n.x != null && n.y != null && n.z != null

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
    .stop()

  const ticks = opts.pin ? 160 : 400
  for (let i = 0; i < ticks; i++) simulation.tick()

  if (opts.pin) {
    // Unpin so a later full relayout can move them if needed.
    for (const n of graph.nodes) {
      n.fx = undefined
      n.fy = undefined
      n.fz = undefined
    }
  }
}
