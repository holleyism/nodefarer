import type { GraphEdge, GraphNode } from '../types'

// A description of what's filterable in a graph, derived by scanning the data
// (static bundle) or, later, served by the backend (live). The FilterPanel
// renders entirely from this — nothing about the scholarly schema is hard-coded.

export type PropKind = 'number' | 'categorical' | 'text'

export interface SchemaProperty {
  key: string // property key as it appears on GraphNode.properties / GraphEdge.props (or 'pagerank')
  label: string
  kind: PropKind
  on: string[] // node types (node props) or relationship types (edge props) that carry it
  range?: [number, number] // numbers
  categories?: string[] // categorical
}

export interface GraphSchema {
  nodeTypes: { name: string; count: number }[]
  relTypes: { name: string; count: number }[]
  nodeProperties: SchemaProperty[]
  edgeProperties: SchemaProperty[]
}

// Strings with more distinct values than this are treated as free text (no
// categorical chips) rather than a filter control.
const MAX_CATEGORIES = 25

// PageRank lives on its own field (not in properties); expose it as a node prop.
const PAGERANK_KEY = 'pagerank'

interface Acc {
  on: Set<string>
  nums: number[]
  strs: Set<string>
  sawBool: boolean
  sawText: boolean // a string set too large to enumerate
}

const newAcc = (): Acc => ({ on: new Set(), nums: [], strs: new Set(), sawBool: false, sawText: false })

function accumulate(a: Acc, scope: string, v: unknown) {
  a.on.add(scope)
  if (typeof v === 'number') a.nums.push(v)
  else if (typeof v === 'boolean') a.sawBool = true
  else if (typeof v === 'string') {
    if (a.strs.size <= MAX_CATEGORIES) a.strs.add(v)
    else a.sawText = true
  }
}

// Turn one accumulator into a typed SchemaProperty (numeric → range; low-card
// string/boolean → categorical; otherwise text).
function toProperty(key: string, label: string, a: Acc): SchemaProperty | null {
  const on = [...a.on]
  if (a.nums.length && a.strs.size === 0 && !a.sawBool) {
    return { key, label, kind: 'number', on, range: [Math.min(...a.nums), Math.max(...a.nums)] }
  }
  if ((a.strs.size > 0 || a.sawBool) && !a.sawText && a.nums.length === 0) {
    const categories = a.sawBool ? ['true', 'false'] : [...a.strs].sort()
    if (categories.length <= MAX_CATEGORIES) return { key, label, kind: 'categorical', on, categories }
  }
  if (a.nums.length || a.strs.size || a.sawText) return { key, label, kind: 'text', on }
  return null
}

// Scan materialized nodes + edges into a schema. Pure; safe to memoize per
// dataset. Node and edge properties are tracked separately so the panel can
// section them.
export function deriveSchema(nodes: GraphNode[], edges: GraphEdge[]): GraphSchema {
  const typeCounts = new Map<string, number>()
  const relCounts = new Map<string, number>()
  const nodeProps = new Map<string, Acc>()
  const edgeProps = new Map<string, Acc>()
  const prAcc = newAcc()

  const bucket = (m: Map<string, Acc>, key: string) => {
    let a = m.get(key)
    if (!a) m.set(key, (a = newAcc()))
    return a
  }

  for (const n of nodes) {
    typeCounts.set(n.type, (typeCounts.get(n.type) ?? 0) + 1)
    if (typeof n.pagerank === 'number') accumulate(prAcc, n.type, n.pagerank)
    for (const [key, v] of Object.entries(n.properties)) accumulate(bucket(nodeProps, key), n.type, v)
  }

  for (const e of edges) {
    const rel = e.rel ?? e.kind
    relCounts.set(rel, (relCounts.get(rel) ?? 0) + 1)
    for (const [key, v] of Object.entries(e.props)) accumulate(bucket(edgeProps, key), rel, v)
  }

  const nodeProperties: SchemaProperty[] = []
  const pr = toProperty(PAGERANK_KEY, 'PageRank', prAcc)
  if (pr) nodeProperties.push(pr)
  for (const [key, a] of nodeProps) {
    const p = toProperty(key, key, a)
    if (p) nodeProperties.push(p)
  }
  const edgeProperties: SchemaProperty[] = []
  for (const [key, a] of edgeProps) {
    const p = toProperty(key, key, a)
    if (p) edgeProperties.push(p)
  }

  const sortByCount = (m: Map<string, number>) =>
    [...m.entries()].map(([name, count]) => ({ name, count })).sort((x, y) => y.count - x.count)

  return {
    nodeTypes: sortByCount(typeCounts),
    relTypes: sortByCount(relCounts),
    nodeProperties,
    edgeProperties,
  }
}

export const PAGERANK_PROP = PAGERANK_KEY
