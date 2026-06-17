import { useLayoutEffect, useRef, useState } from 'react'
import { Box, LinearProgress, Typography } from '@mui/material'
import { BAR_HEIGHT } from './BottomBar'
import { HUD_TEXT, MONO } from './hudStyles'

type Pt = [number, number]

// Live pixel size of a slab, for drawing the recessed pockets at a fixed
// inset/rib regardless of the (responsive) door width.
function useSize() {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) =>
      setSize({ w: e.contentRect.width, h: e.contentRect.height }),
    )
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

// Inset a triangle inward by d (uniform perpendicular offset → incircle
// shrink), so the flush metal left between/around pockets forms even beams.
function insetTriangle(verts: Pt[], d: number): Pt[] {
  // ensure CCW so the left normal points inward
  const area =
    (verts[1][0] - verts[0][0]) * (verts[2][1] - verts[0][1]) -
    (verts[2][0] - verts[0][0]) * (verts[1][1] - verts[0][1])
  const v = area < 0 ? [...verts].reverse() : verts
  const n = v.length
  const lines = v.map((a, i) => {
    const b = v[(i + 1) % n]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy) || 1
    const nx = -dy / len
    const ny = dx / len
    return { px: a[0] + nx * d, py: a[1] + ny * d, dx, dy }
  })
  const out: Pt[] = []
  for (let i = 0; i < n; i++) {
    const l1 = lines[(i + n - 1) % n]
    const l2 = lines[i]
    const det = l1.dx * -l2.dy - -l2.dx * l1.dy
    const t = ((l2.px - l1.px) * -l2.dy - -l2.dx * (l2.py - l1.py)) / (det || 1)
    out.push([l1.px + l1.dx * t, l1.py + l1.dy * t])
  }
  return out
}

const SHADOW = 'rgba(0, 0, 0, 0.62)'
const LIT = 'rgba(170, 223, 255, 0.5)'

// One recessed triangular pocket: dark floor (darkest top-left), upper-left
// lip edges in shadow, lower-right walls lit — light from top-left.
function Pocket({ verts, id }: { verts: Pt[]; id: string }) {
  const pts = verts.map((v) => v.join(',')).join(' ')
  const edges = verts.map((a, i) => {
    const b = verts[(i + 1) % verts.length]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy) || 1
    // outward normal (CCW assumed from insetTriangle): faces up/left → shadow
    const outN = dy / len + -dx / len
    return { a, b, lit: outN > 0 }
  })
  return (
    <g>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgba(0, 0, 0, 0.66)" />
          <stop offset="100%" stopColor="rgba(0, 0, 0, 0.24)" />
        </linearGradient>
      </defs>
      <polygon points={pts} fill={`url(#${id})`} />
      {edges.map((e, i) => (
        <line
          key={i}
          x1={e.a[0]}
          y1={e.a[1]}
          x2={e.b[0]}
          y2={e.b[1]}
          stroke={e.lit ? LIT : SHADOW}
          strokeWidth={e.lit ? 2 : 2.5}
        />
      ))}
    </g>
  )
}

// Structural beam widths: the frame border is PANEL_INSET + RIB; the diagonal
// rib is 2 * RIB. Frame ~104px (double the original), diagonal ~78px (1.5x).
const PANEL_INSET = 65
const RIB = 39
const RIVET_SPACING = 80
const RIVET_R = 4.5

// Evenly spaced points from a to b; `inclEnd` keeps b (drop it when chaining
// segments so shared corners aren't doubled).
function linePoints(a: Pt, b: Pt, spacing: number, inclEnd: boolean): Pt[] {
  const dist = Math.hypot(b[0] - a[0], b[1] - a[1])
  const n = Math.max(1, Math.round(dist / spacing))
  const out: Pt[] = []
  for (let i = 0; i < (inclEnd ? n + 1 : n); i++) {
    const t = i / n
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
  }
  return out
}

// Embossed bolt heads along the structural members. Each is a raised dome:
// a cast shadow below-right plus a top-left-lit radial face.
function Rivets({ points, id }: { points: Pt[]; id: string }) {
  return (
    <g>
      <defs>
        <radialGradient id={id} fx="0.34" fy="0.34" r="0.7">
          <stop offset="0%" stopColor="rgba(190, 225, 255, 0.55)" />
          <stop offset="45%" stopColor="rgba(80, 110, 150, 0.3)" />
          <stop offset="100%" stopColor="rgba(0, 0, 0, 0.45)" />
        </radialGradient>
      </defs>
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p[0] + 1} cy={p[1] + 1.3} r={RIVET_R} fill="rgba(0, 0, 0, 0.5)" />
          <circle cx={p[0]} cy={p[1]} r={RIVET_R} fill={`url(#${id})`} />
        </g>
      ))}
    </g>
  )
}

// Two recessed right-triangle pockets split by a corner-to-corner diagonal.
// `down` = '/' (bottom-left→top-right); `up` = '\' (top-left→bottom-right).
function DoorPanels({ dir, w, h }: { dir: 'down' | 'up'; w: number; h: number }) {
  if (w === 0 || h === 0) return null
  const m = PANEL_INSET
  const TL: Pt = [m, m]
  const TR: Pt = [w - m, m]
  const BL: Pt = [m, h - m]
  const BR: Pt = [w - m, h - m]
  const tris: Pt[][] =
    dir === 'down'
      ? [
          [TL, TR, BL], // upper-left, right angle at TL
          [TR, BR, BL], // lower-right, right angle at BR
        ]
      : [
          [TL, TR, BR], // upper-right, right angle at TR
          [TL, BR, BL], // lower-left, right angle at BL
        ]

  // Rivets run down the centerline of each structural member: the frame ring
  // (midway through the border) and the diagonal.
  const ci = (PANEL_INSET + RIB) / 2
  const rA: Pt = [ci, ci]
  const rB: Pt = [w - ci, ci]
  const rC: Pt = [w - ci, h - ci]
  const rD: Pt = [ci, h - ci]
  const frame = [
    ...linePoints(rA, rB, RIVET_SPACING, false),
    ...linePoints(rB, rC, RIVET_SPACING, false),
    ...linePoints(rC, rD, RIVET_SPACING, false),
    ...linePoints(rD, rA, RIVET_SPACING, false),
  ]
  // Diagonal centerline = inner-rect corner to corner; trim the ends so rivets
  // don't crowd the frame corners.
  const [dStart, dEnd] = dir === 'down' ? [BL, TR] : [TL, BR]
  const diagonal = linePoints(dStart, dEnd, RIVET_SPACING, true).slice(1, -1)

  return (
    <Box
      component="svg"
      sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    >
      {tris.map((t, i) => (
        <Pocket key={i} verts={insetTriangle(t, RIB)} id={`pocket-${dir}-${i}`} />
      ))}
      <Rivets points={[...frame, ...diagonal]} id={`rivet-${dir}`} />
    </Box>
  )
}

const DOOR_EASE = 'transform 700ms cubic-bezier(0.7, 0, 0.3, 1)'
const STRIPES =
  'repeating-linear-gradient(45deg, rgba(127, 212, 255, 0.16) 0 14px, transparent 14px 28px)'
const METAL_TOP = 'linear-gradient(180deg, #0b1322 0%, #0e1a2c 60%, #16263d 100%)'
const METAL_BOTTOM = 'linear-gradient(0deg, #0b1322 0%, #0e1a2c 60%, #16263d 100%)'

// Big square interlocking chunks at the seam: top door fills the left block of
// each tile, bottom door the right block, so the fingers mesh when shut. A few
// px of gap between fingers leaves a dark interlock line.
const CHUNK_W = 72
const CHUNK_H = 26
const CHUNK_GAP = 4
const CHUNK_FILL = '#1b2c47'
const CHUNK_EDGE = 'rgba(127, 212, 255, 0.5)'

function Chunks({ dir }: { dir: 'down' | 'up' }) {
  const id = `chunks-${dir}`
  const x = dir === 'down' ? CHUNK_GAP / 2 : CHUNK_W + CHUNK_GAP / 2
  return (
    <Box
      component="svg"
      sx={{
        position: 'absolute',
        left: 0,
        right: 0,
        [dir === 'down' ? 'top' : 'bottom']: '100%',
        width: '100%',
        height: CHUNK_H,
        display: 'block',
        overflow: 'visible',
        filter: 'drop-shadow(0 0 6px rgba(0, 0, 0, 0.6))',
      }}
    >
      <defs>
        <pattern id={id} width={CHUNK_W * 2} height={CHUNK_H} patternUnits="userSpaceOnUse">
          <rect
            x={x}
            y={0}
            width={CHUNK_W - CHUNK_GAP}
            height={CHUNK_H}
            fill={CHUNK_FILL}
            stroke={CHUNK_EDGE}
            strokeWidth={1}
          />
        </pattern>
      </defs>
      <rect width="100%" height={CHUNK_H} fill={`url(#${id})`} />
    </Box>
  )
}

interface Props {
  closed: boolean
  label: string
  // Fires when the doors have finished shutting (so a view swap can wait for a
  // full cover before changing the scene).
  onClosed?: () => void
}

// Blast doors behind the window glass: they shut while the universe is being
// (re)laid out — force-layout motion is never shown — and part vertically to
// present the settled graph. They sit above the scene but below the viewport
// frame, reticle layer, and instrument panels, and swallow pointer input while
// closed.
//
// The interlocking teeth ride in a layer BEHIND both door bodies: while the
// doors are closing they mesh across the shrinking gap, but once the bodies
// meet flush at the seam they tuck fully behind the opposing door — leaving
// just the two warning stripes touching.
export function BlastDoors({ closed, label, onClosed }: Props) {
  const [topRef, topSize] = useSize()
  const [botRef, botSize] = useSize()
  // Open travel must clear the projecting seam teeth, not just the body edge,
  // or a row of teeth peeks in at the viewport edge.
  const topShut = closed ? 'translateY(0)' : 'translateY(-135%)'
  const botShut = closed ? 'translateY(0)' : 'translateY(135%)'
  return (
    <Box
      data-testid="blast-doors"
      sx={{
        position: 'absolute',
        inset: `0 0 ${BAR_HEIGHT}px 0`,
        zIndex: 30,
        overflow: 'hidden',
        pointerEvents: closed ? 'auto' : 'none',
      }}
    >
      {/* teeth layer — behind both bodies */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '50%',
          transform: topShut,
          transition: DOOR_EASE,
        }}
      >
        <Chunks dir="down" />
      </Box>
      <Box
        sx={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: '50%',
          transform: botShut,
          transition: DOOR_EASE,
        }}
      >
        <Chunks dir="up" />
      </Box>

      {/* top body */}
      <Box
        ref={topRef}
        onTransitionEnd={(e) => {
          // One signal per close: only the body's transform, only when shut.
          if (closed && e.propertyName === 'transform') onClosed?.()
        }}
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '50%',
          transform: topShut,
          transition: DOOR_EASE,
          background: METAL_TOP,
          boxShadow: '0 10px 34px rgba(0, 0, 0, 0.85)',
        }}
      >
        <DoorPanels dir="down" w={topSize.w} h={topSize.h} />
        <Box
          sx={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 12,
            background: STRIPES,
            borderBottom: '1px solid rgba(127, 212, 255, 0.3)',
          }}
        />
      </Box>

      {/* bottom body */}
      <Box
        ref={botRef}
        sx={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: '50%',
          transform: botShut,
          transition: DOOR_EASE,
          background: METAL_BOTTOM,
          boxShadow: '0 -10px 34px rgba(0, 0, 0, 0.85)',
        }}
      >
        <DoorPanels dir="up" w={botSize.w} h={botSize.h} />
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 12,
            background: STRIPES,
            borderTop: '1px solid rgba(127, 212, 255, 0.3)',
          }}
        />
      </Box>

      {/* status on the seam — appears once the slabs have met */}
      <Box
        sx={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 320,
          textAlign: 'center',
          zIndex: 1,
          opacity: closed ? 1 : 0,
          transition: closed ? 'opacity 250ms 600ms' : 'opacity 120ms',
        }}
      >
        <Typography
          sx={{ font: MONO, letterSpacing: 3, textTransform: 'uppercase', color: HUD_TEXT, mb: 1 }}
        >
          {label}
        </Typography>
        <LinearProgress />
      </Box>
    </Box>
  )
}
