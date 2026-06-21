import type { NebulaLens } from '../data/atlas'
import type { View } from '../data/GraphSource'
import type { GraphNode } from '../types'
import type { ClusterSpec } from './runForceLayout'

// Derive a nebula ClusterSpec (Plan H) from the active nebula lens + the current
// view: which group each node belongs to, and where each group's centroid sits.
// The grouping basis comes from the Atlas legend; the centroid arrangement makes
// the grouping legible — a ring for categorical groups, an axis for ordered ones
// (so e.g. years read left→right).

// Default distance between group centroids — sets how far apart the nebulae sit.
// Independent of how tightly nodes pack WITHIN a cluster (that's the charge
// repulsion among a cluster's own members), so raising it spreads the clouds
// apart without spreading the individual nodes. Exposed as a live console
// control; this is the fallback when none is supplied.
export const DEFAULT_SPACING = 380

function groupKey(n: GraphNode, lens: NebulaLens): string | null {
  switch (lens.basis) {
    case 'community':
      return n.community != null ? String(n.community) : null
    case 'property': {
      if (!lens.key) return null
      const v = lens.key === 'pagerank' ? n.pagerank : n.properties[lens.key]
      // (Continuous-value bucketing per lens.bucketing is a later refinement;
      // distinct values group as-is for now.)
      return v == null || v === '' ? null : String(v)
    }
    case 'semanticKnn':
      // Needs precomputed embedding clusters; not available client-side yet.
      return null
  }
}

function arrangeCentroids(
  keys: string[],
  mode: 'ring' | 'axis' | 'sphere',
  spacing: number,
): Map<string, [number, number, number]> {
  const m = new Map<string, [number, number, number]>()
  const n = keys.length

  if (mode === 'axis') {
    // Ordered sequence along X, centered on the origin (reads in value order).
    keys.forEach((k, i) => m.set(k, [(i - (n - 1) / 2) * spacing, 0, 0]))
    return m
  }

  if (mode === 'ring') {
    // Evenly spaced around a ring in the XZ plane (planar — looks flat in 3D).
    const r = n > 1 ? (spacing * n) / (2 * Math.PI) : 0
    keys.forEach((k, i) => {
      const a = (i / n) * Math.PI * 2
      m.set(k, [Math.cos(a) * r, 0, Math.sin(a) * r])
    })
    return m
  }

  // sphere (default): spread centroids evenly over a sphere via the Fibonacci
  // (golden-spiral) distribution, so the universe keeps its volume in 3D instead
  // of collapsing to a flat disk at high grouping strength. Radius grows with the
  // count so centroids stay ~spacing apart on the surface.
  if (n === 1) {
    m.set(keys[0], [0, 0, 0])
    return m
  }
  const r = spacing * Math.sqrt(n / (4 * Math.PI))
  const golden = Math.PI * (3 - Math.sqrt(5))
  keys.forEach((k, i) => {
    const y = 1 - (i / (n - 1)) * 2 // 1 → -1
    const ring = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = golden * i
    m.set(k, [Math.cos(theta) * ring * r, y * r, Math.sin(theta) * ring * r])
  })
  return m
}

// Assign every node a group key per the lens. Nodes that directly carry the key
// (e.g. works with a `field`) get it; the rest are PROPAGATED via neighbor-
// majority vote over a few rounds. Most nodes carry no key — in the scholarly
// graph authors / concepts / venues have no `field`, only works do — so without
// propagation they'd float between clusters instead of joining the neighbourhood
// they belong to. Returns null when the lens is off or nothing carries the key.
export function assignGroups(view: View, lens: NebulaLens): Map<string, string> | null {
  if (!lens.enabled) return null
  const keyOf = new Map<string, string>()
  for (const n of view.nodes) {
    const k = groupKey(n, lens)
    if (k != null) keyOf.set(n.id, k)
  }
  if (keyOf.size === 0) return null

  for (let round = 0; round < 3; round++) {
    const pending: Array<[string, string]> = []
    for (const n of view.nodes) {
      if (keyOf.has(n.id)) continue
      const tally = new Map<string, number>()
      for (const nb of view.neighbors.get(n.id) ?? []) {
        const k = keyOf.get(nb)
        if (k != null) tally.set(k, (tally.get(k) ?? 0) + 1)
      }
      let best: string | null = null
      let bestN = 0
      for (const [k, c] of tally) if (c > bestN) ((best = k), (bestN = c))
      if (best != null) pending.push([n.id, best])
    }
    if (pending.length === 0) break
    for (const [id, k] of pending) keyOf.set(id, k) // applied after the round (stable)
  }
  return keyOf
}

export function buildClusterSpec(
  view: View,
  lens: NebulaLens,
  groupStrength: number,
  spacing: number = DEFAULT_SPACING,
): ClusterSpec | null {
  if (groupStrength <= 0) return null
  const keyOf = assignGroups(view, lens)
  if (!keyOf) return null

  // Distinct group keys present. Numeric keys sort numerically (so an axis reads
  // in value order); else lexical.
  const list = [...new Set(keyOf.values())]
  const allNumeric = list.every((k) => k !== '' && !Number.isNaN(Number(k)))
  list.sort(allNumeric ? (a, b) => Number(a) - Number(b) : (a, b) => a.localeCompare(b))

  const centroids = arrangeCentroids(list, lens.centroidArrangement ?? 'sphere', spacing)
  return {
    strength: groupStrength,
    groupOf: (n) => keyOf.get(n.id) ?? null,
    centroid: (k) => centroids.get(k) ?? [0, 0, 0],
  }
}

// A stable colour for a group key (hashed into the palette) — used to tint the
// nebula's volumetric body so each field reads as its own cloud.
export function groupColor(key: string, palette: string[]): string {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
  return palette[Math.abs(h) % palette.length]
}
