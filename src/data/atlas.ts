import type { EdgeKind, NodeType } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// The Atlas (Plan G) — the top-order object that makes a dataset self-describing
// and self-demoing. It is a *parameterized lens over a source* (the source is
// NOT the Atlas). The engine implements the mechanics; the Atlas's `legend` says
// what the symbols MEAN for this dataset (what a wormhole is, what a nebula is,
// how nodes are coloured, which properties to surface). See
// docs/exploration-design.md §2.
//
// G0 (this file) defines the schema only — no behaviour change. `public/
// manifest.json` is a hand-written Atlas that reproduces today's hardcoded
// behaviour exactly, validating the model against reality before G1 wires the
// legend into viewBuilder.ts.
// ─────────────────────────────────────────────────────────────────────────────

export const ATLAS_SCHEMA_VERSION = 1

// ── Source binding — where the data lives. The source is referenced, not owned:
// multiple Atlases can point at one backend with different params/legend/tours.
export type AtlasSource =
  | { kind: 'bundle'; url: string }
  | { kind: 'api'; url: string; token?: string; params?: Record<string, unknown> }

// ── Legend: the wormhole edge lens ──────────────────────────────────────────
// A wormhole is an EDGE lens. Today: edges whose `kind` is 'semantic' (embedding
// kNN). Another dataset might define it as a structural edge crossing community
// boundaries. `enabled:false` ships a dataset with no wormholes at all.
export type WormholeLens =
  | {
      basis: 'edgeKind'
      enabled: boolean
      kind: EdgeKind // edges of this kind are wormholes (today: 'semantic')
      similarityProp?: string // edge prop carrying the score (today: 'Similarity')
      minSimilarity?: number // hide below this score (omit = no floor)
      color?: string // conduit colour (today: '#b98bff')
    }
  | {
      basis: 'crossCommunity'
      enabled: boolean
      relType: string // a structural rel whose endpoints sit in different communities
      color?: string
    }

// ── Legend: the nebula grouping + layout lens (Plan H) ───────────────────────
// A nebula is NOT an overlay — it is a grouping that controls SPATIALIZATION:
// members attract to a shared centroid, so changing the grouping re-lays-out the
// universe (§4.4). `enabled:false` today (nebulae not yet built ⇒ pure
// edge-weight layout). `groupStrength` blends it with the force layout: 0 = pure
// force-directed, 1 = near-hard spatial partition by group.
export type NebulaBasis = 'property' | 'community' | 'semanticKnn'

export type NebulaBucketing =
  | { kind: 'linear'; size: number }
  | { kind: 'quantile'; buckets: number }

export interface NebulaLens {
  enabled: boolean
  basis: NebulaBasis
  key?: string // node property when basis='property' (e.g. 'Field')
  bucketing?: NebulaBucketing // for continuous params (age/income/year)
  centroidArrangement?: 'ring' | 'axis' | 'sphere' // sphere (default) = 3D volume; axis = ordered params read left→right; ring = planar
  groupStrength?: number // 0..1 blend with edge-weight layout
  color?: string // skin colour when used as a highlight overlay (EMPHASIS_COLOR.nebula)
}

// ── Legend: node colouring + styling ─────────────────────────────────────────
// A node colours by its community (palette indexed modulo length) when it has
// one; otherwise by its type. Mirrors viewBuilder.communityColor / TYPE_COLORS.
export interface ColorLegend {
  communityPalette: string[]
  typeColors: Record<NodeType, string>
}

export interface NodeTypeStyle {
  radius: number // mirrors scene/Nodes.tsx NODE_RADIUS
  label?: string
}

// One inspector row: which raw bundle field to surface and its display label,
// per node type, in order. Mirrors viewBuilder.displayProps.
export interface PropertyDisplay {
  source: string // bundle key (e.g. 'cited_by')
  label: string // display label (e.g. 'Cited by')
}

export interface Legend {
  wormhole: WormholeLens
  nebula: NebulaLens
  colors: ColorLegend
  nodeTypes: Partial<Record<NodeType, NodeTypeStyle>>
  propertyDisplay: Partial<Record<NodeType, PropertyDisplay[]>>
}

// ── Capabilities — engine-feasibility flags only ─────────────────────────────
// Gate what the engine can do (no embeddings ⇒ the wormhole lens can't
// function). NOT used to gate tours: tours are dataset-bound and don't port, so
// there's nothing to hide.
export interface AtlasCapabilities {
  communities: boolean
  embeddings: boolean
  betweenness: boolean
  pagerank: boolean
}

// ── View defaults — dataset-tunable; tours and the UI may override ───────────
export interface ViewDefaults {
  entryMaxNodes: number // landing density (source default; e.g. a tour requests tighter)
  edgeBudget: number // edges/node render clip
  edgeSort: string // EdgeSortKey driving the Links order + clip
}

// ── Tours — part of the Atlas, hard-bound to this dataset ────────────────────
// Referenced by file (the on-disk Tour JSON, see src/data/tour.ts `Tour`) plus
// the launcher's display metadata. IMPORTANT: tour ops are NODE-RELATIVE by
// contract — they reference node ids / anchors and frame the camera relative to
// nodes, NEVER absolute coordinates, because the force layout is not
// deterministic and positions differ per run. (A future revision may inline the
// full Tour objects instead of referencing files.)
export interface AtlasTourRef {
  file: string // path under the source root (e.g. 'tours/s1-idea-genealogy.json')
  title: string
  subtitle?: string
}

// ── Anchors — named node handles WITHIN this Atlas ───────────────────────────
// For tour reuse + load-time validation, NOT cross-dataset portability. A string
// is a node id; an object resolves by search at load.
export type AtlasAnchor = string | { query: string; kind?: 'text' | 'semantic' }

// ── The Atlas ────────────────────────────────────────────────────────────────
export interface Atlas {
  schemaVersion: typeof ATLAS_SCHEMA_VERSION
  id: string
  name: string
  description?: string
  provenance?: string
  license?: string
  source: AtlasSource
  capabilities: AtlasCapabilities
  legend: Legend
  defaults: ViewDefaults
  anchors: Record<string, AtlasAnchor>
  tours: AtlasTourRef[]
}

// A runtime data-source selection (Plan G4): which "universe" to load. Persisted
// in localStorage; the in-app picker swaps it live. Distinct from an Atlas's own
// `source` binding — this is the *user's* choice of where to bootstrap from.
//   - bundle: a hosted directory (`dir` '' = web root; or /demos/<id>/ or any URL)
//   - bundle-local: a folder picked off local disk this session (not persisted —
//     the handle can't survive reload, so it falls back to the default on reload)
//   - api: a live backend (carries the url)
export type SourceChoice =
  | { kind: 'bundle'; dir?: string }
  | { kind: 'bundle-local' }
  | { kind: 'api'; url: string; token?: string }

const SOURCE_KEY = 'nodefarer.source'

// The active source choice: a saved pick wins; else VITE_API_URL bootstraps the
// live track (now just a default, not the switch); else the bundled demo.
export function loadSourceChoice(): SourceChoice {
  try {
    const raw = localStorage.getItem(SOURCE_KEY)
    if (raw) return JSON.parse(raw) as SourceChoice
  } catch {
    /* ignore malformed/blocked storage */
  }
  const url = import.meta.env.VITE_API_URL as string | undefined
  if (url) return { kind: 'api', url, token: import.meta.env.VITE_API_TOKEN as string | undefined }
  return { kind: 'bundle' }
}

export function saveSourceChoice(choice: SourceChoice): void {
  try {
    localStorage.setItem(SOURCE_KEY, JSON.stringify(choice))
  } catch {
    /* ignore blocked storage */
  }
}

// Fetch + parse an Atlas. Default `/manifest.json` is the bundle's co-resident
// manifest (static track); the live backend serves its Atlas at
// `<api>/api/v1/atlas` (Plan G3), which may sit behind the bearer gate — pass
// `token` for that. Throws on a missing endpoint or schema mismatch; callers
// fall back to the built-in DEFAULT_LEGEND (see viewBuilder) so the app still
// runs offline.
// Validate a parsed Atlas (schema version + the fields the engine relies on).
// Throws on mismatch; shared by loadAtlas and the bundle-directory validator.
export function validateAtlas(raw: unknown): Atlas {
  if (!raw || typeof raw !== 'object') throw new Error('not an Atlas object')
  const atlas = raw as Atlas
  if (atlas.schemaVersion !== ATLAS_SCHEMA_VERSION) {
    throw new Error(`schemaVersion ${atlas.schemaVersion} != ${ATLAS_SCHEMA_VERSION}`)
  }
  if (!atlas.legend) throw new Error('missing legend')
  return atlas
}

export async function loadAtlas(url = '/manifest.json', token?: string): Promise<Atlas> {
  const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {}
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`atlas ${res.status}`)
  return validateAtlas(await res.json())
}
