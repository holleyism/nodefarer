import { Box, Typography } from '@mui/material'
import { PANEL_Z } from './hudStyles'

// The dashboard: a near-opaque strip under the window glass. The controls live
// on the left activation rail now (ConsoleRail); this keeps the controls legend
// and the wordmark.
export const BAR_HEIGHT = 48

export function BottomBar() {
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
