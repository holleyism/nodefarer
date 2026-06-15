import type { Bundle, BundleEdge, BundleNode } from './bundle'

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

const FIELDS = [
  'Neuroscience', 'Computer Science', 'Physics', 'Mathematics', 'Biology',
  'Chemistry', 'Materials Science', 'Linguistics',
]
const STEMS = ['Vela', 'Cygnus', 'Altair', 'Rigel', 'Lyra', 'Orion', 'Draco', 'Mira']

const COMMUNITIES = 8
const WORKS_PER = 18

// A synthetic OpenAlex-shaped Bundle — the offline fallback when no real
// bundle.json is present, so the app (and the smoke test) always run. Same
// shape ingest/export_bundle.py emits, so StaticBundleSource consumes it
// identically to live data.
export function syntheticBundle(seed = 7): Bundle {
  const rand = mulberry32(seed)
  const nodes: BundleNode[] = []
  const edges: BundleEdge[] = []
  const hubs: string[] = []

  // shared concept nodes
  const concepts = ['Memory', 'Attention', 'Topology', 'Optimization', 'Dynamics']
  concepts.forEach((name, i) =>
    nodes.push({ id: `C${i}`, type: 'concept', name, level: 1 }),
  )

  for (let c = 0; c < COMMUNITIES; c++) {
    const stem = STEMS[c]
    const field = FIELDS[c]
    const hubId = `W${c}-0`
    hubs.push(hubId)
    for (let i = 0; i < WORKS_PER; i++) {
      const id = `W${c}-${i}`
      nodes.push({
        id,
        type: 'work',
        name: i === 0 ? `${stem} foundational work` : `${stem} study ${i}`,
        community: c,
        pagerank: i === 0 ? 1 + rand() : 0.1 + rand() * 0.4,
        year: 1980 + Math.floor(rand() * 44),
        cited_by: Math.floor(rand() * (i === 0 ? 9000 : 400)),
        field,
      })
      // intra-community citations, hub-heavy
      if (i > 0) {
        const target = rand() < 0.55 ? 0 : Math.floor(rand() * i)
        edges.push(cite(id, `W${c}-${target}`))
      }
      // a couple of concept tags
      if (rand() < 0.5) {
        const ci = Math.floor(rand() * concepts.length)
        edges.push({
          id: `HC:${id}->C${ci}`,
          source: id,
          target: `C${ci}`,
          kind: 'structural',
          rel: 'concept',
          label: 'concept',
          props: { score: Math.round(rand() * 1000) / 1000 },
        })
      }
    }
  }

  // inter-community bridge citations
  for (let c = 1; c < COMMUNITIES; c++) {
    const a = `W${c}-${Math.floor(rand() * WORKS_PER)}`
    const b = `W${Math.floor(rand() * c)}-${Math.floor(rand() * WORKS_PER)}`
    edges.push(cite(a, b))
  }

  // semantic wormholes between distant community hubs
  const worm: Array<[number, number, number]> = [
    [0, 5, 0.91],
    [2, 7, 0.88],
    [1, 4, 0.86],
  ]
  for (const [a, b, sim] of worm) {
    edges.push({
      id: `SEM:${hubs[a]}~${hubs[b]}`,
      source: hubs[a],
      target: hubs[b],
      kind: 'semantic',
      rel: 'semantic',
      label: 'wormhole',
      props: { similarity: sim },
    })
  }

  const communities = Array.from({ length: COMMUNITIES }, (_, c) => ({
    id: c,
    size: WORKS_PER,
    representative: { id: `W${c}-0`, name: `${STEMS[c]} foundational work` },
    dominantConcept: concepts[c % concepts.length],
  }))

  return {
    meta: { seeds: [hubs[0]], communities: COMMUNITIES, embeddingModel: null },
    nodes,
    edges,
    communities,
  }
}

function cite(source: string, target: string): BundleEdge {
  return {
    id: `CITES:${source}->${target}`,
    source,
    target,
    kind: 'structural',
    rel: 'cites',
    label: 'cites',
  }
}
