// ─────────────────────────────────────────────────────────────────────────────
// Lamping & Rao (CHI '95) hyperbolic-tree layout in the Poincaré disk.
//
//   1. BFS a spanning tree over the in-view subgraph, rooted at the seed.
//   2. Root at the origin. Each node owns an arc of ideal-boundary directions;
//      its children are placed one fixed hyperbolic STEP outward, splitting the
//      parent's arc weighted by subtree size.
//   3. Crucially, when we re-origin at a child (a hyperbolic translation), the
//      child's allotted boundary arc REOPENS to a wide cone — exponential
//      circumference growth is what keeps the wedges from collapsing with depth.
//      We get that "for free" by carrying the arc as two ideal endpoints and
//      transforming them into each child's frame, rather than by an ad-hoc
//      angular shrink.
//
// Output is per-node disk coordinates (layout space, root-centred); the renderer
// applies a live view isometry on top for pan/recenter. Throwaway — see memory
// hyperbolic-poc-plan.
// ─────────────────────────────────────────────────────────────────────────────

import type { View } from '../data/GraphSource'
import {
  type Complex,
  type Mobius,
  C,
  apply,
  cangle,
  cneg,
  compose,
  fromPolar,
  IDENTITY,
  recenter,
  radiusForDist,
} from './complex'

export interface HyperbolicLayout {
  pos: Map<string, Complex> // node id → disk coordinate (root at origin)
  depth: Map<string, number>
  parent: Map<string, string | null>
  treeEdgeIds: Set<string> // view edges that form the spanning tree
}

interface TreeNode {
  id: string
  children: TreeNode[]
  size: number // subtree node count (drives angular allocation)
}

// BFS spanning tree over the view's adjacency from the anchor. Any node the BFS
// can't reach (rare — entry views are connected) is attached to the root so it
// still appears.
function spanningTree(view: View, rootId: string): { root: TreeNode; treeEdgeIds: Set<string>; parent: Map<string, string | null> } {
  const byId = new Map<string, TreeNode>()
  const node = (id: string): TreeNode => {
    let t = byId.get(id)
    if (!t) {
      t = { id, children: [], size: 1 }
      byId.set(id, t)
    }
    return t
  }
  const root = node(rootId)
  const parent = new Map<string, string | null>([[rootId, null]])
  const treeEdgeIds = new Set<string>()
  const queue = [rootId]
  while (queue.length) {
    const cur = queue.shift()!
    for (const nbr of view.neighbors.get(cur) ?? []) {
      if (parent.has(nbr)) continue
      parent.set(nbr, cur)
      node(cur).children.push(node(nbr))
      // Record the view edge that realises this tree link (for non-tree styling).
      const e = (view.incident.get(cur) ?? []).find((ed) => ed.source === nbr || ed.target === nbr)
      if (e) treeEdgeIds.add(e.id)
      queue.push(nbr)
    }
  }
  // Orphans (disconnected in the view) hang off the root.
  for (const n of view.nodes) {
    if (!parent.has(n.id)) {
      parent.set(n.id, rootId)
      root.children.push(node(n.id))
    }
  }
  // Post-order subtree sizes.
  const sizeOf = (t: TreeNode): number => {
    t.size = 1 + t.children.reduce((s, c) => s + sizeOf(c), 0)
    return t.size
  }
  sizeOf(root)
  return { root, treeEdgeIds, parent }
}

// Whether `x` lies on the CCW arc from `lo` to `hi` (after unwrapping).
function arcContains(lo: number, hi: number, x: number): boolean {
  const T = 2 * Math.PI
  const wrap = (a: number) => ((a % T) + T) % T
  let h = wrap(hi - lo)
  let v = wrap(x - lo)
  if (h === 0) h = T
  return v > 0 && v < h
}

export function layoutHyperbolic(view: View, rootId: string, step: number): HyperbolicLayout {
  const { root, treeEdgeIds, parent } = spanningTree(view, rootId)
  const pos = new Map<string, Complex>()
  const depth = new Map<string, number>()
  const r = radiusForDist(step) // disk radius of one hyperbolic step

  // Place a subtree. `frame` maps this node's LOCAL disk coords → global; the
  // node sits at frame(0). [a0,a1] is the boundary-direction arc (in this node's
  // local frame) the whole subtree may occupy.
  interface Frame {
    id: string
    frame: Mobius
    a0: number
    a1: number
    d: number
  }
  const stack: Frame[] = [{ id: root.id, frame: IDENTITY, a0: 0, a1: 2 * Math.PI, d: 0 }]
  const tnodeById = new Map<string, TreeNode>()
  const indexTree = (t: TreeNode) => {
    tnodeById.set(t.id, t)
    t.children.forEach(indexTree)
  }
  indexTree(root)

  while (stack.length) {
    const { id, frame, a0, a1, d } = stack.pop()!
    pos.set(id, apply(frame, C(0)))
    depth.set(id, d)
    const tn = tnodeById.get(id)!
    const kids = tn.children
    if (!kids.length) continue
    const totalW = kids.reduce((s, c) => s + c.size, 0)
    let cursor = a0
    for (const child of kids) {
      const frac = child.size / totalW
      const ca0 = cursor
      const ca1 = cursor + frac * (a1 - a0)
      cursor = ca1
      const phi = (ca0 + ca1) / 2
      // Child placement in this frame: one hyperbolic step out along φ.
      const cLocal = fromPolar(r, phi)
      // Child frame: local-origin → cLocal, then this frame to global. We also
      // rotate so the parent lands at the child's local angle π, which makes the
      // "avoid the parent" bookkeeping uniform across levels.
      const toChild = recenter(cneg(cLocal)) // maps 0 → cLocal
      const childFrame = compose(frame, toChild)
      // The child's owned arc, expressed in the CHILD's local frame: transform
      // the two boundary ideal points through the inverse placement. Möbius maps
      // the unit circle to itself, so these stay on the boundary; their angles
      // give the (re-widened) cone the child's subtree may use.
      const inv = recenter(cLocal) // inverse of toChild: maps cLocal → 0
      let d0 = cangle(apply(inv, fromPolar(1, ca0)))
      let d1 = cangle(apply(inv, fromPolar(1, ca1)))
      // The parent sits at child-local angle = angle(apply(inv, frame-origin)).
      const parentAngle = cangle(apply(inv, C(0)))
      // Pick the arc [d0,d1] that does NOT contain the parent direction.
      if (arcContains(d0, d1, parentAngle)) {
        const t = d0
        d0 = d1
        d1 = t
      }
      let hi = d1
      while (hi <= d0) hi += 2 * Math.PI
      stack.push({ id: child.id, frame: childFrame, a0: d0, a1: hi, d: d + 1 })
    }
  }

  return { pos, depth, parent, treeEdgeIds }
}
