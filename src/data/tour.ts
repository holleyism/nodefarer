import type { AtlasAnchor } from './atlas'
import type { EntryMode, ExpandRule, Predicate } from './GraphSource'

// ─────────────────────────────────────────────────────────────────────────────
// Tour = a recorded sequence of View operations + narration, played over a
// CANNED bundle (never the live graph — we ship a bundle, not the database).
//
// A tour and the free-navigation app speak the SAME op vocabulary (GraphSource:
// entry/expand/filter/path/collapse), so playback drives the real engine and a
// tour can't drift from how the app actually behaves. Authoring (Plan F) is the
// inverse of this file: capture the current op + a text box at each "mark stop".
//
// Byways are implicit. A `travel` step calls path(from, to), which already
// fills every node on the shortest route and folds off-corridor branches into
// nebulae (the just-built shortest-path travel + corridor collapse). So an
// author marks STOPS + text; the in-between nodes the ship flies through come
// for free — no per-byway annotation.
//
// See docs/exploration-design.md → Story S1 (walk-through i).
// ─────────────────────────────────────────────────────────────────────────────

// One transition applied to the working View when the user advances TO a step.
// Each kind maps 1:1 onto a GraphSource call, except `look` (camera/emphasis
// only — narration beats that don't mutate the graph, e.g. pointing at an edge).
export type TourOp =
  // Re-center on a node (entry / re-land). `maxNodes` sets the landing density.
  | { kind: 'land'; id: string; maxNodes?: number }
  // Open the details panel (inspector) on a node, without moving the ship —
  // the neighbourhood + node facts the narration is pointing at. During a tour
  // the inspector shows full-opacity but read-only (its controls are inert).
  // `focus` also turns + zooms the camera to frame the node (ship→node segment).
  | { kind: 'inspect'; id: string; focus?: boolean }
  // Plot a course from the current node to `to`: reveal + highlight the path and
  // frame it, WITHOUT travelling (the discoverable equivalent of a user
  // searching for a node and hitting "Plot course"). Stays highlighted until a
  // later `travelCourse` flies it.
  | { kind: 'plot'; to: string }
  // Travel the currently-plotted course — fly the highlighted path to its end.
  // `inspect` opens the destination's details panel on arrival (you land on it).
  | { kind: 'travelCourse'; inspect?: boolean }
  // Pull neighbors of `nodeId` along a relationship (e.g. lighting up a
  // wormhole: rule { relType: 'semantic', limit: 1 }). `face` turns the gaze
  // (instantly, behind the doors) toward that node so the reveal is in view when
  // the doors open — e.g. face the wormhole's far end to look down the conduit.
  | { kind: 'expand'; nodeId: string; rule?: ExpandRule; face?: string }
  // Bound the view with a reversible client mask (type / pagerank / year / …).
  | { kind: 'filter'; predicate: Predicate }
  // Shortest path from the CURRENT node to `to`; the ship flies the route and
  // (default) folds off-corridor branches. Byways are filled automatically.
  // `inspect` opens the destination's details panel on arrival (you're now on it).
  | { kind: 'travel'; to: string; collapseOffPath?: boolean; inspect?: boolean }
  // Prune `nodeId`'s subtree (BFS-rooted at `fromId`, the current node).
  | { kind: 'collapse'; nodeId: string; fromId: string }
  // No graph change. `focus` turns the gaze (animated, no zoom) toward a node —
  // e.g. a recap "look back" toward where we came from; `edge` lights a single
  // edge. Used for "look at this" beats and the closing recap.
  | { kind: 'look'; focus?: string; edge?: { from: string; to: string; rel: string } }
  // Pull the camera WAY back to frame the whole travelled journey corridor at
  // once (a recap finale): slerp + dolly to a vantage that fits every node the
  // ship has passed through.
  | { kind: 'overview' }
  // Toggle the nebula grouping (fields → galaxies). `watch` (default true) runs
  // the regroup as a visible reform with the doors open, so the "sky resolves
  // into fields" beat animates; false snaps it behind the doors. Grouping uses
  // the Atlas legend's nebula lens (e.g. by Field). `fold: 'distant'` then
  // collapses every nebula EXCEPT the one we're in — members hidden, but the
  // connections into them still show as fading stub beams ("you can't see that
  // far yet"). `strength` (0..1) and `spread` (the centroid spacing, ~100..1000)
  // override the grouping tightness + galaxy separation for the tour, so a story
  // can pull each field firmly into its own cloud.
  | {
      kind: 'nebula'
      on: boolean
      watch?: boolean
      fold?: 'distant' | 'none'
      strength?: number
      spread?: number
      // Cloud-body coverage (0..1): 1 makes each cloud enclose all its members
      // (e.g. a route node tugged to a field's edge), vs the default 0.85 that
      // ignores cross-field strays.
      coverage?: number
      // Drop cross-field edges from the layout sim so each field packs tightly
      // around its centroid (no cross-galaxy tug on boundary nodes).
      isolate?: boolean
    }

export interface TourStep {
  id: string
  // Short heading shown in the narration panel.
  title: string
  // The narration. Plain prose (markdown-light); rendered in the bottom panel.
  body: string
  // The View transition applied when advancing to this step. Omit for a pure
  // narration beat over the current view (equivalent to { kind: 'look' }).
  op?: TourOp
  // Optional override for the advance button's label (flavor, e.g. "Cross the
  // wormhole →"). The engine otherwise derives Back / Next / End tour from the
  // step's position. There is deliberately NO close ✕ on a tour — see below.
  nextLabel?: string
}

export interface Tour {
  schemaVersion: 1
  id: string
  title: string
  subtitle?: string
  // The canned bundle this tour plays over (fetched like public/bundle.json).
  bundle: string
  // How the tour opens. The first step's narration describes this landing; its
  // op is usually omitted (entry already placed the camera).
  entry: EntryMode
  steps: TourStep[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Anchor resolution (Plan G2). A tour step references a node either by raw id or
// by an Atlas anchor — a string `@name` resolved against the Atlas's `anchors`
// map at load. So a tour reads `@origin` / `@bridge` / `@destination` instead of
// hardcoded OpenAlex ids; the Atlas binds the names to this dataset. (Anchors
// give tours named, validated handles WITHIN an Atlas — not cross-dataset
// portability; tours stay dataset-bound.) Raw ids pass through unchanged, so a
// tour can mix anchors and one-off ids. An unknown `@name` is left as-is with a
// warning, surfacing the authoring error rather than silently misnavigating.
// ─────────────────────────────────────────────────────────────────────────────

function resolveAnchor(v: string, anchors: Record<string, AtlasAnchor>): string {
  if (v[0] !== '@') return v // a raw node id
  const name = v.slice(1)
  const a = anchors[name]
  if (typeof a === 'string') return a
  console.warn(
    `tour: anchor @${name} ${a ? 'is a query anchor (not yet supported)' : 'is undefined'}; leaving the reference unresolved`,
  )
  return v
}

const optAnchor = (v: string | undefined, anchors: Record<string, AtlasAnchor>) =>
  v == null ? v : resolveAnchor(v, anchors)

function resolveOp(op: TourOp, anchors: Record<string, AtlasAnchor>): TourOp {
  switch (op.kind) {
    case 'land':
    case 'inspect':
      return { ...op, id: resolveAnchor(op.id, anchors) }
    case 'plot':
    case 'travel':
      return { ...op, to: resolveAnchor(op.to, anchors) }
    case 'expand':
      return { ...op, nodeId: resolveAnchor(op.nodeId, anchors), face: optAnchor(op.face, anchors) }
    case 'collapse':
      return {
        ...op,
        nodeId: resolveAnchor(op.nodeId, anchors),
        fromId: resolveAnchor(op.fromId, anchors),
      }
    case 'look':
      return {
        ...op,
        focus: optAnchor(op.focus, anchors),
        edge: op.edge
          ? {
              ...op.edge,
              from: resolveAnchor(op.edge.from, anchors),
              to: resolveAnchor(op.edge.to, anchors),
            }
          : undefined,
      }
    default:
      return op // travelCourse, filter — no node references
  }
}

// Resolve every `@anchor` reference in a tour (entry + each step's op) against
// the Atlas anchors, returning a new Tour with concrete node ids. Called once at
// tour load, before handing the tour to the playback engine.
export function resolveTourAnchors(tour: Tour, anchors: Record<string, AtlasAnchor> = {}): Tour {
  const entry =
    tour.entry.mode === 'node' && tour.entry.id != null
      ? { ...tour.entry, id: resolveAnchor(tour.entry.id, anchors) }
      : tour.entry
  const steps = tour.steps.map((s) => (s.op ? { ...s, op: resolveOp(s.op, anchors) } : s))
  return { ...tour, entry, steps }
}

// Panel controls are DERIVED by the playback engine, not stored per-step, so an
// author can't produce a broken control set:
//   • Back     — shown when index > 0
//   • Next     — shown when not the last step (label from step.nextLabel ?? "Next →")
//   • End tour — replaces Next on the last step
//   • Quit     — always present
// The narration panel reuses the MessageToast chrome via a generic `actions`
// list (toast passes a single dismiss ✕; the tour passes Back/Next/Quit and
// NO ✕ — a tour is never dismissed by an ambiguous corner button).
