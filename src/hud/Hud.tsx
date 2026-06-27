import { useEffect, useRef, useState } from 'react'
import { Box, LinearProgress, Paper, Stack, Typography } from '@mui/material'
import type { Graph, GraphNode, ViewMode } from '../types'
import type { EdgeSortKey } from '../data/edgeSort'
import { BlastDoors } from './BlastDoors'
import { BottomBar } from './BottomBar'
import { Breadcrumbs } from './Breadcrumbs'
import { ConsoleRail, type RailItem } from './ConsoleRail'
import { CoursePanel } from './CoursePanel'
import { CurrentNodeContent } from './CurrentNodeContent'
import { FilterPanel } from './FilterPanel'
import { PANEL_SX } from './hudStyles'
import { NodePanel } from './NodePanel'
import { OptionsMenu } from './OptionsMenu'
import { Radar } from './Radar'
import { SearchBar } from './SearchBar'
import { ValuePill } from './ValuePill'
import type { AtlasTourRef, SourceChoice } from '../data/atlas'
import type { DemoEntry } from '../data/bundleStore'
import { NebulaPanel, type NebulaInfo } from './NebulaPanel'
import type { Candidate, Predicate } from '../data/GraphSource'
import type { GraphSchema } from '../data/graphSchema'
import { ViewportFrame } from './ViewportFrame'

function dist(a: GraphNode, b: GraphNode) {
  return Math.hypot(a.x! - b.x!, a.y! - b.y!, a.z! - b.z!)
}

interface Props {
  graph: Graph
  currentNode: GraphNode
  selectedNode: GraphNode | null
  destination: GraphNode | null
  hopsLeft: number
  viewMode: ViewMode
  onViewModeChange: (m: ViewMode) => void
  maxTags: number
  onMaxTagsChange: (n: number) => void
  edgeBudget: number
  onEdgeBudgetChange: (n: number) => void
  edgeSort: EdgeSortKey
  onEdgeSortChange: (k: EdgeSortKey) => void
  showEdges: boolean
  onToggleEdges: () => void
  showWormholes: boolean
  onToggleWormholes: () => void
  autoCollapse: boolean
  onToggleAutoCollapse: () => void
  schema: GraphSchema | null
  predicate: Predicate
  onPredicateChange: (p: Predicate) => void
  trail: string[]
  following: boolean
  onFollow: () => void
  doorsClosed: boolean
  onToggleDoors: () => void
  onDoorsClosed: () => void
  pinnedEdgeIds: string[]
  visibleEdgeIds: Set<string>
  onTogglePin: (id: string) => void
  onHoverEdge: (id: string | null) => void
  onSetEdgeVisible: (id: string, visible: boolean) => void
  onSelect: (id: string) => void
  onTravel: (id: string) => void
  onExpand: (id: string) => void
  onCollapse: (id: string) => void
  onClosePanel: () => void
  onSearch: (query: string) => Promise<Candidate[]>
  onJump: (id: string) => void
  // A plotted-but-not-yet-travelled course (ordered node ids, current first).
  // Empty = none; when set, the scanner shifts to its course (describe/Travel) view.
  plottedRoute: string[]
  onPlotCourse: (id: string) => void
  onTravelCourse: () => void
  onClearCourse: () => void
  // Course-scrub: wheel-travel the plotted course manually. scrubIndex is the
  // route node the ship is nearest; onDockCourse(i) commits the preview there.
  scrubMode: boolean
  scrubIndex: number
  scrubStep: number
  onScrubStep: (value: number) => void
  onToggleScrub: () => void
  onDockCourse: (index: number) => void
  // Guided tours from the Atlas catalog (Plan G2); `file` is the path under the
  // source root. Each plays over the bundle via the same exploration engine as
  // manual navigation (see src/data/tour.ts).
  tours: AtlasTourRef[]
  onStartTour: (file: string) => void
  // Runtime data-source selection (Plan G4) — the "choose your universe" picker.
  sourceChoice: SourceChoice
  demos: DemoEntry[]
  onSwitchUniverse: (choice: SourceChoice) => void
  onLoadBundleUrl: (url: string) => void
  onPickLocalBundle: () => void
  // Nebula grouping controls (Plan H).
  nebulaOn: boolean
  nebulaLabel: string
  groupStrength: number
  nebulaSpacing: number
  layoutSpacing: number
  onLayoutSpacing: (value: number) => void
  watchReform: boolean
  nebulaIsolate: boolean
  onToggleNebula: () => void
  onGroupStrength: (value: number) => void
  onNebulaSpacing: (value: number) => void
  onToggleWatchReform: () => void
  onToggleIsolate: () => void
  onFoldDistant: () => void
  // Nebula inspector (Plan H2b): the focused/current nebula + its fold state.
  nebulaInfo: NebulaInfo | null
  nebulaColor: string
  nebulaFolded: boolean
  nebulaIsCurrent: boolean
  onSetNebulaFolded: (key: string, folded: boolean) => void
  // The locked/selected nebula — opens the rail inspector when set (Plan H2b).
  focusedNebula: string | null
  // Highlight the inspected nebula's members in place (Plan H3).
  nebulaHighlight: boolean
  onToggleNebulaHighlight: () => void
  tourActive: boolean
}

export function Hud({
  graph,
  currentNode,
  selectedNode,
  destination,
  hopsLeft,
  viewMode,
  onViewModeChange,
  maxTags,
  onMaxTagsChange,
  edgeBudget,
  onEdgeBudgetChange,
  edgeSort,
  onEdgeSortChange,
  showEdges,
  onToggleEdges,
  showWormholes,
  onToggleWormholes,
  autoCollapse,
  onToggleAutoCollapse,
  schema,
  predicate,
  onPredicateChange,
  trail,
  following,
  onFollow,
  doorsClosed,
  onToggleDoors,
  onDoorsClosed,
  pinnedEdgeIds,
  visibleEdgeIds,
  onTogglePin,
  onHoverEdge,
  onSetEdgeVisible,
  onSelect,
  onTravel,
  onExpand,
  onCollapse,
  onClosePanel,
  onSearch,
  onJump,
  plottedRoute,
  onPlotCourse,
  onTravelCourse,
  onClearCourse,
  scrubMode,
  scrubIndex,
  scrubStep,
  onScrubStep,
  onToggleScrub,
  onDockCourse,
  tours,
  onStartTour,
  sourceChoice,
  demos,
  onSwitchUniverse,
  onLoadBundleUrl,
  onPickLocalBundle,
  nebulaOn,
  nebulaLabel,
  groupStrength,
  nebulaSpacing,
  layoutSpacing,
  onLayoutSpacing,
  watchReform,
  nebulaIsolate,
  onToggleNebula,
  onGroupStrength,
  onNebulaSpacing,
  onToggleWatchReform,
  onToggleIsolate,
  onFoldDistant,
  nebulaInfo,
  nebulaColor,
  nebulaFolded,
  nebulaIsCurrent,
  onSetNebulaFolded,
  focusedNebula,
  nebulaHighlight,
  onToggleNebulaHighlight,
  tourActive,
}: Props) {
  const traveling = destination !== null
  // Radar source: immediate neighbors of the current node. Future sources
  // (search hits, clusters, semantic matches) swap in here.
  const radarTargets = (graph.neighbors.get(currentNode.id) ?? []).map(
    (id) => graph.nodeById.get(id)!,
  )
  const neighborCount = radarTargets.length

  // Which rail panel is open (one at a time). Selection drives the inspector:
  // selecting a node deploys it; deselecting retracts it. Keep the last node so
  // the inspector keeps its contents through the retract animation.
  const [openId, setOpenId] = useState<string | null>(null)
  const lastSelected = useRef<GraphNode | null>(null)
  if (selectedNode) lastSelected.current = selectedNode
  const inspectNode = selectedNode ?? lastSelected.current

  useEffect(() => {
    if (selectedNode) setOpenId('inspector')
    else setOpenId((cur) => (cur === 'inspector' ? null : cur))
  }, [selectedNode])

  // Clicking a nebula (sets focusedNebula) opens its rail inspector (Plan H2b).
  useEffect(() => {
    if (focusedNebula) setOpenId('nebula')
  }, [focusedNebula])

  // A guided tour locks the rail: close whatever's open so no manual panel is
  // left interactable underneath the (dimmed, non-interactive) rail.
  useEffect(() => {
    if (tourActive) setOpenId(null)
  }, [tourActive])

  const handleOpenChange = (id: string | null) => {
    if (tourActive) return
    // Leaving the inspector clears the selection; opening it with nothing
    // selected inspects the current node.
    if (openId === 'inspector' && id !== 'inspector') onClosePanel()
    if (id === 'inspector' && !selectedNode) onSelect(currentNode.id)
    setOpenId(id)
  }

  // Left activation rail — current node, inspector, scanner, ship console.
  const railItems: RailItem[] = [
    {
      id: 'current',
      icon: '⬡',
      title: 'Current node',
      width: 240,
      content: (
        <CurrentNodeContent
          node={currentNode}
          neighborCount={neighborCount}
          onInspect={() => onSelect(currentNode.id)}
        />
      ),
    },
    {
      id: 'corridor',
      icon: '↺',
      title: 'Corridor — trail',
      width: 260,
      contentKey: `trail-${trail.length}`,
      content: ({ close }: { close: () => void }) => (
        <Breadcrumbs trail={trail} graph={graph} currentId={currentNode.id} onTravel={onTravel} onPick={close} />
      ),
    },
    {
      id: 'inspector',
      icon: '⊙',
      title: 'Inspector — selected node',
      width: 320,
      contentKey: inspectNode?.id ?? 'inspector',
      content: inspectNode ? (
        <NodePanel
          node={inspectNode}
          graph={graph}
          currentId={currentNode.id}
          isCurrent={inspectNode.id === currentNode.id}
          distance={dist(currentNode, inspectNode)}
          traveling={traveling}
          pinnedEdgeIds={pinnedEdgeIds}
          visibleEdgeIds={visibleEdgeIds}
          edgeSort={edgeSort}
          onTogglePin={onTogglePin}
          onHoverEdge={onHoverEdge}
          onSetEdgeVisible={onSetEdgeVisible}
          onTravel={onTravel}
          onPlotCourse={onPlotCourse}
          onExpand={onExpand}
          onCollapse={onCollapse}
          onClose={onClosePanel}
        />
      ) : null,
    },
    {
      id: 'scanner',
      icon: '⌕',
      title: 'Scanner — search',
      width: 300,
      // Cross-fade between the search box and the plotted-course view. Once the
      // course is being travelled, drop back to search (the route stays
      // highlighted in the scene until arrival).
      contentKey: plottedRoute.length > 1 && !traveling ? 'course' : 'scanner',
      content: ({ close }: { close: () => void }) =>
        plottedRoute.length > 1 && !traveling ? (
          <CoursePanel
            route={plottedRoute}
            graph={graph}
            onTravel={() => {
              close()
              onTravelCourse()
            }}
            onClear={onClearCourse}
            scrubMode={scrubMode}
            scrubIndex={scrubIndex}
            scrubStep={scrubStep}
            onScrubStep={onScrubStep}
            onToggleScrub={onToggleScrub}
            onDock={onDockCourse}
          />
        ) : (
          <SearchBar
            onSearch={onSearch}
            // Plot a course: highlight the route + auto-frame, keep the panel
            // open (it shifts to the course view). Travel is then deliberate.
            onPlotCourse={onPlotCourse}
            onJump={(id) => {
              close()
              onJump(id)
            }}
          />
        ),
    },
    {
      id: 'filter',
      icon: '▽',
      title: 'Filter — bound the view',
      width: 280,
      content: schema ? (
        <FilterPanel schema={schema} predicate={predicate} onChange={onPredicateChange} />
      ) : null,
    },
    {
      id: 'tours',
      icon: '✦',
      title: 'Guided tours',
      width: 280,
      content: ({ close }: { close: () => void }) => (
        <Stack spacing={1.25}>
          <Typography sx={{ font: '11px/1.7 ui-monospace, Menlo, monospace', letterSpacing: 3, color: '#aadfff' }}>
            GUIDED TOURS
          </Typography>
          {tours.map((t) => (
            <Box
              key={t.file}
              component="button"
              onClick={() => {
                close()
                onStartTour(t.file)
              }}
              sx={{
                textAlign: 'left',
                width: '100%',
                p: 1,
                color: '#efe6ff',
                background: 'rgba(201, 166, 255, 0.08)',
                border: '1px solid rgba(201, 166, 255, 0.45)',
                borderRadius: '8px',
                cursor: 'pointer',
                '&:hover': { borderColor: '#c9a6ff', background: 'rgba(201, 166, 255, 0.16)' },
              }}
            >
              <Typography sx={{ font: '11px/1.5 ui-monospace, Menlo, monospace', letterSpacing: 0.5, color: '#c9a6ff' }}>
                ▶ {t.title}
              </Typography>
              <Typography sx={{ font: '10px/1.5 ui-monospace, Menlo, monospace', color: 'text.secondary' }}>
                {t.subtitle}
              </Typography>
            </Box>
          ))}
        </Stack>
      ),
    },
    {
      id: 'nebula',
      icon: '◍',
      title: 'Nebula',
      width: 260,
      content: (
        <NebulaPanel
          info={nebulaInfo}
          color={nebulaColor}
          folded={nebulaFolded}
          isCurrent={nebulaIsCurrent}
          highlight={nebulaHighlight}
          onToggleFold={onSetNebulaFolded}
          onToggleHighlight={onToggleNebulaHighlight}
          onSelectMember={onSelect}
        />
      ),
    },
    {
      id: 'console',
      icon: '▤',
      title: 'Ship console',
      width: 280,
      content: (
        <OptionsMenu
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
          maxTags={maxTags}
          onMaxTagsChange={onMaxTagsChange}
          edgeBudget={edgeBudget}
          onEdgeBudgetChange={onEdgeBudgetChange}
          edgeSort={edgeSort}
          onEdgeSortChange={onEdgeSortChange}
          showEdges={showEdges}
          onToggleEdges={onToggleEdges}
          showWormholes={showWormholes}
          onToggleWormholes={onToggleWormholes}
          autoCollapse={autoCollapse}
          onToggleAutoCollapse={onToggleAutoCollapse}
          doorsClosed={doorsClosed}
          onToggleDoors={onToggleDoors}
          sourceChoice={sourceChoice}
          demos={demos}
          onSwitchUniverse={onSwitchUniverse}
          onLoadBundleUrl={onLoadBundleUrl}
          onPickLocalBundle={onPickLocalBundle}
          nebulaOn={nebulaOn}
          nebulaLabel={nebulaLabel}
          groupStrength={groupStrength}
          nebulaSpacing={nebulaSpacing}
          layoutSpacing={layoutSpacing}
          onLayoutSpacing={onLayoutSpacing}
          watchReform={watchReform}
          nebulaIsolate={nebulaIsolate}
          onToggleNebula={onToggleNebula}
          onGroupStrength={onGroupStrength}
          onNebulaSpacing={onNebulaSpacing}
          onToggleWatchReform={onToggleWatchReform}
          onToggleIsolate={onToggleIsolate}
          onFoldDistant={onFoldDistant}
        />
      ),
    },
  ]

  return (
    <>
      <BlastDoors closed={doorsClosed} label="standby — layout hold" onClosed={onDoorsClosed} />
      <ViewportFrame />

      {/* Left activation rail */}
      <ConsoleRail
        items={railItems}
        openId={openId}
        onOpenChange={handleOpenChange}
        locked={tourActive}
        // While a tour drives the view the rail is locked, but the inspector it
        // opens stays readable (full opacity) — just inert. See ConsoleRail.
        readOnlyId={tourActive ? 'inspector' : null}
      />

      {/* Travel banner — top center */}
      {traveling && (
        <Paper
          elevation={4}
          sx={{
            position: 'absolute',
            top: 28,
            left: '50%',
            transform: 'translateX(-50%)',
            px: 3,
            py: 1,
            minWidth: 240,
            ...PANEL_SX,
          }}
        >
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
            <Typography variant="body2">
              Traveling to <strong>{destination.name}</strong>…
            </Typography>
            {hopsLeft > 1 && <ValuePill>{hopsLeft} hops</ValuePill>}
            {/* Always available in flight: lit when the camera is locked to the
                course, a call-to-action to re-lock after dragging unlocks it. */}
            <Box
              component="button"
              onClick={onFollow}
              sx={{
                ml: 'auto',
                font: '10px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace',
                letterSpacing: 1.5,
                textTransform: 'uppercase',
                color: following ? '#02030a' : '#aadfff',
                background: following ? '#7fd4ff' : 'transparent',
                border: '1px solid rgba(127, 212, 255, 0.45)',
                borderRadius: 999,
                padding: '2px 10px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                '&:hover': { borderColor: '#7fd4ff' },
              }}
            >
              {following ? '⌖ following' : '⌖ follow course'}
            </Box>
          </Stack>
          <LinearProgress />
        </Paper>
      )}

      {/* Radar — bottom right, above the dashboard */}
      <Radar label="adjacent" targets={radarTargets} />

      {/* Dashboard — controls legend + wordmark */}
      <BottomBar />
    </>
  )
}
