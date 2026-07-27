import { useEffect, useState } from 'react'
import { Box } from '@mui/material'
import { BAR_HEIGHT } from '../hud/BottomBar'
import { HUD, PANEL_Z } from '../hud/hudStyles'

// Demo-mode narration: one short line, bottom-centre, above the dashboard strip.
// Bigger than the HUD's 11–13px instrument type so it stays readable when the
// capture is scaled down in a LinkedIn feed. Only ever rendered under `?demo=1`.

const FADE_MS = 400

export function DemoCaption({ text }: { text: string | null }) {
  // Crossfade: fade the outgoing line out, swap the words while invisible, fade
  // the new one in — so lines never pop or overlap mid-swap.
  const [shown, setShown] = useState<string | null>(text)
  const [visible, setVisible] = useState(!!text)

  useEffect(() => {
    if (text === shown) return
    setVisible(false)
    const t = setTimeout(() => {
      setShown(text)
      setVisible(!!text)
    }, FADE_MS)
    return () => clearTimeout(t)
  }, [text, shown])

  return (
    <Box
      sx={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: BAR_HEIGHT + 28,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none', // narration is scenery, never a click target
        zIndex: PANEL_Z + 10,
      }}
    >
      <Box
        sx={{
          maxWidth: 760,
          px: 3,
          py: 1.25,
          textAlign: 'center',
          font: '20px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
          letterSpacing: 0.4,
          color: '#eaf7ff',
          textShadow: `0 0 18px rgba(127, 212, 255, 0.45)`,
          bgcolor: 'rgba(4, 14, 28, 0.72)',
          border: `1px solid ${HUD}33`,
          borderRadius: '10px',
          backdropFilter: 'blur(6px)',
          opacity: visible ? 1 : 0,
          transition: `opacity ${FADE_MS}ms ease`,
        }}
      >
        {shown ?? ''}
      </Box>
    </Box>
  )
}
