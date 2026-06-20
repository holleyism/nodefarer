import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, CircularProgress, Stack, Typography } from '@mui/material'
import type { ViewMode } from './types'
import { Canvas } from '@react-three/fiber'
import { syntheticBundle } from './data/generateGraph'
import { StaticBundleSource } from './data/StaticBundleSource'
import { ApiSource } from './data/ApiSource'
import { budgetView, corridorView, filterView } from './data/viewBuilder'
import type { EdgeSortKey } from './data/edgeSort'
import type { EntryMode, ExpandRule, GraphSource, Predicate, View } from './data/GraphSource'
import type { GraphSchema } from './data/graphSchema'
import type { Bundle } from './data/bundle'
import type { Tour, TourOp } from './data/tour'
import { shortestPath } from './data/shortestPath'
import { runForceLayout } from './layout/runForceLayout'
import { GraphScene } from './scene/GraphScene'
import { Hud } from './hud/Hud'
import { MessageToast, type AppMessage } from './hud/MessageToast'
import { TourPanel } from './hud/TourPanel'
import { useTour, type TourExecutor } from './hud/useTour'

const BUNDLE_URL = '/bundle.json'

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

  // Pick the data source and land on an entry view. VITE_API_URL → live
  // ApiSource (Go/Neo4j); otherwise the static bundle (served, else synthetic).
  // A failing API falls back to the bundle so dev never hard-hangs.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const apiUrl = import.meta.env.VITE_API_URL as string | undefined
      let source: GraphSource | null = null
      let v: View | null = null

      if (apiUrl) {
        try {
          const s = new ApiSource(apiUrl, import.meta.env.VITE_API_TOKEN as string | undefined)
          v = await s.entry({ mode: 'node' })
          source = s
        } catch (err) {
          console.warn('ApiSource unavailable, falling back to bundle:', err)
        }
      }

      if (!source) {
        let bundle: Bundle
        try {
          const res = await fetch(BUNDLE_URL)
          if (!res.ok) throw new Error(`bundle ${res.status}`)
          bundle = await res.json()
        } catch {
          bundle = syntheticBundle(7)
        }
        const s = new StaticBundleSource(bundle)
        v = await s.entry({ mode: 'node' })
        source = s
      }

      if (cancelled || !v) return
      runForceLayout(v)
      sourceRef.current = source
      setView(v)
      setCurrentId(v.anchorId)
      setTrail([v.anchorId])
    })()
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
        if (nextView.nodes.length > view.nodes.length) runForceLayout(nextView, { pin: true })
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
        if (nextView.nodes.length > view.nodes.length) runForceLayout(nextView, { pin: true })
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
      runForceLayout(nv, { pin: true })
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
      runForceLayout(nv)
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
      case 'travelCourse':
        return travelCourse()
      case 'filter':
        setPredicate(op.predicate)
        return nextFrame()
      case 'expand':
        return behindDoorsAsync(async (s, v) => {
          const nv = await s.expand(v, op.nodeId, op.rule)
          runForceLayout(nv, { pin: true })
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
          runForceLayout(nv, { pin: true })
          return () => setView(nv)
        })
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

  // Start a tour: fetch its definition, then hand it to the engine.
  const handleStartTour = (file: string) => {
    fetch(`/tours/${file}`)
      .then((r) => {
        if (!r.ok) throw new Error(`tour ${r.status}`)
        return r.json() as Promise<Tour>
      })
      .then((t) => tour.start(t))
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
  // displayGraph = the decluttered scene the viewport renders; the HUD/panel
  // still get the full `view` so the Links list shows every edge.
  const displayGraph = display.display
  const visibleEdgeIds = display.visibleEdgeIds
  // The plotted course as a "route" emphasis — its nodes + connecting edges,
  // rendered with a distinct route skin (see scene/RouteHighlight). A general
  // emphasis shape so neighbourhood "nebula" highlights can reuse it later.
  const routeEmphasis =
    plottedRoute.length > 1
      ? { kind: 'route' as const, nodeIds: plottedRoute, edgeIds: [...pathEdgeIds(view, plottedRoute)] }
      : null

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
          emphasis={routeEmphasis}
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
        onStartTour={handleStartTour}
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
