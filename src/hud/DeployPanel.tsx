import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Box } from '@mui/material'
import { HUD, PANEL_Z } from './hudStyles'

// Reusable "space panel" deploy. An activation icon on the rail; clicking it
// runs a staged open: the icon pops (with a reticle-style lock ring) then stays
// lit, an empty circle fades in to its right, grows horizontally into a pill,
// then expands vertically (both directions, centered on the icon but clamped to
// the viewport), and finally the contents fade in with a terminal scanline.
// Closing reverses the order. Children stay mounted through the retract.
const ICON = 52
const GAP = 14
const PILL = 32
const PAD = 16 // viewport breathing room the open panel must stay inside

// Staged via per-property transition delays. Open expands outward; close runs
// the same stages in reverse so it folds back to a circle before vanishing.
// The vertical stage animates `top` AND `max-height` together: the box starts
// as a circle at the icon's center and the top edge slides up while the box
// grows down, so top/bottom grow at independent rates (and stay viewport-clamped).
const VERT = 'cubic-bezier(0.2,0.9,0.25,1.12)'
const OPEN_TR = [
  'opacity 120ms linear 150ms', // circle fades in (after the icon pop)
  'width 200ms cubic-bezier(0.2,0.9,0.25,1.12) 270ms', // grow horizontal
  `max-height 230ms ${VERT} 470ms`, // grow vertical …
  `top 230ms ${VERT} 470ms`, // … while the top edge slides to the clamped spot
  'border-radius 200ms linear 470ms',
].join(', ')
const CLOSE_TR = [
  'opacity 120ms linear 560ms', // fade out last
  'width 200ms ease 360ms', // shrink horizontal
  'max-height 200ms ease 150ms', // shrink vertical first …
  'top 200ms ease 150ms', // … folding back toward the icon center
  'border-radius 200ms linear 150ms',
].join(', ')
// Once deployed, content-driven resizes (e.g. live search results) reflow
// quickly instead of inheriting the staged open delays.
const STEADY_TR = 'max-height 160ms ease, top 160ms ease, width 160ms ease'
const OPEN_MS = 950 // total open duration before steady-state takes over

interface Props {
  icon: React.ReactNode
  title?: string
  open: boolean
  onToggle: () => void
  width?: number
  children: React.ReactNode
}

export function DeployPanel({ icon, title, open, onToggle, width = 280, children }: Props) {
  // `rendered` keeps the panel mounted through the retract; `deployed` is the
  // expanded target the transitions ease toward.
  const [rendered, setRendered] = useState(open)
  const [deployed, setDeployed] = useState(open)
  const [settled, setSettled] = useState(open) // open animation finished
  const [flash, setFlash] = useState(0) // bump to replay the icon pop
  // Viewport-clamped placement, measured from the icon (fixed-positioned panel).
  // `collapsedTop` puts the circle at the icon's vertical center; `expandedTop`/
  // `fullH` are the final clamped box. The vertical stage animates between them.
  const [anchor, setAnchor] = useState<{
    left: number
    collapsedTop: number
    expandedTop: number
    fullH: number
  } | null>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // The open panel grows from the icon's center toward whichever edges have
  // room, clamped so the whole box stays within the viewport (PAD margin).
  const measure = useCallback(() => {
    const row = rowRef.current
    if (!row) return
    const r = row.getBoundingClientRect()
    const vh = window.innerHeight
    const maxH = vh - 2 * PAD
    // +2 for the shell's top/bottom border (content offsetHeight excludes it).
    const fullH = Math.min((contentRef.current?.offsetHeight ?? PILL) + 2, maxH)
    const iconCenter = r.top + ICON / 2
    const expandedTop = Math.min(Math.max(iconCenter - fullH / 2, PAD), vh - PAD - fullH)
    setAnchor({ left: r.left + ICON + GAP, collapsedTop: iconCenter - PILL / 2, expandedTop, fullH })
  }, [])

  useLayoutEffect(() => {
    if (open) {
      setRendered(true)
      setSettled(false)
      measure()
      let raf2 = 0
      // Mount collapsed, then expand on the next frame so the transition runs.
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setDeployed(true))
      })
      const settle = setTimeout(() => setSettled(true), OPEN_MS)
      return () => {
        cancelAnimationFrame(raf1)
        cancelAnimationFrame(raf2)
        clearTimeout(settle)
      }
    }
    setDeployed(false)
    setSettled(false)
    const t = setTimeout(() => setRendered(false), 780) // after the full retract
    return () => clearTimeout(t)
  }, [open, measure])

  // Keep the clamp honest as contents reflow (view-mode toggles) or the window
  // resizes while open.
  useEffect(() => {
    if (!rendered) return
    measure()
    window.addEventListener('resize', measure)
    const ro = contentRef.current ? new ResizeObserver(measure) : null
    if (contentRef.current) ro!.observe(contentRef.current)
    return () => {
      window.removeEventListener('resize', measure)
      ro?.disconnect()
    }
  }, [rendered, measure])

  const click = () => {
    setFlash((f) => f + 1)
    onToggle()
  }

  return (
    <Box ref={rowRef} sx={{ position: 'relative', display: 'flex' }}>
      {/* Keyed wrapper replays the pop on every click; the ring/highlight on the
          button itself persists while the panel is on screen. */}
      <Box
        key={flash}
        sx={{
          display: 'flex',
          animation: 'icon-pop 240ms ease',
          '@keyframes icon-pop': {
            '0%': { transform: 'scale(1)' },
            '35%': { transform: 'scale(1.22)' },
            '100%': { transform: 'scale(1)' },
          },
        }}
      >
        <Box
          component="button"
          onClick={click}
          aria-label={title}
          title={title}
          sx={{
            width: ICON,
            height: ICON,
            flexShrink: 0,
            display: 'grid',
            placeItems: 'center',
            font: '26px/1 ui-monospace, SFMono-Regular, Menlo, monospace',
            color: HUD,
            // Lit while the panel is on screen (stays lit through the retract),
            // with a detached reticle-style lock ring for emphasis.
            background: rendered ? 'rgba(127, 212, 255, 0.18)' : 'transparent',
            border: '1px solid',
            borderColor: rendered ? '#7fd4ff' : 'rgba(127, 212, 255, 0.4)',
            borderRadius: '10px',
            outline: rendered ? '1px solid rgba(127, 212, 255, 0.7)' : '1px solid transparent',
            outlineOffset: rendered ? '4px' : '0px',
            boxShadow: rendered ? '0 0 14px rgba(127, 212, 255, 0.45)' : 'none',
            cursor: 'pointer',
            transition:
              'background 180ms, border-color 180ms, outline-offset 200ms, box-shadow 200ms',
            zIndex: PANEL_Z + 1,
            '&:hover': { borderColor: '#7fd4ff' },
          }}
        >
          {icon}
        </Box>
      </Box>

      {rendered && (
        <Box
          sx={{
            position: 'fixed',
            left: anchor ? `${anchor.left}px` : ICON + GAP,
            // Circle starts at the icon center; the box slides up to the clamped
            // top as it grows, so top/bottom edges travel independently.
            top: `${anchor ? (deployed ? anchor.expandedTop : anchor.collapsedTop) : 0}px`,
            width: deployed ? width : PILL,
            height: 'auto',
            minHeight: PILL,
            maxHeight: deployed ? `${anchor?.fullH ?? 0}px` : `${PILL}px`,
            opacity: deployed ? 1 : 0,
            overflow: 'hidden',
            bgcolor: 'rgba(4, 14, 28, 0.92)',
            border: '1px solid rgba(127, 212, 255, 0.35)',
            borderRadius: deployed ? '10px' : `${PILL / 2}px`,
            backdropFilter: 'blur(6px)',
            transition: deployed ? (settled ? STEADY_TR : OPEN_TR) : CLOSE_TR,
            zIndex: PANEL_Z,
            '&::after': deployed
              ? {
                  content: '""',
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: 0,
                  height: '2px',
                  background:
                    'linear-gradient(90deg, transparent, rgba(127, 212, 255, 0.8), transparent)',
                  animation: 'console-scan 420ms linear 690ms 1',
                  '@keyframes console-scan': {
                    '0%': { top: 0, opacity: 1 },
                    '100%': { top: '100%', opacity: 0 },
                  },
                }
              : undefined,
          }}
        >
          {/* Fixed-width contents so the horizontal grow just reveals them; also
              the height source the clamp measures. */}
          <Box
            ref={contentRef}
            sx={{
              width,
              p: 2,
              opacity: deployed ? 1 : 0,
              transition: deployed ? 'opacity 200ms linear 690ms' : 'opacity 140ms linear 0ms',
            }}
          >
            {children}
          </Box>
        </Box>
      )}
    </Box>
  )
}
