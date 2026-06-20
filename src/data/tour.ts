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
  | { kind: 'travelCourse' }
  // Pull neighbors of `nodeId` along a relationship (e.g. lighting up a
  // wormhole: rule { relType: 'semantic', limit: 1 }).
  | { kind: 'expand'; nodeId: string; rule?: ExpandRule }
  // Bound the view with a reversible client mask (type / pagerank / year / …).
  | { kind: 'filter'; predicate: Predicate }
  // Shortest path from the CURRENT node to `to`; the ship flies the route and
  // (default) folds off-corridor branches. Byways are filled automatically.
  | { kind: 'travel'; to: string; collapseOffPath?: boolean }
  // Prune `nodeId`'s subtree (BFS-rooted at `fromId`, the current node).
  | { kind: 'collapse'; nodeId: string; fromId: string }
  // No graph change — move/emphasize the camera, or highlight a single edge.
  // Used for "look at this" beats (the wormhole conduit) and the closing recap.
  | { kind: 'look'; focus?: string; edge?: { from: string; to: string; rel: string } }

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

// Panel controls are DERIVED by the playback engine, not stored per-step, so an
// author can't produce a broken control set:
//   • Back     — shown when index > 0
//   • Next     — shown when not the last step (label from step.nextLabel ?? "Next →")
//   • End tour — replaces Next on the last step
//   • Quit     — always present
// The narration panel reuses the MessageToast chrome via a generic `actions`
// list (toast passes a single dismiss ✕; the tour passes Back/Next/Quit and
// NO ✕ — a tour is never dismissed by an ambiguous corner button).
