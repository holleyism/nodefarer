import { Box } from '@mui/material'
import { BAR_HEIGHT } from './BottomBar'

const BORDER = 'rgba(127, 212, 255, 0.22)'
const BRACKET = 'rgba(127, 212, 255, 0.55)'

const CORNERS = [
  { top: 8, left: 8, borderTop: 2, borderLeft: 2 },
  { top: 8, right: 8, borderTop: 2, borderRight: 2 },
  { bottom: BAR_HEIGHT + 6, left: 8, borderBottom: 2, borderLeft: 2 },
  { bottom: BAR_HEIGHT + 6, right: 8, borderBottom: 2, borderRight: 2 },
] as const

// The ship's window: vignette, thin frame, and corner brackets drawn over the
// scene, ending where the dashboard (BottomBar) begins. Purely decorative —
// lets no pointer events through it.
export function ViewportFrame() {
  return (
    <Box sx={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <Box
        sx={{
          position: 'absolute',
          inset: `0 0 ${BAR_HEIGHT}px 0`,
          boxShadow: 'inset 0 0 140px 30px rgba(0, 6, 16, 0.9)',
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          inset: `12px 12px ${BAR_HEIGHT + 10}px 12px`,
          border: `1px solid ${BORDER}`,
          borderRadius: '14px',
        }}
      />
      {CORNERS.map((c, i) => (
        <Box
          key={i}
          sx={{
            position: 'absolute',
            width: 30,
            height: 30,
            top: 'top' in c ? c.top : 'auto',
            bottom: 'bottom' in c ? c.bottom : 'auto',
            left: 'left' in c ? c.left : 'auto',
            right: 'right' in c ? c.right : 'auto',
            borderTop: 'borderTop' in c ? `2px solid ${BRACKET}` : 'none',
            borderBottom: 'borderBottom' in c ? `2px solid ${BRACKET}` : 'none',
            borderLeft: 'borderLeft' in c ? `2px solid ${BRACKET}` : 'none',
            borderRight: 'borderRight' in c ? `2px solid ${BRACKET}` : 'none',
            borderRadius: '4px',
          }}
        />
      ))}
    </Box>
  )
}
