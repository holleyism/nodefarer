import type { Graph, GraphEdge, GraphNode, NodeType } from '../types'

// Deterministic PRNG so the same seed always produces the same universe.
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const CLUSTER_COLORS = [
  '#66b8ff', '#ffb86b', '#7dffa8', '#ff7de9', '#fff37d',
  '#9d8bff', '#6bffe0', '#ff8a8a', '#b8ff6b', '#7da9ff',
]

const STEMS = [
  'Vela', 'Cygnus', 'Altair', 'Rigel', 'Lyra',
  'Orion', 'Draco', 'Mira', 'Atlas', 'Helios',
]

const NUMERALS = [
  'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI',
  'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI',
]

const SPECTRAL = ['O5V', 'B2IV', 'A0V', 'F5V', 'G2V', 'K1III', 'M4V', 'D (white dwarf)']
const HAZARD = ['low', 'low', 'moderate', 'moderate', 'severe']

const CLUSTERS = 10
const NODES_PER_CLUSTER = 20

export function generateGraph(seed = 7): Graph {
  const rand = mulberry32(seed)
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []

  for (let c = 0; c < CLUSTERS; c++) {
    const stem = STEMS[c]
    for (let i = 0; i < NODES_PER_CLUSTER; i++) {
      const isHub = i === 0
      const type: NodeType = isHub ? 'star' : rand() < 0.5 ? 'outpost' : 'relay'
      nodes.push({
        id: `${c}-${i}`,
        name: isHub ? `${stem} Prime` : `${stem} ${NUMERALS[i - 1]}`,
        type,
        cluster: c,
        color: CLUSTER_COLORS[c],
        properties: {
          'Spectral class': SPECTRAL[Math.floor(rand() * SPECTRAL.length)],
          'Mass (M☉)': Math.round((0.2 + rand() * 4) * 100) / 100,
          'Luminosity (L☉)': Math.round(rand() * 500) / 100,
          Surveyed: 2280 + Math.floor(rand() * 80),
          Hazard: HAZARD[Math.floor(rand() * HAZARD.length)],
        },
      })
    }

    // Intra-cluster wiring: every node reaches the cluster, hub-heavy.
    for (let i = 1; i < NODES_PER_CLUSTER; i++) {
      const target = rand() < 0.55 ? 0 : Math.floor(rand() * i)
      edges.push({ source: `${c}-${i}`, target: `${c}-${target}` })
    }
    // A few extra intra-cluster links for cycles.
    const extras = Math.floor(NODES_PER_CLUSTER * 0.3)
    for (let k = 0; k < extras; k++) {
      const a = Math.floor(rand() * NODES_PER_CLUSTER)
      const b = Math.floor(rand() * NODES_PER_CLUSTER)
      if (a !== b) edges.push({ source: `${c}-${a}`, target: `${c}-${b}` })
    }
  }

  // Bridges: guarantee inter-cluster connectivity, then add a few random ones.
  const bridge = (ca: number, cb: number) => {
    const a = `${ca}-${Math.floor(rand() * NODES_PER_CLUSTER)}`
    const b = `${cb}-${Math.floor(rand() * NODES_PER_CLUSTER)}`
    edges.push({ source: a, target: b })
    return [a, b]
  }
  const gateIds = new Set<string>()
  for (let c = 1; c < CLUSTERS; c++) {
    bridge(c, Math.floor(rand() * c)).forEach((id) => gateIds.add(id))
  }
  for (let k = 0; k < 5; k++) {
    const ca = Math.floor(rand() * CLUSTERS)
    const cb = Math.floor(rand() * CLUSTERS)
    if (ca !== cb) bridge(ca, cb).forEach((id) => gateIds.add(id))
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  for (const id of gateIds) {
    const n = nodeById.get(id)!
    if (n.type !== 'star') n.type = 'gate'
  }

  // Dedupe edges (unordered pairs) and build the adjacency map.
  const seen = new Set<string>()
  const deduped: GraphEdge[] = []
  for (const e of edges) {
    const key = e.source < e.target ? `${e.source}|${e.target}` : `${e.target}|${e.source}`
    if (e.source === e.target || seen.has(key)) continue
    seen.add(key)
    deduped.push(e)
  }

  const neighbors = new Map<string, string[]>()
  for (const n of nodes) neighbors.set(n.id, [])
  for (const e of deduped) {
    neighbors.get(e.source)!.push(e.target)
    neighbors.get(e.target)!.push(e.source)
  }

  return { nodes, edges: deduped, nodeById, neighbors }
}
