import { Box, Typography } from '@mui/material'
import { OptionsMenu } from './OptionsMenu'
import { PANEL_Z } from './hudStyles'
import type { ViewMode } from '../types'
import type { EdgeSortKey } from '../data/edgeSort'

// The dashboard: a near-opaque strip under the window glass. Home for the
// console button, the controls legend, and the wordmark — and whatever
// instruments come later.
export const BAR_HEIGHT = 48

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
  doorsClosed: boolean
  onToggleDoors: () => void
}

export function BottomBar({
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
  doorsClosed,
  onToggleDoors,
}: Props) {
  return (
    <Box
      sx={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: BAR_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        gap: 2.5,
        px: 2.5,
        bgcolor: 'rgba(5, 11, 22, 0.94)',
        borderTop: '1px solid rgba(127, 212, 255, 0.25)',
        backdropFilter: 'blur(8px)',
        zIndex: PANEL_Z,
      }}
    >
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
        doorsClosed={doorsClosed}
        onToggleDoors={onToggleDoors}
      />
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        Drag — look · Right-drag / Shift-drag — orbit · Two-finger — orbit + zoom · Scroll — zoom ·
        Click — inspect · Double-click — travel
      </Typography>
      <Typography
        variant="overline"
        sx={{ ml: 'auto', color: 'text.secondary', letterSpacing: 4, lineHeight: 1 }}
      >
        Nodefarer
      </Typography>
    </Box>
  )
}
