import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, CircularProgress, Stack, Typography } from '@mui/material'
import type { ViewMode } from './types'
import { Canvas } from '@react-three/fiber'
import { syntheticBundle } from './data/generateGraph'
import { StaticBundleSource } from './data/StaticBundleSource'
import { ApiSource } from './data/ApiSource'
import { budgetView, filterView } from './data/viewBuilder'
import type { EdgeSortKey } from './data/edgeSort'
import type { GraphSource, Predicate, View } from './data/GraphSource'
import type { GraphSchema } from './data/graphSchema'
import type { Bundle } from './data/bundle'
import { shortestPath } from './data/shortestPath'
import { runForceLayout } from './layout/runForceLayout'
import { GraphScene } from './scene/GraphScene'
import { Hud } from './hud/Hud'

const BUNDLE_URL = '/bundle.json'

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
  // Whether the camera is locked to the course while traveling. Dragging
  // mid-flight unlocks it; "follow course" (or journey's end) re-locks.
  const [following, setFollowing] = useState(true)
  const [followSignal, setFollowSignal] = useState(0)
  // Blast doors: shut the window while the universe is being (re)laid out.
  const [doorsClosed, setDoorsClosed] = useState(false)

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
    if (traveling) return
    setSelectedId(id)
    clearEdges()
  }
  const handleTogglePin = (id: string) =>
    setPinnedEdgeIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const handleTravel = (id: string) => {
    if (!view || !currentId || traveling || id === currentId) return
    setSelectedId(null)
    clearEdges()
    const path = shortestPath(view, currentId, id)
    // Force-show any budgeted-out edges along the route so the lane is visible
    // for the whole flight.
    if (path && path.length > 1) {
      const reveal = new Set(shownEdgeIds)
      for (let i = 0; i < path.length - 1; i++) {
        const e = (view.incident.get(path[i]) ?? []).find(
          (ed) => ed.source === path[i + 1] || ed.target === path[i + 1],
        )
        if (e) reveal.add(e.id)
      }
      setShownEdgeIds(reveal)
    }
    // Unreachable nodes get a direct flight rather than no flight.
    setRoute(path ? path.slice(1) : [id])
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
    setCurrentId(route[0])
    setRoute(route.slice(1))
    // Journey over: re-lock the camera for the next departure.
    if (route.length === 1) setFollowing(true)
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
    ;(async () => {
      const apply = await prepare(s, view)
      pendingApply.current = apply
      finishBehindDoors()
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
  const handleExpand = (id: string) => reView((s, v) => s.expand(v, id))
  const handleCollapse = (id: string) =>
    reView((s, v) => s.collapse(v, id, currentId ?? v.anchorId))

  // Long-range scanner: text search across the whole source (not just the view).
  const handleSearch = useCallback(
    (q: string) => sourceRef.current?.search(q, 'text') ?? Promise.resolve([]),
    [],
  )
  // Land on a search hit: a fresh entry re-anchors the ego-net on that node
  // (full relayout behind the doors), resetting the journey + overrides.
  const handleJump = (id: string) =>
    behindDoors(async (s) => {
      const nv = await s.entry({ mode: 'node', id })
      runForceLayout(nv)
      return () => {
        setView(nv)
        setCurrentId(nv.anchorId)
        setSelectedId(null)
        setRoute([])
        clearEdges()
        setShownEdgeIds(new Set())
        setHiddenEdgeIds(new Set())
      }
    })

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
    // The active travel lane: edges between consecutive nodes of [current, …route].
    // These ignore the per-kind toggle so the course is visible while in flight.
    const lane = new Set<string>()
    if (currentId && route.length) {
      const path = [currentId, ...route]
      for (let i = 0; i < path.length - 1; i++) {
        const e = (view.incident.get(path[i]) ?? []).find(
          (ed) => ed.source === path[i + 1] || ed.target === path[i + 1],
        )
        if (e) lane.add(e.id)
      }
    }
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
    const base = active
      ? filterView(view, predicate, new Set([currentId, selectedId].filter(Boolean) as string[]))
      : view
    return budgetView(base, edgeBudget, shownEdgeIds, hiddenEdgeIds, specials, edgeSort, {
      edges: showEdges,
      wormholes: showWormholes,
    }, lane)
  }, [view, edgeBudget, edgeSort, shownEdgeIds, hiddenEdgeIds, showEdges, showWormholes, predicate, currentId, selectedId, route])

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
          following={following}
          followSignal={followSignal}
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
        schema={schema}
        predicate={predicate}
        onPredicateChange={setPredicate}
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
      />
    </Box>
  )
}
