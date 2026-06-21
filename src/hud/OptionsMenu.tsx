import { useState, type ChangeEvent } from 'react'
import { Box, Slider, Typography } from '@mui/material'
import type { ViewMode } from '../types'
import type { SourceChoice } from '../data/atlas'
import type { DemoEntry } from '../data/bundleStore'
import { EDGE_SORT_OPTIONS, type EdgeSortKey } from '../data/edgeSort'
import { ValuePill } from './ValuePill'

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
  sourceChoice: SourceChoice
  demos: DemoEntry[]
  onSwitchUniverse: (choice: SourceChoice) => void
  onLoadBundleUrl: (url: string) => void
  onPickLocalBundle: () => void
  nebulaOn: boolean
  nebulaLabel: string
  groupStrength: number
  nebulaSpacing: number
  watchReform: boolean
  onToggleNebula: () => void
  onGroupStrength: (value: number) => void
  onNebulaSpacing: (value: number) => void
  onToggleWatchReform: () => void
  onFoldDistant: () => void
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
  sourceChoice,
  demos,
  onSwitchUniverse,
  onLoadBundleUrl,
  onPickLocalBundle,
  nebulaOn,
  nebulaLabel,
  groupStrength,
  nebulaSpacing,
  watchReform,
  onToggleNebula,
  onGroupStrength,
  onNebulaSpacing,
  onToggleWatchReform,
  onFoldDistant,
}: Props) {
  const [bundleUrl, setBundleUrl] = useState('')
  const [apiUrl, setApiUrl] = useState(sourceChoice.kind === 'api' ? sourceChoice.url : '')
  // Local display values for the nebula sliders; relayout fires on release.
  const [strength, setStrength] = useState(Math.round(groupStrength * 100))
  const [spread, setSpread] = useState(Math.round(nebulaSpacing))

  const inputSx = {
    flex: 1,
    minWidth: 0,
    boxSizing: 'border-box' as const,
    font: MONO_SMALL,
    color: '#cde8ff',
    background: 'rgba(127, 212, 255, 0.06)',
    border: '1px solid rgba(127, 212, 255, 0.45)',
    borderRadius: '6px',
    padding: '5px 8px',
    outline: 'none',
    '&::placeholder': { color: 'rgba(170, 223, 255, 0.4)' },
    '&:focus': { borderColor: '#7fd4ff' },
  }
  const btnSx = (active: boolean, disabled = false) => ({
    font: MONO_SMALL,
    letterSpacing: 1.5,
    textTransform: 'uppercase' as const,
    padding: '4px 8px',
    color: active ? '#02030a' : disabled ? 'rgba(170, 223, 255, 0.3)' : '#aadfff',
    background: active ? '#7fd4ff' : 'transparent',
    border: '1px solid rgba(127, 212, 255, 0.45)',
    borderRadius: '6px',
    cursor: disabled ? 'default' : 'pointer',
    whiteSpace: 'nowrap' as const,
  })

  const activeBundleDir = sourceChoice.kind === 'bundle' ? (sourceChoice.dir ?? '') : null

  return (
    <>
      <Typography sx={{ font: MONO, letterSpacing: 3, color: '#aadfff', mb: 1.5 }}>
        SHIP CONSOLE
      </Typography>

      <Typography sx={{ font: MONO, letterSpacing: 1.5, color: 'text.secondary' }}>
        DATA SOURCE
      </Typography>

      {/* Shipped demos (from the catalog) */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
        {demos.map((d) => {
          const active = activeBundleDir === d.dir
          return (
            <Box
              key={d.id}
              component="button"
              title={d.description ?? d.name}
              onClick={() => onSwitchUniverse({ kind: 'bundle', dir: d.dir })}
              sx={btnSx(active)}
            >
              {active ? '◉' : '○'} {d.name}
            </Box>
          )
        })}
      </Box>

      {/* A user's own bundle: hosted directory URL, or a local folder */}
      <Box sx={{ display: 'flex', gap: 0.5, mt: 0.75 }}>
        <Box
          component="input"
          value={bundleUrl}
          placeholder="https://host/my-bundle/"
          onChange={(e: ChangeEvent<HTMLInputElement>) => setBundleUrl(e.target.value)}
          sx={inputSx}
        />
        <Box
          component="button"
          disabled={bundleUrl.trim() === ''}
          onClick={() => onLoadBundleUrl(bundleUrl)}
          sx={btnSx(false, bundleUrl.trim() === '')}
        >
          load
        </Box>
      </Box>
      <Box component="button" onClick={onPickLocalBundle} sx={{ ...btnSx(false), width: '100%', mt: 0.5 }}>
        choose folder…
      </Box>

      {/* Live backend */}
      <Box sx={{ display: 'flex', gap: 0.5, mt: 0.75 }}>
        <Box
          component="input"
          value={apiUrl}
          placeholder="http://host:8080"
          onChange={(e: ChangeEvent<HTMLInputElement>) => setApiUrl(e.target.value)}
          sx={inputSx}
        />
        <Box
          component="button"
          disabled={apiUrl.trim() === ''}
          onClick={() => onSwitchUniverse({ kind: 'api', url: apiUrl.trim() })}
          sx={btnSx(sourceChoice.kind === 'api', apiUrl.trim() === '')}
        >
          {sourceChoice.kind === 'api' ? '◉' : '○'} live
        </Box>
      </Box>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5, mb: 1.5 }}>
        Pick a demo, load a bundle directory (hosted or local), or connect a live
        backend. Your choice is remembered.
      </Typography>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Typography sx={{ font: MONO, letterSpacing: 1.5, color: 'text.secondary' }}>NEBULAE</Typography>
        <ValuePill>group by {nebulaLabel}</ValuePill>
      </Box>
      <Box component="button" onClick={onToggleNebula} sx={{ ...btnSx(nebulaOn), width: '100%', mt: 0.5 }}>
        {nebulaOn ? '◉' : '○'} cluster into nebulae
      </Box>
      {nebulaOn && (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.75 }}>
            <Typography sx={{ font: MONO, letterSpacing: 1.5, color: 'text.secondary' }}>
              GROUPING
            </Typography>
            <ValuePill>{strength}%</ValuePill>
          </Box>
          <Slider
            size="small"
            min={0}
            max={100}
            value={strength}
            onChange={(_, v) => setStrength(v as number)}
            onChangeCommitted={(_, v) => onGroupStrength((v as number) / 100)}
            aria-label="Grouping strength"
            sx={{ mt: -0.5, width: 'calc(100% - 14px)' }}
          />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.75 }}>
            <Typography sx={{ font: MONO, letterSpacing: 1.5, color: 'text.secondary' }}>SPREAD</Typography>
            <ValuePill>{spread}</ValuePill>
          </Box>
          <Slider
            size="small"
            min={100}
            max={1000}
            step={20}
            value={spread}
            onChange={(_, v) => setSpread(v as number)}
            onChangeCommitted={(_, v) => onNebulaSpacing(v as number)}
            aria-label="Nebula spread"
            sx={{ mt: -0.5, width: 'calc(100% - 14px)' }}
          />
          <Box
            component="button"
            onClick={onFoldDistant}
            sx={{ ...btnSx(false), width: '100%', mt: 0.75 }}
          >
            ⊙ fold distant nebulae
          </Box>
          <Box
            component="button"
            onClick={onToggleWatchReform}
            sx={{ ...btnSx(watchReform), width: '100%', mt: 0.5 }}
          >
            {watchReform ? '◉' : '○'} watch layout reform
          </Box>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5, mb: 1.5 }}>
            Grouping: 0% = force-directed, 100% = hard split by {nebulaLabel}.
            Spread = distance between clouds (nodes stay packed). Watch = run it
            visibly with the doors open.
          </Typography>
        </>
      )}

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

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Typography sx={{ font: MONO, letterSpacing: 1.5, color: 'text.secondary' }}>
          EDGES / NODE
        </Typography>
        <ValuePill>{edgeBudget}</ValuePill>
      </Box>
      <Slider
        size="small"
        min={5}
        max={50}
        value={edgeBudget}
        onChange={(_, v) => onEdgeBudgetChange(v as number)}
        aria-label="Edges per node"
        sx={{ mt: -0.5, width: 'calc(100% - 14px)' }}
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
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Typography sx={{ font: MONO, letterSpacing: 1.5, color: 'text.secondary' }}>
              TARGET LOCKS
            </Typography>
            <ValuePill>{maxTags}</ValuePill>
          </Box>
          <Slider
            size="small"
            min={1}
            max={50}
            value={maxTags}
            onChange={(_, v) => onMaxTagsChange(v as number)}
            aria-label="Target locks"
            sx={{ mt: -0.5, width: 'calc(100% - 14px)' }}
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
