import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'

export interface AppMessage {
  id: number
  text: string
  level: 'error' | 'info'
}

// A status/error readout that deploys like a rail panel, but anchored at the
// bottom-left corner: an empty circle fades in, grows right into a pill, then
// grows UP (the bottom is pinned) into the panel, and the contents fade in.
// Closing reverses it. Info messages auto-dismiss; errors stay until dismissed.
const LEFT = 20
const BOTTOM = 64 // clear of the dashboard bar
const PILL = 32
const WIDTH = 340
const AUTO_DISMISS_MS = 6000

const OPEN_TR = [
  'opacity 120ms linear 0ms', // circle fades in
  'width 200ms cubic-bezier(0.2,0.9,0.25,1.12) 130ms', // grow right
  'max-height 230ms cubic-bezier(0.2,0.9,0.25,1.12) 330ms', // grow up
  'border-radius 200ms linear 330ms',
].join(', ')
const CLOSE_TR = [
  'opacity 120ms linear 540ms', // fade out last
  'width 200ms ease 320ms', // shrink right
  'max-height 200ms ease 120ms', // shrink down first
  'border-radius 200ms linear 120ms',
].join(', ')

interface Props {
  message: AppMessage | null
  onDismiss: () => void
}

export function MessageToast({ message, onDismiss }: Props) {
  const [rendered, setRendered] = useState(!!message)
  const [deployed, setDeployed] = useState(false)
  // Keep the last message so contents persist through the retract.
  const last = useRef(message)
  if (message) last.current = message
  const msg = message ?? last.current

  // Layout effect so the collapsed state commits before paint; the double rAF
  // then flips to deployed a frame later, giving the open transition a "from"
  // state to animate from (a plain effect lets a frame slip through and the
  // toast paints already-open — no open animation).
  useLayoutEffect(() => {
    if (message) {
      setRendered(true)
      setDeployed(false)
      let raf2 = 0
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setDeployed(true))
      })
      return () => {
        cancelAnimationFrame(raf1)
        cancelAnimationFrame(raf2)
      }
    }
    setDeployed(false)
    const t = setTimeout(() => setRendered(false), 800)
    return () => clearTimeout(t)
  }, [message])

  // Info auto-dismisses; errors persist until the user closes them.
  useEffect(() => {
    if (message?.level === 'info') {
      const t = setTimeout(onDismiss, AUTO_DISMISS_MS)
      return () => clearTimeout(t)
    }
  }, [message, onDismiss])

  if (!rendered || !msg) return null
  const error = msg.level === 'error'
  const accent = error ? '#ffb38a' : '#7fd4ff'

  return (
    <Box
      sx={{
        position: 'fixed',
        left: LEFT,
        bottom: BOTTOM,
        zIndex: 200,
        width: deployed ? WIDTH : PILL,
        height: 'auto',
        minHeight: PILL,
        maxHeight: deployed ? '40vh' : `${PILL}px`,
        opacity: deployed ? 1 : 0,
        overflow: 'hidden',
        bgcolor: 'rgba(4, 14, 28, 0.94)',
        border: `1px solid ${accent}`,
        borderRadius: deployed ? '10px' : `${PILL / 2}px`,
        boxShadow: `0 0 18px ${error ? 'rgba(255,140,90,0.25)' : 'rgba(127,212,255,0.25)'}`,
        backdropFilter: 'blur(6px)',
        transition: deployed ? OPEN_TR : CLOSE_TR,
      }}
    >
      <Box
        sx={{
          width: WIDTH,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 1,
          p: 1.5,
          opacity: deployed ? 1 : 0,
          transition: deployed ? 'opacity 180ms linear 560ms' : 'opacity 120ms linear 0ms',
        }}
      >
        <Box component="span" sx={{ color: accent, font: '14px/1.3 ui-monospace, monospace', flexShrink: 0 }}>
          {error ? '⚠' : 'ⓘ'}
        </Box>
        <Typography
          sx={{
            flex: 1,
            font: '11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
            letterSpacing: 0.3,
            color: '#cdeeff',
            wordBreak: 'break-word',
          }}
        >
          {msg.text}
        </Typography>
        <Box
          component="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          sx={{
            flexShrink: 0,
            font: '12px/1 ui-monospace, monospace',
            color: 'text.secondary',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            p: 0,
            '&:hover': { color: accent },
          }}
        >
          ✕
        </Box>
      </Box>
    </Box>
  )
}
