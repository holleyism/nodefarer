// ─────────────────────────────────────────────────────────────────────────────
// H3-style cone-tree layout in the Poincaré ball (Munzner, InfoVis '97 — the 3D
// analog of the disk's Lamping layout). BFS a spanning tree, root at the origin,
// each node's children placed one fixed hyperbolic STEP outward in a CONE of
// directions (a spherical cap) around the outward axis, the cap subdivided among
// children. Exponential volume growth (children of far-out nodes are
// hyperbolically far apart even when Euclidean-close to the rim) keeps a fixed
// moderate cone from collapsing — the 3D version of "more room at the edges".
// Throwaway; see memory hyperbolic-poc-plan.
// ─────────────────────────────────────────────────────────────────────────────

import type { View } from '../data/GraphSource'
import { type V3, ZERO, capDirections, fibonacciSphere, stepFrom, vnorm, vsub } from './ball'

export interface BallLayout {
  pos: Map<string, V3>
  depth: Map<string, number>
  parent: Map<string, string | null>
  treeEdgeIds: Set<string>
}

interface TreeNode {
  id: string
  children: TreeNode[]
  size: number
}

function spanningTree(view: View, rootId: string) {
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
      const e = (view.incident.get(cur) ?? []).find((ed) => ed.source === nbr || ed.target === nbr)
      if (e) treeEdgeIds.add(e.id)
      queue.push(nbr)
    }
  }
  for (const n of view.nodes) {
    if (!parent.has(n.id)) {
      parent.set(n.id, rootId)
      root.children.push(node(n.id))
    }
  }
  const sizeOf = (t: TreeNode): number => {
    t.size = 1 + t.children.reduce((s, c) => s + sizeOf(c), 0)
    return t.size
  }
  sizeOf(root)
  return { root, parent, treeEdgeIds }
}

export function layoutBall(view: View, rootId: string, step: number, coneHalf: number): BallLayout {
  const { root, parent, treeEdgeIds } = spanningTree(view, rootId)
  const pos = new Map<string, V3>()
  const depth = new Map<string, number>()

  interface Job {
    node: TreeNode
    P: V3
    axis: V3 | null // outward direction (null = root: spread over the whole sphere)
    d: number
  }
  const stack: Job[] = [{ node: root, P: ZERO, axis: null, d: 0 }]
  while (stack.length) {
    const { node, P, axis, d } = stack.pop()!
    pos.set(node.id, P)
    depth.set(node.id, d)
    const kids = node.children
    if (!kids.length) continue
    // Directions for the children: whole sphere at the root, else a cap around
    // the outward axis so they fan forward, not back toward the parent.
    const dirs = axis ? capDirections(axis, coneHalf, kids.length) : fibonacciSphere(kids.length)
    for (let i = 0; i < kids.length; i++) {
      const childPos = stepFrom(P, dirs[i], step)
      // The child's outward axis ≈ the ray continuing away from the parent.
      const outward = vnorm(vsub(childPos, P))
      stack.push({ node: kids[i], P: childPos, axis: outward, d: d + 1 })
    }
  }
  return { pos, depth, parent, treeEdgeIds }
}
