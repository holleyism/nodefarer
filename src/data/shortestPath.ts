import type { Graph } from '../types'

// Unweighted BFS shortest path. Returns node ids from `from` to `to`
// inclusive, or null if unreachable.
export function shortestPath(graph: Graph, from: string, to: string): string[] | null {
  if (from === to) return [from]
  const prev = new Map<string, string>()
  const visited = new Set([from])
  const queue = [from]
  while (queue.length) {
    const id = queue.shift()!
    for (const n of graph.neighbors.get(id) ?? []) {
      if (visited.has(n)) continue
      visited.add(n)
      prev.set(n, id)
      if (n === to) {
        const path = [to]
        let cur = to
        while (cur !== from) {
          cur = prev.get(cur)!
          path.push(cur)
        }
        return path.reverse()
      }
      queue.push(n)
    }
  }
  return null
}
