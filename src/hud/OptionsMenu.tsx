import { Box, Slider, Typography } from '@mui/material'
import type { ViewMode } from '../types'
import { EDGE_SORT_OPTIONS, type EdgeSortKey } from '../data/edgeSort'

const MONO = '11px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace'
const MONO_SMALL = '10px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace'

const MODES: Array<{ id: ViewMode; label: string; disabled?: boolean }> = [
  { id: 'proximity', label: 'prox' },
  { id: 'adjacent', label: 'adj' },
  { id: 'multi', label: 'multi', disabled: true },
  { id: 'cluster', label: 'clust', disabled: true },
  { id: 'semantic', label: 'sem', disabled: true },
]

interface Props {
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
  doorsClosed: boolean
  onToggleDoors: () => void
}

// The ship-console controls. Rendered as the contents of a DeployPanel (the
// rail owns the open/close animation); this component is just the instruments.
export function OptionsMenu({
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
  doorsClosed,
  onToggleDoors,
}: Props) {
  return (
    <>
      <Typography sx={{ font: MONO, letterSpacing: 3, color: '#aadfff', mb: 1.5 }}>
        SHIP CONSOLE
      </Typography>

      <Typography sx={{ font: MONO, letterSpacing: 1.5, color: 'text.secondary' }}>
        VIEW MODE
      </Typography>
      <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, mb: 1.5 }}>
        {MODES.map((m) => {
          const active = m.id === viewMode
          return (
            <Box
              key={m.id}
              component="button"
              disabled={m.disabled}
              title={m.disabled ? 'Coming soon' : undefined}
              onClick={() => onViewModeChange(m.id)}
              sx={{
                flex: 1,
                font: MONO_SMALL,
                letterSpacing: 1.5,
                textTransform: 'uppercase',
                padding: '3px 0',
                color: active ? '#02030a' : m.disabled ? 'rgba(170, 223, 255, 0.3)' : '#aadfff',
                background: active ? '#7fd4ff' : 'transparent',
                border: '1px solid rgba(127, 212, 255, 0.45)',
                borderRadius: '6px',
                cursor: m.disabled ? 'default' : 'pointer',
              }}
            >
              {m.label}
            </Box>
          )
        })}
      </Box>

      <Typography sx={{ font: MONO, letterSpacing: 1.5, color: 'text.secondary' }}>
        EDGES / NODE — {edgeBudget}
      </Typography>
      <Slider
        size="small"
        min={5}
        max={50}
        value={edgeBudget}
        onChange={(_, v) => onEdgeBudgetChange(v as number)}
        aria-label="Edges per node"
        sx={{ mt: -0.5 }}
      />
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: -0.5, mb: 1 }}>
        Show each node's strongest {edgeBudget} links (wormholes always shown).
      </Typography>

      <Typography sx={{ font: MONO, letterSpacing: 1.5, color: 'text.secondary' }}>
        SORT / CLIP BY
      </Typography>
      <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, mb: 1.5 }}>
        {EDGE_SORT_OPTIONS.map((o) => {
          const active = o.key === edgeSort
          return (
            <Box
              key={o.key}
              component="button"
              onClick={() => onEdgeSortChange(o.key)}
              sx={{
                flex: 1,
                font: MONO_SMALL,
                letterSpacing: 1,
                textTransform: 'uppercase',
                padding: '3px 0',
                color: active ? '#02030a' : '#aadfff',
                background: active ? '#7fd4ff' : 'transparent',
                border: '1px solid rgba(127, 212, 255, 0.45)',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              {o.label}
            </Box>
          )
        })}
      </Box>

      <Typography sx={{ font: MONO, letterSpacing: 1.5, color: 'text.secondary' }}>
        VISIBILITY
      </Typography>
      <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, mb: 0.25 }}>
        {[
          { label: 'edges', on: showEdges, toggle: onToggleEdges },
          { label: 'wormholes', on: showWormholes, toggle: onToggleWormholes },
        ].map((t) => (
          <Box
            key={t.label}
            component="button"
            onClick={t.toggle}
            sx={{
              flex: 1,
              font: MONO_SMALL,
              letterSpacing: 1.5,
              textTransform: 'uppercase',
              padding: '4px 0',
              color: t.on ? '#02030a' : '#aadfff',
              background: t.on ? '#7fd4ff' : 'transparent',
              border: '1px solid rgba(127, 212, 255, 0.45)',
              borderRadius: '6px',
              cursor: 'pointer',
            }}
          >
            {t.on ? '◉' : '○'} {t.label}
          </Box>
        ))}
      </Box>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1.5 }}>
        The travel lane stays lit even with edges hidden.
      </Typography>

      {viewMode === 'proximity' && (
        <>
          <Typography sx={{ font: MONO, letterSpacing: 1.5, color: 'text.secondary' }}>
            TARGET LOCKS — {maxTags}
          </Typography>
          <Slider
            size="small"
            min={1}
            max={50}
            value={maxTags}
            onChange={(_, v) => onMaxTagsChange(v as number)}
            aria-label="Target locks"
            sx={{ mt: -0.5 }}
          />
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: -0.5 }}>
            Reticles lock the closest {maxTags} bodies on the glass.
          </Typography>
        </>
      )}

      {viewMode === 'adjacent' && (
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
          Reticles lock only nodes linked to the current node.
        </Typography>
      )}

      <Typography sx={{ font: MONO, letterSpacing: 1.5, color: 'text.secondary', mt: 1.5 }}>
        CORRIDOR
      </Typography>
      <Box
        component="button"
        onClick={onToggleAutoCollapse}
        sx={{
          width: '100%',
          mt: 0.5,
          font: MONO_SMALL,
          letterSpacing: 1.5,
          textTransform: 'uppercase',
          padding: '4px 0',
          color: autoCollapse ? '#02030a' : '#aadfff',
          background: autoCollapse ? '#7fd4ff' : 'transparent',
          border: '1px solid rgba(127, 212, 255, 0.45)',
          borderRadius: '6px',
          cursor: 'pointer',
        }}
      >
        {autoCollapse ? '◉' : '○'} auto-collapse paths not taken
      </Box>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
        Fold off-corridor branches when parked; rewind via the corridor trail.
      </Typography>

      <Typography sx={{ font: MONO, letterSpacing: 1.5, color: 'text.secondary', mt: 1.5 }}>
        BLAST DOORS
      </Typography>
      <Box
        component="button"
        onClick={onToggleDoors}
        sx={{
          width: '100%',
          mt: 0.5,
          font: MONO_SMALL,
          letterSpacing: 1.5,
          textTransform: 'uppercase',
          padding: '4px 0',
          color: doorsClosed ? '#02030a' : '#aadfff',
          background: doorsClosed ? '#7fd4ff' : 'transparent',
          border: '1px solid rgba(127, 212, 255, 0.45)',
          borderRadius: '6px',
          cursor: 'pointer',
        }}
      >
        {doorsClosed ? '▲ open doors' : '▼ close doors'}
      </Box>
    </>
  )
}
