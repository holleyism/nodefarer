import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, CircularProgress, Stack, Typography } from '@mui/material'
import type { ViewMode } from './types'
import { Canvas } from '@react-three/fiber'
import { syntheticBundle } from './data/generateGraph'
import { StaticBundleSource } from './data/StaticBundleSource'
import { ApiSource } from './data/ApiSource'
import { DEFAULT_LEGEND, budgetView, corridorView, filterView, maskFoldedGroups } from './data/viewBuilder'
import { loadAtlas, validateAtlas, loadSourceChoice, saveSourceChoice } from './data/atlas'
import type { Atlas, AtlasTourRef, SourceChoice } from './data/atlas'
import { urlBundleStore, pickLocalBundle, validateBundle, loadDemoCatalog } from './data/bundleStore'
import type { BundleStore, DemoEntry } from './data/bundleStore'
import type { EdgeSortKey } from './data/edgeSort'
import type { EntryMode, ExpandRule, GraphSource, Predicate, View } from './data/GraphSource'
import type { GraphSchema } from './data/graphSchema'
import type { Bundle } from './data/bundle'
import { resolveTourAnchors } from './data/tour'
import type { Tour, TourOp } from './data/tour'
import { shortestPath } from './data/shortestPath'
import { runForceLayout, buildSimulation, unpinAll, type ClusterSpec } from './layout/runForceLayout'
import { buildClusterSpec, assignGroups, groupColor, DEFAULT_SPACING } from './layout/grouping'
import type { NebulaBody } from './scene/Nebulae'
import type { NebulaStub } from './scene/NebulaStubEdges'
import type { NebulaInfo } from './hud/NebulaPanel'
import type { GraphNode } from './types'
import { GraphScene } from './scene/GraphScene'
import type { Emphasis } from './scene/RouteHighlight'
import { Hud } from './hud/Hud'
import { MessageToast, type AppMessage } from './hud/MessageToast'
import { TourPanel } from './hud/TourPanel'
import { useTour, type TourExecutor } from './hud/useTour'

interface BuiltSource {
  source: GraphSource
  atlas: Atlas | null
  view: View
  actualKind: 'bundle' | 'api' // what we actually connected to (may differ on api fallback)
  store: BundleStore // where aux files (tours) for this universe are read from
}

// A local-folder bundle picked this session (Plan G4). Module-level because a
// File System Access handle / FileList can't be serialized into the persisted
// SourceChoice — on reload a 'bundle-local' choice falls back to the default dir.
let localBundleStore: BundleStore | null = null

// Which directory a bundle choice reads from. api reads aux files (tours) from
// the web root.
function bundleStoreFor(choice: SourceChoice): BundleStore {
  if (choice.kind === 'bundle-local') return localBundleStore ?? urlBundleStore('')
  if (choice.kind === 'bundle') return urlBundleStore(choice.dir ?? '')
  return urlBundleStore('')
}

// Build a data source + its entry view from a SourceChoice (Plan G4). Resolves
// the Atlas first (its legend drives materialization): on the live track prefer
// the backend's own Atlas, else the bundle directory's manifest, else the
// built-in default legend. A failing API falls back to the bundle so the app
// never hard-hangs. Never throws (the bundle/synthetic fallback always yields a
// view).
async function buildSource(choice: SourceChoice): Promise<BuiltSource> {
  const store = bundleStoreFor(choice)
  let atlas: Atlas | null = null

  if (choice.kind === 'api') {
    const base = choice.url.replace(/\/$/, '')
    try {
      atlas = await loadAtlas(`${base}/api/v1/atlas`, choice.token)
    } catch (err) {
      console.warn('Backend Atlas unavailable; trying bundle manifest:', err)
    }
  }
  if (!atlas) {
    try {
      atlas = validateAtlas(await store.readJSON('manifest.json'))
    } catch (err) {
      console.warn('No Atlas manifest; using default legend:', err)
    }
  }
  const legend = atlas?.legend ?? DEFAULT_LEGEND

  if (choice.kind === 'api') {
    try {
      const s = new ApiSource(choice.url, choice.token, legend)
      const view = await s.entry({ mode: 'node' })
      return { source: s, atlas, view, actualKind: 'api', store }
    } catch (err) {
      console.warn('ApiSource unavailable, falling back to bundle:', err)
    }
  }

  // bundle (or api fallback): read the data file the atlas points at, relative to
  // the bundle directory.
  const dataPath = (atlas?.source.kind === 'bundle' && atlas.source.url) || 'bundle.json'
  let bundle: Bundle
  try {
    bundle = (await store.readJSON(dataPath)) as Bundle
  } catch {
    bundle = syntheticBundle(7)
  }
  const s = new StaticBundleSource(bundle, legend)
  const view = await s.entry({ mode: 'node' })
  return { source: s, atlas, view, actualKind: 'bundle', store }
}

// The exploration state captured at a tour step boundary, restored on Back.
interface SnapState {
  view: View
  currentId: string
  trail: string[]
  selectedId: string | null
  predicate: Predicate
  autoCollapse: boolean
  shownEdgeIds: Set<string>
  hiddenEdgeIds: Set<string>
  showEdges: boolean
  showWormholes: boolean
  plottedRoute: string[]
}

export default function App() {
  const sourceRef = useRef<GraphSource | null>(null)
  // The loaded Atlas: its `tours` drive the launcher catalog and its `anchors`
  // resolve `@name` references in tour steps (Plan G2).
  const atlasRef = useRef<Atlas | null>(null)
  // Where the active universe's aux files (tours) are read from (Plan G4).
  const bundleStoreRef = useRef<BundleStore | null>(null)
  const [tours, setTours] = useState<AtlasTourRef[]>([])
  // The active data-source selection + the catalog of shipped demos (Plan G4).
  const [sourceChoice, setSourceChoice] = useState<SourceChoice>(() => loadSourceChoice())
  const [demos, setDemos] = useState<DemoEntry[]>([])
  // Nebula grouping (Plan H): on/off + blend strength (0..1). `watchReform` runs
  // the relayout visibly to convergence (doors open) instead of hidden.
  const [nebulaOn, setNebulaOn] = useState(false)
  const [groupStrength, setGroupStrength] = useState(0.6)
  const [nebulaSpacing, setNebulaSpacing] = useState(DEFAULT_SPACING)
  // How much of a group's members the cloud body must enclose: the percentile of
  // member distances used for its radius. 0.85 ignores cross-field strays so a
  // single outlier doesn't balloon the cloud; 1 makes the cloud encompass EVERY
  // member (e.g. a route node tugged to the field's edge).
  const [nebulaCoverage, setNebulaCoverage] = useState(0.85)
  // When on, cross-field edges are dropped from the layout sim so each field
  // packs tightly around its centroid (no cross-galaxy tug on boundary nodes).
  const [nebulaIsolate, setNebulaIsolate] = useState(false)
  const [watchReform, setWatchReform] = useState(false)
  // Fold/inspect nebulae (Plan H2b). `foldedGroups` = which groups are collapsed
  // to just their body (explicit, so "fold distant" is a one-shot action and a
  // nebula can be re-folded). `focusedNebula` = the selected/locked nebula (its
  // body shows a reticle and the rail panel inspects it); null = show the current
  // node's nebula. `hoveredNebula` = transient hover highlight + name readout.
  const [foldedGroups, setFoldedGroups] = useState<Set<string>>(new Set())
  const [focusedNebula, setFocusedNebula] = useState<string | null>(null)
  const [hoveredNebula, setHoveredNebula] = useState<string | null>(null)
  // Highlight the inspected nebula's visible members in place (Plan H3).
  const [highlightNebula, setHighlightNebula] = useState(false)
  const [view, setView] = useState<View | null>(null)
  const [schema, setSchema] = useState<GraphSchema | null>(null)
  const [currentId, setCurrentId] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Edges the user pinned from the selected node's link list (bracketed in the
  // viewport) and the one currently hovered (lighter preview bracket). Both are
  // scoped to the open node panel — cleared whenever selection changes.
  const [pinnedEdgeIds, setPinnedEdgeIds] = useState<string[]>([])
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null)
  // Remaining hops of the active journey (graph-shortest-path, current node
  // excluded). Empty array = parked.
  const [route, setRoute] = useState<string[]>([])
  const traveling = route.length > 0
  // The journey's stops (visited node ids, in order) — drives breadcrumbs. Each
  // completed travel appends its destination; landing fresh (search) resets it.
  const [trail, setTrail] = useState<string[]>([])
  // How the viewport picks highlights, the proximity-mode reticle budget,
  // and the lock set chosen by TagSelector.
  const [viewMode, setViewMode] = useState<ViewMode>('proximity')
  const [maxTags, setMaxTags] = useState(10)
  const [taggedIds, setTaggedIds] = useState<string[]>([])
  // Edge declutter: render at most this many edges per node (mutual top-N by
  // neighbor PageRank), with per-edge user overrides on top.
  const [edgeBudget, setEdgeBudget] = useState(12)
  // Which property orders the Links list AND drives the edge clip.
  const [edgeSort, setEdgeSort] = useState<EdgeSortKey>('pagerank')
  const [shownEdgeIds, setShownEdgeIds] = useState<Set<string>>(() => new Set())
  const [hiddenEdgeIds, setHiddenEdgeIds] = useState<Set<string>>(() => new Set())
  // Global per-kind edge visibility (structural edges vs. semantic wormholes).
  // The active travel lane overrides these so the course shows in flight.
  const [showEdges, setShowEdges] = useState(true)
  const [showWormholes, setShowWormholes] = useState(true)
  // Bound-the-view filter: a reversible client mask over the working view
  // (node type / pagerank / year). Empty = no filter.
  const [predicate, setPredicate] = useState<Predicate>({})
  // Auto-collapse "paths not taken": an optional reversible render mask that
  // folds off-corridor branches when parked. Off by default — a power-user toggle.
  const [autoCollapse, setAutoCollapse] = useState(false)
  // Whether the camera is locked to the course while traveling. Dragging
  // mid-flight unlocks it; "follow course" (or journey's end) re-locks.
  const [following, setFollowing] = useState(true)
  const [followSignal, setFollowSignal] = useState(0)
  // Bumped to re-frame the ship (undo orbit / look-around) on a scripted step.
  const [recenterSignal, setRecenterSignal] = useState(0)
  // Whether the paired recenter keeps the current dolly zoom (manual travel) or
  // resets it to default (scripted moves / plotted-course travel).
  const [recenterKeepZoom, setRecenterKeepZoom] = useState(false)
  // A plotted-but-not-yet-travelled course: the ordered node ids of the
  // shortest path from the current node to a searched target (inclusive of
  // both ends). Empty = no course plotted. The route + its edges render as a
  // distinct "route" emphasis (see scene/RouteHighlight); the scanner shifts to
  // a describe/Travel view while it's set. Travelling or clearing empties it.
  const [plottedRoute, setPlottedRoute] = useState<string[]>([])
  // Bumped to auto-frame a freshly plotted course (turn + dolly so the route
  // fits, always including the destination). Carries the route world points.
  const [frameSignal, setFrameSignal] = useState(0)
  const [frameTarget, setFrameTarget] = useState<{
    points: [number, number, number][]
    destination: [number, number, number]
    // false → only turn the gaze to the destination, keep the current zoom.
    zoom?: boolean
    // true → snap the gaze instantly (no animated turn), e.g. behind the doors.
    instant?: boolean
  } | null>(null)
  // Blast doors: shut the window while the universe is being (re)laid out.
  const [doorsClosed, setDoorsClosed] = useState(false)
  // Bottom-left status/error readout.
  const [message, setMessage] = useState<AppMessage | null>(null)
  const msgId = useRef(0)
  const notify = (text: string, level: 'error' | 'info' = 'info') =>
    setMessage({ id: ++msgId.current, text, level })

  // Tour playback plumbing. The tour engine drives the same handlers manual
  // navigation uses; these refs let an op resolve its promise only once its
  // effect has committed (a post-commit frame), and gate manual travel/jump
  // while a tour is playing so the user can't desync the narration.
  const tourActiveRef = useRef(false)
  const travelDoneRef = useRef<(() => void) | null>(null)
  const opDoneRef = useRef<(() => void) | null>(null)
  const plotDoneRef = useRef<(() => void) | null>(null)
  // Resolves a tour `nebula` op once a watch-reform regroup finishes.
  const reformDoneRef = useRef<(() => void) | null>(null)
  // Set on arrival once parked (route empties), to settle a pending tour travel.
  const revealPendingRef = useRef<string | null>(null)
  // Latest committed exploration state, for Back snapshots (assigned in the
  // render body below so a capture taken after an op reflects the applied view).
  const snapStateRef = useRef<SnapState | null>(null)
  // Resolve on the second animation frame so the committed render (and the
  // render-body refs below) reflect the applied state before the tour reads it.
  const settleNext = (ref: { current: (() => void) | null }) => {
    const done = ref.current
    ref.current = null
    if (done) requestAnimationFrame(() => requestAnimationFrame(done))
  }
  // Keep the snapshot source current every render (post-commit the awaited op
  // promise resolves, so this holds the applied state when snapshot() reads it).
  if (view && currentId) {
    snapStateRef.current = {
      view,
      currentId,
      trail,
      selectedId,
      predicate,
      autoCollapse,
      shownEdgeIds,
      hiddenEdgeIds,
      showEdges,
      showWormholes,
      plottedRoute,
    }
  }

  // The active nebula grouping lens (Atlas legend, overridden by the live UI
  // controls) and its ClusterSpec for a given view (Plan H). Null when nebulae
  // are off or nothing in the view carries the grouping key.
  const activeLegend = () => atlasRef.current?.legend ?? DEFAULT_LEGEND
  const clusterFor = (v: View): ClusterSpec | undefined => {
    if (!nebulaOn) return undefined
    const lens = { ...activeLegend().nebula, enabled: true, groupStrength }
    const spec = buildClusterSpec(v, lens, groupStrength, nebulaSpacing)
    if (spec) spec.isolate = nebulaIsolate
    return spec ?? undefined
  }
  // For INCREMENTAL (pinned) relayouts: pull each new node toward the actual
  // current centre of its group's already-placed members, not the abstract
  // geometric centroid. A path/expand node then joins the existing cloud instead
  // of flying to a fresh sphere slot that no longer matches the pinned layout
  // (groups with nothing placed yet fall back to the geometric centroid).
  const clusterForPinned = (v: View): ClusterSpec | undefined => {
    if (!nebulaOn) return undefined
    const lens = { ...activeLegend().nebula, enabled: true, groupStrength }
    const groupOf = assignGroups(v, lens)
    if (!groupOf) return undefined
    const sums = new Map<string, [number, number, number, number]>()
    for (const n of v.nodes) {
      if (n.x == null || n.y == null || n.z == null) continue
      const k = groupOf.get(n.id)
      if (k == null) continue
      const s = sums.get(k) ?? [0, 0, 0, 0]
      s[0] += n.x
      s[1] += n.y
      s[2] += n.z
      s[3] += 1
      sums.set(k, s)
    }
    const geo = buildClusterSpec(v, lens, groupStrength, nebulaSpacing)
    return {
      strength: groupStrength,
      isolate: nebulaIsolate,
      groupOf: (n) => groupOf.get(n.id) ?? null,
      centroid: (k) => {
        const s = sums.get(k)
        return s && s[3] > 0
          ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]]
          : geo?.centroid(k) ?? [0, 0, 0]
      },
    }
  }

  // Initial load: build the source for the active choice (saved pick, else the
  // VITE_API_URL default, else the bundle) and land on its entry view. Runtime
  // switching happens in switchUniverse (Plan G4).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { source, atlas, view: v, store } = await buildSource(loadSourceChoice())
      if (cancelled) return
      // Honour the Atlas's nebula default on first land.
      const lens = atlas?.legend.nebula
      const on = lens?.enabled ?? false
      const gs = lens?.groupStrength && lens.groupStrength > 0 ? lens.groupStrength : 0.6
      const cluster = on ? (buildClusterSpec(v, { ...lens!, enabled: true, groupStrength: gs }, gs) ?? undefined) : undefined
      runForceLayout(v, { cluster })
      sourceRef.current = source
      atlasRef.current = atlas
      bundleStoreRef.current = store
      setTours(atlas?.tours ?? [])
      setNebulaOn(on)
      setGroupStrength(gs)
      setView(v)
      setCurrentId(v.anchorId)
      setTrail([v.anchorId])
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Load the shipped-demo catalog once (drives the universe picker's demo list).
  useEffect(() => {
    let cancelled = false
    loadDemoCatalog().then((list) => {
      if (!cancelled) setDemos(list)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Refresh the filterable schema as the loaded data changes. Static source
  // returns its cached full-bundle schema; the API source re-derives from
  // everything materialized so far, so the filters grow as you expand.
  useEffect(() => {
    if (!view) return
    let cancelled = false
    sourceRef.current?.schema().then((sc) => {
      if (!cancelled) setSchema(sc)
    })
    return () => {
      cancelled = true
    }
  }, [view])

  const clearEdges = () => {
    setPinnedEdgeIds([])
    setHoveredEdgeId(null)
  }
  const handleSelect = (id: string) => {
    // Inspecting is suppressed while a tour drives the view (the rail — including
    // the inspector — is locked); look-around stays free.
    if (traveling || tourActiveRef.current) return
    setSelectedId(id)
    clearEdges()
  }
  const handleTogglePin = (id: string) =>
    setPinnedEdgeIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  // Manual travel is suppressed while a tour plays (the tour drives travel
  // itself via travelTo); this keeps the on-screen journey in lockstep with the
  // narration the user is reading.
  const handleTravel = (id: string) => {
    if (tourActiveRef.current) return
    // Normalize the orbit + gaze before a manual traversal (so the first hop
    // doesn't fly off in the orbited direction), but keep the user's dolly zoom.
    reframeForMove(true)
    handleTravelCore(id)
  }
  const handleTravelCore = (id: string) => {
    if (!view || !currentId || traveling || id === currentId) return
    const s = sourceRef.current
    if (!s) return
    setSelectedId(null)
    clearEdges()
    const from = currentId
    ;(async () => {
      // True shortest path over the whole graph (via the source). If that fails
      // (e.g. the live /path endpoint isn't deployed yet), fall back to a path
      // over the loaded view so travel still works.
      let result = null as Awaited<ReturnType<GraphSource['path']>>
      try {
        result = await s.path(view, from, id)
      } catch {
        result = null
      }
      let nextView = view
      let path: string[]
      if (result && result.route.length > 1) {
        nextView = result.view
        path = result.route
        // Lay out any path nodes that weren't loaded (existing nodes pinned).
        if (nextView.nodes.length > view.nodes.length)
          runForceLayout(nextView, { pin: true, cluster: clusterForPinned(nextView) })
      } else {
        const local = shortestPath(view, from, id)
        path = local ?? [from, id] // unreachable → direct flight
      }
      // Reveal the corridor edges so the lane stays lit for the whole flight.
      const reveal = new Set(shownEdgeIds)
      for (let i = 0; i < path.length - 1; i++) {
        const e = (nextView.incident.get(path[i]) ?? []).find(
          (ed) => ed.source === path[i + 1] || ed.target === path[i + 1],
        )
        if (e) reveal.add(e.id)
      }
      setShownEdgeIds(reveal)
      if (nextView !== view) setView(nextView)
      setRoute(path.slice(1))
    })()
  }
  // The edge ids along a path (consecutive hops), looked up in a view's incidence.
  const pathEdgeIds = (v: View, path: string[]) => {
    const ids = new Set<string>()
    for (let i = 0; i < path.length - 1; i++) {
      const e = (v.incident.get(path[i]) ?? []).find(
        (ed) => ed.source === path[i + 1] || ed.target === path[i + 1],
      )
      if (e) ids.add(e.id)
    }
    return ids
  }
  // Plot a course: compute the shortest path from the current node to `id`,
  // bring its nodes into the view, and highlight the route as a distinct "route"
  // emphasis — WITHOUT flying. Then auto-frame so the whole route reads (always
  // including the destination). Travelling/clearing is a separate, deliberate
  // step (the scanner shifts to a describe/Travel view). See handleTravelCourse.
  const handlePlotCourse = (id: string) => {
    if (!view || !currentId || traveling || id === currentId) return
    const s = sourceRef.current
    if (!s) return
    const from = currentId
    ;(async () => {
      let result = null as Awaited<ReturnType<GraphSource['path']>>
      try {
        result = await s.path(view, from, id)
      } catch {
        result = null
      }
      let nextView = view
      let path: string[]
      if (result && result.route.length > 1) {
        nextView = result.view
        path = result.route
        if (nextView.nodes.length > view.nodes.length)
          runForceLayout(nextView, { pin: true, cluster: clusterForPinned(nextView) })
      } else {
        const local = shortestPath(view, from, id)
        path = local ?? [from, id]
      }
      if (nextView !== view) setView(nextView)
      setSelectedId(null)
      clearEdges()
      setPlottedRoute(path)
      // Auto-frame the route ahead (exclude the current node — the ship's parked
      // on it). Turn + dolly to fit, destination guaranteed.
      const pts = path
        .slice(1)
        .map((pid) => nextView.nodeById.get(pid))
        .filter((n): n is NonNullable<typeof n> => n != null && n.x != null)
        .map((n) => [n.x!, n.y!, n.z!] as [number, number, number])
      const dest = nextView.nodeById.get(path[path.length - 1])
      if (dest && dest.x != null) {
        setFrameTarget({ points: pts, destination: [dest.x!, dest.y!, dest.z!] })
        setFrameSignal((f) => f + 1)
      }
      // Settle any pending tour `plot` op once the course has been applied.
      settleNext(plotDoneRef)
    })()
  }
  // Travel a plotted course: light its corridor and fly it (re-framing the ship
  // to its default stance + zoom for the journey). The plotted route stays set
  // so it remains highlighted for the whole flight — it clears on arrival
  // (handleArrive). The scanner drops out of course mode meanwhile (it keys off
  // `traveling`), so there's no stale Travel button mid-flight.
  const handleTravelCourse = () => {
    if (!view || traveling || plottedRoute.length < 2) return
    const path = plottedRoute
    setShownEdgeIds((prev) => new Set([...prev, ...pathEdgeIds(view, path)]))
    setFrameTarget(null)
    reframeForMove()
    setRoute(path.slice(1))
  }
  // Drop a plotted course (back to search) without travelling.
  const handleClearCourse = () => {
    setPlottedRoute([])
    setFrameTarget(null)
  }
  const handleSetEdgeVisible = (id: string, visible: boolean) => {
    setShownEdgeIds((s) => {
      const n = new Set(s)
      visible ? n.add(id) : n.delete(id)
      return n
    })
    setHiddenEdgeIds((h) => {
      const n = new Set(h)
      visible ? n.delete(id) : n.add(id)
      return n
    })
  }
  const handleArrive = () => {
    if (route.length === 0) return
    const arrived = route[0]
    setCurrentId(arrived)
    setRoute(route.slice(1))
    // Journey over: re-lock the camera and record the stop on the trail.
    if (route.length === 1) {
      setFollowing(true)
      // Travel complete — drop any plotted-course highlight now (it was kept lit
      // for the whole flight).
      setPlottedRoute([])
      // Forward → append; back to an earlier stop → rewind (truncate) to it.
      setTrail((t) => {
        const idx = t.indexOf(arrived)
        return idx >= 0 ? t.slice(0, idx + 1) : [...t, arrived]
      })
      // Defer the tour-travel settle until we've actually parked (route empties),
      // so it doesn't race the in-flight guards.
      revealPendingRef.current = arrived
    }
  }
  const handleFollow = () => {
    setFollowing(true)
    setFollowSignal((s) => s + 1)
  }

  // View swaps run *behind* the blast doors: close them, compute the next view
  // in parallel, and only apply it once the doors are FULLY shut (signaled by
  // BlastDoors' onClosed) — then reopen. This way the relayout/repark never
  // flashes through a half-open door. We wait for whichever finishes last: the
  // doors closing or the async compute.
  const pendingApply = useRef<(() => void) | null>(null)
  const doorsShutRef = useRef(false)
  const finishBehindDoors = () => {
    if (!doorsShutRef.current || !pendingApply.current) return
    const apply = pendingApply.current
    pendingApply.current = null
    doorsShutRef.current = false
    apply() // swap the view (+ related state) while fully covered
    setDoorsClosed(false) // reveal the settled scene
    // A tour op routed through the doors (expand/collapse/land/restore) resolves
    // here, after its view has been applied and the doors reopen.
    settleNext(opDoneRef)
  }
  const handleDoorsClosed = () => {
    doorsShutRef.current = true
    finishBehindDoors()
  }
  // prepare(s, view) computes the next view and returns the state mutation to
  // run once the doors are shut.
  const behindDoors = (prepare: (s: GraphSource, v: View) => Promise<() => void>) => {
    const s = sourceRef.current
    if (!s || !view || traveling) return
    pendingApply.current = null
    // If the doors are already shut (e.g. held manually), we're ready now;
    // otherwise wait for the close transition to report in.
    doorsShutRef.current = doorsClosed
    if (!doorsClosed) setDoorsClosed(true)
    // Never leave the doors stuck shut: if the compute errors or stalls, apply a
    // no-op and reopen so the scene comes back (and log why).
    let done = false
    const settle = (apply: () => void) => {
      if (done) return
      done = true
      clearTimeout(timer)
      pendingApply.current = apply
      finishBehindDoors()
    }
    const timer = setTimeout(() => {
      notify('Timed out updating the view — try again.', 'error')
      doorsShutRef.current = true
      settle(() => {})
    }, 8000)
    ;(async () => {
      try {
        settle(await prepare(s, view))
      } catch (err) {
        notify(`Couldn't update the view: ${err instanceof Error ? err.message : String(err)}`, 'error')
        doorsShutRef.current = true
        settle(() => {})
      }
    })()
  }

  // Expand/collapse: incremental relayout pins placed nodes so only the change
  // settles.
  const reView = (next: (s: GraphSource, v: View) => Promise<View>) =>
    behindDoors(async (s, v) => {
      const nv = await next(s, v)
      runForceLayout(nv, { pin: true, cluster: clusterForPinned(nv) })
      return () => setView(nv)
    })
  const handleExpand = (id: string, rule?: ExpandRule) => reView((s, v) => s.expand(v, id, rule))
  const handleCollapse = (id: string) =>
    reView((s, v) => s.collapse(v, id, currentId ?? v.anchorId))

  // Long-range scanner: text search across the whole source (not just the view).
  const handleSearch = useCallback(
    (q: string) => sourceRef.current?.search(q, 'text') ?? Promise.resolve([]),
    [],
  )
  // Re-anchor the ego-net on a node via a fresh entry (full relayout behind the
  // doors), resetting the journey + overrides. Returns a promise so the tour can
  // await the landing; used both by search-jump and by a tour's entry/land op.
  const resetTo = (entry: EntryMode) =>
    behindDoorsAsync(async (s) => {
      const nv = await s.entry(entry)
      runForceLayout(nv, { cluster: clusterFor(nv) })
      return () => {
        setView(nv)
        setCurrentId(nv.anchorId)
        setTrail([nv.anchorId])
        setSelectedId(null)
        setRoute([])
        clearEdges()
        setShownEdgeIds(new Set())
        setHiddenEdgeIds(new Set())
      }
    })
  // Land on a search hit (suppressed while a tour drives the view).
  const handleJump = (id: string) => {
    if (tourActiveRef.current) return
    resetTo({ mode: 'node', id })
  }

  // Switch the active "universe" (data source) at runtime (Plan G4). Build the
  // new source off-screen, then commit the swap + full journey reset ONLY once
  // the blast doors are fully shut — reusing the same pendingApply/
  // finishBehindDoors gate every view swap uses, so the new layout never starts
  // showing through a half-open door. The choice is persisted (survives reload).
  const switchUniverse = async (choice: SourceChoice) => {
    if (traveling || tourActiveRef.current) return
    // A local folder can't survive reload, so persist a fallback to the default.
    saveSourceChoice(choice.kind === 'bundle-local' ? { kind: 'bundle' } : choice)
    setSourceChoice(choice)
    // Begin closing the doors; compute the new universe in parallel.
    pendingApply.current = null
    doorsShutRef.current = doorsClosed
    if (!doorsClosed) setDoorsClosed(true)

    let built: BuiltSource | null = null
    try {
      built = await buildSource(choice)
    } catch (err) {
      console.warn('universe switch failed:', err)
    }
    if (!built) {
      notify("Couldn't load that universe; keeping the current one.", 'error')
      doorsShutRef.current = false
      setDoorsClosed(false)
      return
    }

    const { source, atlas, view: nv, actualKind, store } = built
    runForceLayout(nv, { cluster: clusterFor(nv) }) // off-screen: nv isn't rendered until apply() runs
    pendingApply.current = () => {
      sourceRef.current = source
      atlasRef.current = atlas
      bundleStoreRef.current = store
      setTours(atlas?.tours ?? [])
      setView(nv)
      setCurrentId(nv.anchorId)
      setTrail([nv.anchorId])
      setSelectedId(null)
      setRoute([])
      clearEdges()
      setShownEdgeIds(new Set())
      setHiddenEdgeIds(new Set())
      setPlottedRoute([])
      setFollowing(true)
      if (choice.kind === 'api' && actualKind === 'bundle') {
        notify('Backend unreachable — loaded the bundled demo instead.', 'error')
      }
    }
    // Apply now if the doors are already shut; otherwise finishBehindDoors fires
    // when BlastDoors reports fully closed.
    finishBehindDoors()
  }

  // Load + validate a USER-supplied bundle directory (hosted URL or local
  // folder) before switching to it, so a directory with a bad/missing file
  // reports clearly instead of silently falling back. Shipped demos and the live
  // backend skip this (trusted / validated by connecting).
  const loadUserBundle = async (store: BundleStore, choice: SourceChoice) => {
    const v = await validateBundle(store)
    if (!v.ok) {
      notify(`Bundle "${store.label}" is invalid: ${v.errors.join('; ')}`, 'error')
      return
    }
    if (v.warnings.length) notify(`Bundle "${store.label}": ${v.warnings.join('; ')}`, 'error')
    if (choice.kind === 'bundle-local') localBundleStore = store
    switchUniverse(choice)
  }
  const handleLoadBundleUrl = (url: string) => {
    const dir = url.trim()
    if (dir) loadUserBundle(urlBundleStore(dir), { kind: 'bundle', dir })
  }
  const handlePickLocalBundle = async () => {
    const store = await pickLocalBundle()
    if (store) loadUserBundle(store, { kind: 'bundle-local' })
  }

  // Re-spatialize the current view for a nebula grouping change (Plan H). Two
  // paths per the user's choice:
  //   • watch reform ON  — tick the simulation over animation frames with the
  //     doors OPEN so the universe visibly reforms; the viewpoint node is pinned
  //     so the camera holds steady while everything reorganizes around it.
  //   • watch reform OFF — relayout hidden behind the (fully-closed) blast doors,
  //     same as every other view swap.
  // Watch-reform: the simulation is ticked INSIDE the R3F render loop (the
  // LayoutReform scene node) while the scene drives node/edge transforms
  // imperatively (the `live` flag), so the whole animation stays in phase with
  // the camera and doesn't bounce. App just hands over the sim and cleans up
  // when LayoutReform reports the run is done. The current node is NOT pinned —
  // it migrates to its cluster and the egocentric camera holds it centred.
  const REFORM_STEPS = 28
  const [reformSim, setReformSim] = useState<ReturnType<typeof buildSimulation> | null>(null)
  const [liveLayout, setLiveLayout] = useState(false)
  const reformViewRef = useRef<View | null>(null)
  const onReformDone = () => {
    reformSim?.stop()
    const v = reformViewRef.current
    if (v) {
      unpinAll(v)
      setView({ ...v }) // sync React props to the settled positions
    }
    reformViewRef.current = null
    setReformSim(null)
    setLiveLayout(false)
    // Settle a pending tour `nebula` op (post-commit) now the reform has landed.
    const done = reformDoneRef.current
    reformDoneRef.current = null
    if (done) requestAnimationFrame(() => requestAnimationFrame(done))
  }

  const restageNebula = (on: boolean, gs: number, spacing: number, isolate = nebulaIsolate) => {
    if (!view || traveling || tourActiveRef.current) return
    let cluster: ClusterSpec | undefined
    if (on) {
      cluster = buildClusterSpec(view, { ...activeLegend().nebula, enabled: true, groupStrength: gs }, gs, spacing) ?? undefined
      if (cluster) cluster.isolate = isolate // match the demo's field isolation
    }
    if (watchReform) {
      reformSim?.stop() // abandon any in-flight reform
      reformViewRef.current = view
      setReformSim(buildSimulation(view, { cluster }))
      setLiveLayout(true)
    } else {
      behindDoors(async (_s, v) => {
        runForceLayout(v, { cluster })
        return () => setView({ ...v })
      })
    }
  }

  const handleToggleNebula = () => {
    const on = !nebulaOn
    setNebulaOn(on)
    restageNebula(on, groupStrength, nebulaSpacing)
  }
  const handleGroupStrength = (gs: number) => {
    setGroupStrength(gs)
    if (nebulaOn) restageNebula(true, gs, nebulaSpacing)
  }
  const handleNebulaSpacing = (spacing: number) => {
    setNebulaSpacing(spacing)
    if (nebulaOn) restageNebula(true, groupStrength, spacing)
  }
  // Toggle field isolation (drop cross-field edges from the sim) and re-stage
  // with the new value so the manual relayout matches what a tour produces.
  const handleToggleIsolate = () => {
    const next = !nebulaIsolate
    setNebulaIsolate(next)
    if (nebulaOn) restageNebula(true, groupStrength, nebulaSpacing, next)
  }
  // Collapse every nebula except the current node's — a one-shot ACTION (Plan
  // H2b), re-pressable. Folding is a pure visibility mask; no relayout.
  const handleFoldDistant = () => {
    if (!groupAssign) return
    const cur = currentId ? groupAssign.get(currentId) : null
    setFoldedGroups(new Set([...new Set(groupAssign.values())].filter((g) => g !== cur)))
  }
  // Fold / unfold a single nebula (from its inspector panel).
  const handleSetNebulaFolded = (key: string, folded: boolean) =>
    setFoldedGroups((s) => {
      const next = new Set(s)
      if (folded) next.add(key)
      else next.delete(key)
      return next
    })
  // Click a nebula body → lock focus (reticle + the rail inspector shows it).
  const handleSelectNebula = (key: string) => setFocusedNebula(key)
  const handleHoverNebula = (key: string | null) => setHoveredNebula(key)
  // What the nebula groups by, for the console label (e.g. "field", "community").
  const nebulaLens = activeLegend().nebula
  const nebulaLabel = nebulaLens.basis === 'property' ? (nebulaLens.key ?? 'property') : nebulaLens.basis

  // ── Tour playback ──────────────────────────────────────────────────────────
  // Promise wrappers around the existing async primitives so the tour engine can
  // await each op. They resolve via the resolver refs (settleNext), on a
  // post-commit frame, so a step's snapshot reads the applied state.
  const nextFrame = () =>
    new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )
  const behindDoorsAsync = (prepare: (s: GraphSource, v: View) => Promise<() => void>) =>
    new Promise<void>((resolve) => {
      // Mirror behindDoors' own guards: if it can't run, don't hang the tour.
      if (!sourceRef.current || !view || traveling) {
        resolve()
        return
      }
      opDoneRef.current = resolve
      behindDoors(prepare)
    })
  // Landing: just park on the arrived node. No blast doors, no view rebuild, no
  // auto-expansion — the ship flies in and parks, keeping the view as it is.
  // Once parked (route empty), settle any pending tour travelTo so the next step
  // sees the settled destination.
  useEffect(() => {
    if (traveling) return
    const id = revealPendingRef.current
    if (!id) return
    revealPendingRef.current = null
    settleNext(travelDoneRef)
  }, [traveling]) // eslint-disable-line react-hooks/exhaustive-deps

  const travelTo = (id: string) =>
    new Promise<void>((resolve) => {
      if (!view || !currentId || id === currentId) {
        resolve()
        return
      }
      travelDoneRef.current = resolve
      handleTravelCore(id)
    })
  // Plot a course (reveal + highlight + frame, no travel); resolves once applied.
  const plotCourseTo = (id: string) =>
    new Promise<void>((resolve) => {
      if (!view || !currentId || traveling || id === currentId) {
        resolve()
        return
      }
      plotDoneRef.current = resolve
      handlePlotCourse(id)
    })
  // Fly the currently-plotted course; resolves on arrival (via the parked settle).
  const travelCourse = () =>
    new Promise<void>((resolve) => {
      if (!view || plottedRoute.length < 2) {
        resolve()
        return
      }
      travelDoneRef.current = resolve
      handleTravelCourse()
    })

  // Apply one tour step op to the working view. Each branch maps onto the same
  // GraphSource call manual navigation uses (`look` is camera/edge-only).
  // Re-lock the course and snap the orbit/gaze back to default — only for ops
  // that MOVE the ship (travel/land). Parked ops (filter/expand/look) preserve
  // the current view, so a step like the recap doesn't yank the camera around.
  // keepZoom: preserve the current dolly distance (manual travel) rather than
  // resetting to default (scripted moves / plotted-course travel).
  const reframeForMove = (keepZoom = false) => {
    setFollowing(true)
    setRecenterKeepZoom(keepZoom)
    setRecenterSignal((r) => r + 1)
  }
  const runOp = (op: TourOp): Promise<void> => {
    switch (op.kind) {
      case 'land':
        reframeForMove()
        return resetTo({ mode: 'node', id: op.id, maxNodes: op.maxNodes })
      case 'inspect': {
        // Open the details panel on the node (the ship doesn't move). The rail
        // renders it read-only while the tour drives the view. `focus` also
        // turns + zooms the camera to frame the ship→node segment.
        setSelectedId(op.id)
        clearEdges()
        if (op.focus && view && currentId) {
          const tn = view.nodeById.get(op.id)
          const cn = view.nodeById.get(currentId)
          if (tn?.x != null && cn?.x != null) {
            // Turn to face the node but DON'T zoom (keep the plotted-route framing).
            setFrameTarget({
              points: [
                [cn.x!, cn.y!, cn.z!],
                [tn.x!, tn.y!, tn.z!],
              ],
              destination: [tn.x!, tn.y!, tn.z!],
              zoom: false,
            })
            setFrameSignal((f) => f + 1)
          }
        }
        return nextFrame()
      }
      case 'plot':
        return plotCourseTo(op.to)
      case 'travelCourse': {
        // Capture the destination before flying — plottedRoute clears on arrival.
        const dest = plottedRoute[plottedRoute.length - 1]
        return travelCourse().then(() => {
          if (op.inspect && dest) {
            setSelectedId(dest)
            clearEdges()
            return nextFrame()
          }
        })
      }
      case 'filter':
        setPredicate(op.predicate)
        return nextFrame()
      case 'expand':
        return behindDoorsAsync(async (s, v) => {
          const nv = await s.expand(v, op.nodeId, op.rule)
          runForceLayout(nv, { pin: true, cluster: clusterForPinned(nv) })
          return () => {
            setView(nv)
            // Turn (instantly, behind the doors) to look down the conduit to the
            // revealed node — aim at the midpoint so the current node (near) and
            // the wormhole both read when the doors open, without centring the
            // far node. Doors then open already viewing the connection.
            if (op.face) {
              const fn = nv.nodeById.get(op.face)
              const cn = currentId ? nv.nodeById.get(currentId) : null
              if (fn?.x != null && cn?.x != null) {
                const mid: [number, number, number] = [
                  (cn.x! + fn.x!) / 2,
                  (cn.y! + fn.y!) / 2,
                  (cn.z! + fn.z!) / 2,
                ]
                setFrameTarget({ points: [mid], destination: mid, zoom: false, instant: true })
                setFrameSignal((f) => f + 1)
              }
            }
          }
        })
      case 'collapse':
        return behindDoorsAsync(async (s, v) => {
          const nv = await s.collapse(v, op.nodeId, op.fromId)
          runForceLayout(nv, { pin: true, cluster: clusterForPinned(nv) })
          return () => setView(nv)
        })
      case 'nebula': {
        // Turn the field grouping on/off. Drives the same machinery the manual
        // console toggle uses, but reusable from a tour (restageNebula itself
        // no-ops while a tour is active, so we run the regroup here directly).
        setNebulaOn(op.on)
        // Optional per-tour overrides for grouping tightness + galaxy spacing.
        // Commit them to state so later steps' relayouts (plot/travel via
        // clusterFor) use the same values, and use them locally for this regroup.
        const gs = op.strength ?? groupStrength
        const spacing = op.spread ?? nebulaSpacing
        if (op.strength != null) setGroupStrength(op.strength)
        if (op.spread != null) setNebulaSpacing(op.spread)
        if (op.coverage != null) setNebulaCoverage(op.coverage)
        if (op.isolate != null) setNebulaIsolate(op.isolate)
        const isolate = op.isolate ?? nebulaIsolate
        const lens = { ...activeLegend().nebula, enabled: true, groupStrength: gs }
        // Build a cluster spec for this op's regroup, carrying the isolate flag.
        const clusterOf = (v: View) => {
          const spec = buildClusterSpec(v, lens, gs, spacing)
          if (spec) spec.isolate = isolate
          return spec ?? undefined
        }
        // After grouping, optionally fold every nebula except the one we're in:
        // distant fields collapse to clouds (members hidden), their connections
        // surviving as fading stub beams. Applied once the regroup has settled.
        const applyFold = () => {
          if (op.on && op.fold === 'distant' && view && currentId) {
            const ga = assignGroups(view, lens)
            if (ga) {
              const cur = ga.get(currentId)
              setFoldedGroups(new Set([...new Set(ga.values())].filter((g) => g !== cur)))
            }
          } else if (!op.on) {
            setFoldedGroups(new Set()) // turning grouping off clears any folds
          }
        }
        if (op.on && (op.watch ?? true) && view) {
          // Animated reveal: regroup with the simulation visible (doors open),
          // resolving the step once LayoutReform reports it has settled.
          const cluster = clusterOf(view)
          return new Promise<void>((resolve) => {
            let settled = false
            const finish = () => {
              if (settled) return
              settled = true
              applyFold()
              resolve()
            }
            reformDoneRef.current = finish
            reformSim?.stop()
            reformViewRef.current = view
            setReformSim(buildSimulation(view, { cluster }))
            setLiveLayout(true)
            setTimeout(finish, 5000) // safety: never hang the tour on a stalled reform
          })
        }
        // Snap (no animation) or turning grouping off: relayout behind the doors.
        return behindDoorsAsync(async (_s, v) => {
          const cluster = op.on ? clusterOf(v) : undefined
          runForceLayout(v, { cluster })
          return () => {
            setView({ ...v })
            applyFold()
          }
        })
      }
      case 'travel':
        reframeForMove()
        if (op.collapseOffPath) setAutoCollapse(true)
        return travelTo(op.to).then(() => {
          // Arrived — open the destination's details (we're now parked on it).
          if (op.inspect) {
            setSelectedId(op.to)
            clearEdges()
            return nextFrame()
          }
        })
      case 'look': {
        if (op.edge && view) {
          const e = (view.incident.get(op.edge.from) ?? []).find(
            (ed) =>
              (ed.source === op.edge!.from && ed.target === op.edge!.to) ||
              (ed.source === op.edge!.to && ed.target === op.edge!.from),
          )
          if (e) setShownEdgeIds((s) => new Set(s).add(e.id))
        }
        // Turn the gaze (animated, no zoom) toward `focus` — e.g. a recap "look
        // back" toward the node we came from across the wormhole.
        if (op.focus && view && currentId) {
          const fn = view.nodeById.get(op.focus)
          if (fn?.x != null) {
            setFrameTarget({
              points: [[fn.x!, fn.y!, fn.z!]],
              destination: [fn.x!, fn.y!, fn.z!],
              zoom: false,
            })
            setFrameSignal((f) => f + 1)
          }
        }
        return nextFrame()
      }
      default:
        return Promise.resolve()
    }
  }

  // Full exploration state at a step boundary. Snapshotting view references is
  // safe: pinned relayouts never move already-placed nodes, so an earlier view
  // still renders correctly when restored. Read from a render-body ref so the
  // capture reflects the latest committed state (see snapStateRef below).
  const snapshot = (): unknown => ({ ...snapStateRef.current })
  const restore = (raw: unknown) => {
    const snap = raw as SnapState
    return behindDoorsAsync(async () => () => {
      setView(snap.view)
      setCurrentId(snap.currentId)
      setTrail(snap.trail)
      setRoute([])
      setSelectedId(snap.selectedId)
      setPredicate(snap.predicate)
      setAutoCollapse(snap.autoCollapse)
      setShownEdgeIds(snap.shownEdgeIds)
      setHiddenEdgeIds(snap.hiddenEdgeIds)
      setShowEdges(snap.showEdges)
      setShowWormholes(snap.showWormholes)
      setPlottedRoute(snap.plottedRoute ?? [])
      clearEdges()
    })
  }
  const tourExec: TourExecutor = { reset: resetTo, runOp, snapshot, restore }
  const tour = useTour(tourExec)
  tourActiveRef.current = tour.tour !== null

  // Start a tour: read its definition from the active universe's bundle store
  // (so a tour ships inside its demo directory), resolve its `@anchor` references
  // against the Atlas anchors, then hand it to the engine.
  const handleStartTour = (file: string) => {
    const store = bundleStoreRef.current ?? urlBundleStore('')
    Promise.resolve(store.readJSON(file))
      .then((t) => tour.start(resolveTourAnchors(t as Tour, atlasRef.current?.anchors)))
      .catch((err) =>
        notify(`Couldn't load tour: ${err instanceof Error ? err.message : String(err)}`, 'error'),
      )
  }

  // Dev-only handle for the headless smoke test (scripts/smoke.mjs).
  useEffect(() => {
    if (import.meta.env.DEV) {
      ;(window as any).__nodefarer = {
        travelTo: handleTravel,
        expand: handleExpand,
        collapse: handleCollapse,
        currentId,
        ready: !!view,
        doors: { close: () => setDoorsClosed(true), open: () => setDoorsClosed(false) },
      }
    }
  })

  // The rendered scene = the laid-out view masked by the edge budget + per-edge
  // overrides. Pure filter; recomputed only when those inputs change.
  const display = useMemo(() => {
    if (!view) return null
    const specials = new Set<string>()
    if (currentId) specials.add(currentId)
    if (selectedId) specials.add(selectedId)
    for (const id of route) specials.add(id)
    for (const id of plottedRoute) specials.add(id)
    // The active travel lane: edges between consecutive nodes of [current, …route],
    // plus a plotted-but-not-yet-travelled course. These ignore the per-kind
    // toggle and the budget clip so the course is visible (in flight or plotted).
    const lane = new Set<string>()
    const addLane = (path: string[]) => {
      for (let i = 0; i < path.length - 1; i++) {
        const e = (view.incident.get(path[i]) ?? []).find(
          (ed) => ed.source === path[i + 1] || ed.target === path[i + 1],
        )
        if (e) lane.add(e.id)
      }
    }
    if (currentId && route.length) addLane([currentId, ...route])
    if (plottedRoute.length > 1) addLane(plottedRoute)
    // Bound the view first (reversible mask; current/selected always kept), then
    // declutter what survives.
    const has = (o?: Record<string, unknown>) => o != null && Object.keys(o).length > 0
    const active =
      predicate.nodeTypes != null ||
      predicate.relTypes != null ||
      has(predicate.num) ||
      has(predicate.cat) ||
      has(predicate.edgeNum) ||
      has(predicate.edgeCat)
    const keep = new Set([currentId, selectedId].filter(Boolean) as string[])
    // The active travel course — and any plotted course — are always kept through
    // the filter, so a hop's destination (and its lit lane) never vanishes under
    // a bound mid-flight or while a course sits plotted.
    for (const id of route) keep.add(id)
    for (const id of plottedRoute) keep.add(id)
    let base = active ? filterView(view, predicate, keep) : view
    // Fold off-corridor branches once parked (never mid-flight, so nothing
    // vanishes under the ship while travelling).
    if (autoCollapse && !traveling && currentId) {
      base = corridorView(base, trail, currentId, keep)
    }
    return budgetView(base, edgeBudget, shownEdgeIds, hiddenEdgeIds, specials, edgeSort, {
      edges: showEdges,
      wormholes: showWormholes,
    }, lane)
  }, [view, edgeBudget, edgeSort, shownEdgeIds, hiddenEdgeIds, showEdges, showWormholes, predicate, autoCollapse, traveling, trail, currentId, selectedId, route, plottedRoute])

  // Group assignment over the FULL view (with propagation), shared by the nebula
  // bodies and the fold mask (Plan H2/H2b). Null when nebulae are off. Declared
  // before the early return so the hook order is stable.
  const groupAssign = useMemo(() => {
    if (!nebulaOn || !view) return null
    return assignGroups(view, { ...activeLegend().nebula, enabled: true, groupStrength })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nebulaOn, groupStrength, view])
  // Latest assignment for the arrival effect (which keys only off currentId).
  const groupAssignRef = useRef(groupAssign)
  groupAssignRef.current = groupAssign

  // Volumetric nebula bodies for the scene (Plan H2): each group's centre +
  // radius from the laid-out positions. Computed over the FULL view so a folded
  // group (members hidden from the scene) still has a body. Empty when off.
  const nebulae = useMemo<NebulaBody[]>(() => {
    if (!nebulaOn || !view || !groupAssign) return []
    const palette = activeLegend().colors.communityPalette
    const groups = new Map<string, GraphNode[]>()
    for (const n of view.nodes) {
      const k = groupAssign.get(n.id)
      if (k == null) continue
      const arr = groups.get(k)
      if (arr) arr.push(n)
      else groups.set(k, [n])
    }
    const bodies: NebulaBody[] = []
    for (const [key, members] of groups) {
      let cx = 0,
        cy = 0,
        cz = 0,
        m = 0
      for (const n of members) {
        if (n.x == null || n.y == null || n.z == null) continue
        cx += n.x
        cy += n.y
        cz += n.z
        m++
      }
      if (m < 2) continue
      cx /= m
      cy /= m
      cz /= m
      // Robust radius: the ~85th percentile of member distances, NOT the max — a
      // single stray member (e.g. pulled out by a cross-field link) would
      // otherwise balloon the cloud and make similar-sized clusters look wildly
      // different in size.
      const dists: number[] = []
      for (const n of members) {
        if (n.x == null || n.y == null || n.z == null) continue
        dists.push(Math.hypot(n.x - cx, n.y - cy, n.z - cz))
      }
      dists.sort((a, b) => a - b)
      const r = dists[Math.min(dists.length - 1, Math.floor((dists.length - 1) * nebulaCoverage))] ?? 0
      bodies.push({ key, label: key, color: groupColor(key, palette), center: [cx, cy, cz], radius: r + 18, count: m, folded: false, focused: false, hovered: false })
    }
    return bodies
    // activeLegend() reads atlasRef (stable across a session); `view`/groupAssign
    // change ref on every relayout, which is what should retrigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nebulaOn, groupStrength, nebulaCoverage, view, groupAssign])

  // Arriving in a nebula blooms it open (remove from folded) and refocuses the
  // inspector on it (Plan H2b hero beat).
  useEffect(() => {
    const g = groupAssignRef.current?.get(currentId ?? '')
    if (g != null) setFoldedGroups((s) => (s.has(g) ? new Set([...s].filter((k) => k !== g)) : s))
    setFocusedNebula(null)
  }, [currentId])

  // The nebula shown in the rail inspector (Plan H2b): the focused/locked one, or
  // the current node's by default. Members + metadata over the full view.
  const inspectedNebulaInfo = useMemo<NebulaInfo | null>(() => {
    if (!nebulaOn || !view || !groupAssign) return null
    const key = focusedNebula ?? (currentId ? groupAssign.get(currentId) ?? null : null)
    if (key == null) return null
    const members = view.nodes.filter((n) => groupAssign.get(n.id) === key)
    if (!members.length) return null
    const byType: Record<string, number> = {}
    let yMin = Infinity
    let yMax = -Infinity
    for (const n of members) {
      byType[n.type] = (byType[n.type] ?? 0) + 1
      const y = n.properties['Year']
      if (typeof y === 'number') {
        yMin = Math.min(yMin, y)
        yMax = Math.max(yMax, y)
      }
    }
    const top = [...members]
      .filter((n) => n.pagerank != null)
      .sort((a, b) => (b.pagerank ?? 0) - (a.pagerank ?? 0))
      .slice(0, 6)
      .map((n) => ({ id: n.id, name: n.name }))
    return {
      key,
      count: members.length,
      byType,
      yearRange: yMin <= yMax ? ([yMin, yMax] as [number, number]) : null,
      top,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nebulaOn, view, groupAssign, focusedNebula, currentId])

  if (!view || !currentId || !display) {
    return (
      <Box sx={{ position: 'fixed', inset: 0, bgcolor: '#02030a', display: 'grid', placeItems: 'center' }}>
        <Stack spacing={2} alignItems="center">
          <CircularProgress size={28} sx={{ color: '#7fd4ff' }} />
          <Typography sx={{ color: '#7fd4ff', font: '11px/1.6 ui-monospace, Menlo, monospace', letterSpacing: 2 }}>
            CHARTING UNIVERSE…
          </Typography>
        </Stack>
      </Box>
    )
  }

  const currentNode = view.nodeById.get(currentId)!
  const selectedNode = selectedId ? view.nodeById.get(selectedId) ?? null : null
  const nextHopNode = traveling ? view.nodeById.get(route[0]) ?? null : null
  const destinationNode = traveling ? view.nodeById.get(route[route.length - 1]) ?? null : null
  // The nebula the rail inspector reflects: the focused/locked one, else the
  // current node's (Plan H2b). Folding is a pure visibility mask (no relayout).
  const currentGroup = groupAssign?.get(currentId) ?? null
  const inspectedNebula = focusedNebula ?? currentGroup
  // displayGraph = the decluttered (and fold-masked) scene the viewport renders;
  // the HUD/panel still get the full `view` so the Links list shows every edge.
  // Nodes on a plotted course (or the active flight) punch THROUGH a folded
  // nebula: the bulk of the field stays hidden, but the specific lineage we trace
  // lights up across it — so "reaching back" reveals the path, not the whole field.
  const displayGraph =
    foldedGroups.size && groupAssign
      ? maskFoldedGroups(
          display.display,
          groupAssign,
          foldedGroups,
          new Set(
            [currentId, selectedId, ...plottedRoute, ...route].filter(Boolean) as string[],
          ),
        )
      : display.display
  // Tag each body with its fold/focus/hover state for the scene. The nebula we
  // are INSIDE is never drawn as a cloud — its haze just fogs the foreground and
  // is hard to read from within; we render its member nodes, not a body.
  const sceneNebulae = nebulae
    .filter((b) => b.key !== currentGroup)
    .map((b) => ({
      ...b,
      folded: foldedGroups.has(b.key),
      focused: b.key === inspectedNebula,
      hovered: b.key === hoveredNebula,
    }))
  // Faint beams from visible nodes into FOLDED nebulae: the connection exists but
  // its members are hidden, so the edge dissolves into the cloud's surface (built
  // from the full view, since the masked displayGraph has dropped those edges).
  const nebulaStubs: NebulaStub[] =
    nebulaOn && groupAssign && foldedGroups.size
      ? (() => {
          const bodyByKey = new Map(nebulae.map((b) => [b.key, b]))
          const keep = new Set([currentId, selectedId].filter(Boolean) as string[])
          const hiddenById = (id: string) => {
            const g = groupAssign.get(id)
            return g != null && foldedGroups.has(g) && !keep.has(id)
          }
          const seen = new Set<string>()
          const out: NebulaStub[] = []
          for (const e of view.edges) {
            const sH = hiddenById(e.source)
            const tH = hiddenById(e.target)
            if (sH === tH) continue // both hidden or both visible — no stub
            const visId = sH ? e.target : e.source
            const hidId = sH ? e.source : e.target
            // The visible end must actually be on screen (survive the budget mask).
            if (!displayGraph.nodeById.has(visId)) continue
            const g = groupAssign.get(hidId)!
            const body = bodyByKey.get(g)
            const vn = view.nodeById.get(visId)
            if (!body || !vn || vn.x == null) continue
            const key = `${visId}->${g}`
            if (seen.has(key)) continue
            seen.add(key)
            out.push({
              id: key,
              from: [vn.x, vn.y!, vn.z!],
              fromType: vn.type,
              center: body.center,
              radius: body.radius,
              color: body.color,
            })
          }
          return out
        })()
      : []
  const visibleEdgeIds = display.visibleEdgeIds

  // The plotted course as a "route" emphasis — its nodes + connecting edges,
  // rendered with a distinct route skin (see scene/RouteHighlight).
  const routeEmphasis =
    plottedRoute.length > 1
      ? { kind: 'route' as const, nodeIds: plottedRoute, edgeIds: [...pathEdgeIds(view, plottedRoute)] }
      : null

  // The inspected nebula's VISIBLE members highlighted in place (Plan H3) — the
  // cheap "mark this field" overlay, tinted with the nebula skin. Only when the
  // user toggles it on; folded members aren't visible so can't be lit.
  const nebulaEmphasis =
    highlightNebula && inspectedNebula && groupAssign
      ? (() => {
          const ids = new Set(
            displayGraph.nodes.filter((n) => groupAssign.get(n.id) === inspectedNebula).map((n) => n.id),
          )
          if (!ids.size) return null
          const edgeIds = displayGraph.edges
            .filter((e) => ids.has(e.source) && ids.has(e.target))
            .map((e) => e.id)
          return { kind: 'nebula' as const, nodeIds: [...ids], edgeIds }
        })()
      : null
  // Nebula first, route last → the route wins on any shared member.
  const emphases = [nebulaEmphasis, routeEmphasis].filter((e): e is Emphasis => e != null)

  // Locks stay live in flight, with the destination always held; parked,
  // the inspected node keeps its reticle even when it falls outside the
  // mode's own pick. Adjacent mode is computed here (it's static per node);
  // proximity comes from TagSelector's per-frame scan.
  const pinnedId = traveling
    ? destinationNode && destinationNode.id !== currentId
      ? destinationNode.id
      : null
    : selectedId && selectedId !== currentId
      ? selectedId
      : null
  const baseTaggedIds = viewMode === 'adjacent' ? (view.neighbors.get(currentId) ?? []) : taggedIds
  // No reticle locks while the doors are shut — there's nothing on the glass.
  // The current node never gets a reticle: the ship is parked on it.
  const displayTaggedIds = (
    doorsClosed
      ? []
      : pinnedId && !baseTaggedIds.includes(pinnedId)
        ? [...baseTaggedIds, pinnedId]
        : baseTaggedIds
  ).filter((id) => id !== currentId && displayGraph.nodeById.has(id))

  return (
    <Box
      sx={{
        position: 'fixed',
        inset: 0,
        bgcolor: '#02030a',
        // The canvas owns all touch gestures — otherwise Safari hijacks a
        // finger-drag into a page scroll/pinch after a few pixels and our
        // look-around handler stops getting pointer moves. touch-action does
        // not inherit, so it must land on the <canvas> element itself.
        touchAction: 'none',
        '& canvas': { touchAction: 'none' },
      }}
    >
      <Canvas
        flat
        camera={{ fov: 60, near: 0.1, far: 4000 }}
        onPointerMissed={(e) => {
          // Orbit gestures start on empty space — mouse right / Shift+left, or
          // any touch (which may become a two-finger orbit). Those must NOT
          // clear the selection; only a plain left-click on the void does.
          if (e.button !== 0 || e.shiftKey || (e as PointerEvent).pointerType === 'touch') return
          setSelectedId(null)
          clearEdges()
        }}
      >
        <GraphScene
          graph={displayGraph}
          currentNode={currentNode}
          targetNode={nextHopNode}
          selectedId={selectedId}
          taggedIds={displayTaggedIds}
          pinnedEdgeIds={doorsClosed ? [] : pinnedEdgeIds}
          hoveredEdgeId={doorsClosed ? null : hoveredEdgeId}
          maxTags={maxTags}
          selectionPaused={viewMode !== 'proximity' || doorsClosed}
          emphases={emphases}
          nebulae={doorsClosed || liveLayout ? [] : sceneNebulae}
          nebulaStubs={doorsClosed || liveLayout ? [] : nebulaStubs}
          spotlightPath={plottedRoute.length > 1}
          onSelectNebula={handleSelectNebula}
          onHoverNebula={handleHoverNebula}
          liveLayout={liveLayout}
          reformSim={reformSim}
          reformSteps={REFORM_STEPS}
          onReformDone={onReformDone}
          following={following}
          followSignal={followSignal}
          recenterSignal={recenterSignal}
          recenterKeepZoom={recenterKeepZoom}
          frameSignal={frameSignal}
          frameTarget={frameTarget}
          onUnlock={() => setFollowing(false)}
          onTaggedChange={setTaggedIds}
          onSelect={handleSelect}
          onTravel={handleTravel}
          onArrive={handleArrive}
        />
      </Canvas>
      <Hud
        graph={view}
        currentNode={currentNode}
        selectedNode={selectedNode}
        destination={destinationNode}
        hopsLeft={route.length}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        maxTags={maxTags}
        onMaxTagsChange={setMaxTags}
        edgeBudget={edgeBudget}
        onEdgeBudgetChange={setEdgeBudget}
        edgeSort={edgeSort}
        onEdgeSortChange={setEdgeSort}
        showEdges={showEdges}
        onToggleEdges={() => setShowEdges((v) => !v)}
        showWormholes={showWormholes}
        onToggleWormholes={() => setShowWormholes((v) => !v)}
        autoCollapse={autoCollapse}
        onToggleAutoCollapse={() => setAutoCollapse((v) => !v)}
        schema={schema}
        predicate={predicate}
        onPredicateChange={setPredicate}
        trail={trail}
        following={following}
        onFollow={handleFollow}
        doorsClosed={doorsClosed}
        onToggleDoors={() => setDoorsClosed(!doorsClosed)}
        onDoorsClosed={handleDoorsClosed}
        pinnedEdgeIds={pinnedEdgeIds}
        visibleEdgeIds={visibleEdgeIds}
        onTogglePin={handleTogglePin}
        onHoverEdge={setHoveredEdgeId}
        onSetEdgeVisible={handleSetEdgeVisible}
        onSelect={handleSelect}
        onTravel={handleTravel}
        onExpand={handleExpand}
        onCollapse={handleCollapse}
        onClosePanel={() => setSelectedId(null)}
        onSearch={handleSearch}
        onJump={handleJump}
        plottedRoute={plottedRoute}
        onPlotCourse={handlePlotCourse}
        onTravelCourse={handleTravelCourse}
        onClearCourse={handleClearCourse}
        tours={tours}
        onStartTour={handleStartTour}
        sourceChoice={sourceChoice}
        demos={demos}
        onSwitchUniverse={switchUniverse}
        onLoadBundleUrl={handleLoadBundleUrl}
        onPickLocalBundle={handlePickLocalBundle}
        nebulaOn={nebulaOn}
        nebulaLabel={nebulaLabel}
        groupStrength={groupStrength}
        nebulaSpacing={nebulaSpacing}
        watchReform={watchReform}
        nebulaIsolate={nebulaIsolate}
        onToggleNebula={handleToggleNebula}
        onGroupStrength={handleGroupStrength}
        onNebulaSpacing={handleNebulaSpacing}
        onToggleWatchReform={() => setWatchReform((w) => !w)}
        onToggleIsolate={handleToggleIsolate}
        onFoldDistant={handleFoldDistant}
        nebulaInfo={inspectedNebulaInfo}
        nebulaColor={inspectedNebula ? groupColor(inspectedNebula, activeLegend().colors.communityPalette) : '#9af7d0'}
        nebulaFolded={inspectedNebula ? foldedGroups.has(inspectedNebula) : false}
        nebulaIsCurrent={inspectedNebula != null && inspectedNebula === currentGroup}
        onSetNebulaFolded={handleSetNebulaFolded}
        focusedNebula={focusedNebula}
        nebulaHighlight={highlightNebula}
        onToggleNebulaHighlight={() => setHighlightNebula((v) => !v)}
        tourActive={tour.tour !== null}
      />
      <TourPanel
        step={tour.tour ? tour.tour.steps[tour.index] : null}
        index={tour.index}
        total={tour.tour?.steps.length ?? 0}
        busy={tour.busy}
        onNext={tour.next}
        onBack={tour.back}
        onQuit={tour.quit}
      />
      <MessageToast message={message} onDismiss={() => setMessage(null)} />
    </Box>
  )
}
