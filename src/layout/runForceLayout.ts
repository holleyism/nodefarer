import { forceSimulation, forceLink, forceManyBody, forceCenter } from 'd3-force-3d'
import type { Graph } from '../types'

// Runs the simulation to convergence synchronously and leaves positions fixed.
// An egocentric camera needs a stable universe — nodes must not drift underfoot.
export function runForceLayout(graph: Graph) {
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

  for (let i = 0; i < 400; i++) simulation.tick()
}
