import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Box } from '@mui/material'

// The animated glass shell shared by the bottom-left status readout
// (MessageToast) and the bottom-center tour narration (TourPanel): an empty
// circle fades in, grows right into a pill, then grows UP (the bottom is
// pinned) into the panel; the contents fade in last. Closing reverses it.
//
// This component owns only the chrome + animation. Each consumer supplies its
// own padded content and its own controls — the error toast a single dismiss
// ✕, the tour a Back/Next/Quit row and deliberately no ✕.
const BOTTOM = 64 // clear of the dashboard bar
const PILL = 32

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
  open: boolean
  anchor?: 'bottom-left' | 'bottom-center'
  width?: number
  accent?: string
  glow?: string
  maxHeightVh?: number
  zIndex?: number
  children: ReactNode
  // Fired once the retract animation has fully played out (panel unmounted).
  onClosed?: () => void
}

export function DeployToast({
  open,
  anchor = 'bottom-left',
  width = 340,
  accent = '#7fd4ff',
  glow = 'rgba(127,212,255,0.25)',
  maxHeightVh = 40,
  zIndex = 200,
  children,
  onClosed,
}: Props) {
  const [rendered, setRendered] = useState(open)
  const [deployed, setDeployed] = useState(false)
  // Keep the last content so it persists through the retract (the consumer may
  // pass null as it closes).
  const lastChildren = useRef<ReactNode>(children)
  if (open) lastChildren.current = children

  // Layout effect so the collapsed state commits before paint; the double rAF
  // then flips to deployed a frame later, giving the open transition a "from"
  // state to animate from (a plain effect lets a frame slip through and the
  // panel paints already-open — no open animation).
  useLayoutEffect(() => {
    if (open) {
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
    const t = setTimeout(() => {
      setRendered(false)
      onClosed?.()
    }, 800)
    return () => clearTimeout(t)
  }, [open, onClosed])

  if (!rendered) return null

  const pos =
    anchor === 'bottom-center'
      ? { left: '50%', transform: 'translateX(-50%)' }
      : { left: 20 }

  return (
    <Box
      sx={{
        position: 'fixed',
        bottom: BOTTOM,
        ...pos,
        zIndex,
        width: deployed ? width : PILL,
        height: 'auto',
        minHeight: PILL,
        maxHeight: deployed ? `${maxHeightVh}vh` : `${PILL}px`,
        opacity: deployed ? 1 : 0,
        overflow: 'hidden',
        bgcolor: 'rgba(4, 14, 28, 0.94)',
        border: `1px solid ${accent}`,
        borderRadius: deployed ? '10px' : `${PILL / 2}px`,
        boxShadow: `0 0 18px ${glow}`,
        backdropFilter: 'blur(6px)',
        transition: deployed ? OPEN_TR : CLOSE_TR,
      }}
    >
      {/* Fixed-width inner box: content is laid out at full width and clipped by
          the animating outer width, so it doesn't reflow as the panel grows. */}
      <Box
        sx={{
          width,
          opacity: deployed ? 1 : 0,
          transition: deployed ? 'opacity 180ms linear 560ms' : 'opacity 120ms linear 0ms',
        }}
      >
        {lastChildren.current}
      </Box>
    </Box>
  )
}
