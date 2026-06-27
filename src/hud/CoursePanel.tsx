import { Box, Slider, Stack, Typography } from '@mui/material'
import type { Graph } from '../types'
import { HUD_TEXT, MONO, MONO_SMALL } from './hudStyles'

interface Props {
  // The plotted course: ordered node ids, current node first, destination last.
  route: string[]
  graph: Graph
  onTravel: () => void
  onClear: () => void
  // Course-scrub: ride the route by scroll wheel instead of flying it in one
  // shot. scrubIndex = the route node the ship is currently nearest; onDock
  // commits the preview at that node. scrubStep = arc-length per wheel delta
  // (the "how far each scroll jumps" knob); onScrubStep sets it live.
  scrubMode: boolean
  scrubIndex: number
  scrubStep: number
  onScrubStep: (value: number) => void
  onToggleScrub: () => void
  onDock: (index: number) => void
}

// The scanner's "course plotted" view — it replaces the search box once a course
// is plotted. Describes the route (its stops) and offers Travel (fly it), Scrub
// (ride it manually by wheel), or Clear (back to search). The route itself is
// highlighted out in the scene.
export function CoursePanel({ route, graph, onTravel, onClear, scrubMode, scrubIndex, scrubStep, onScrubStep, onToggleScrub, onDock }: Props) {
  const name = (id: string) => graph.nodeById.get(id)?.name ?? id
  const hops = Math.max(0, route.length - 1)
  const destination = route[route.length - 1]
  // While scrubbing, the stop the ship is nearest — Dock commits here.
  const nearIdx = Math.max(0, Math.min(scrubIndex, route.length - 1))

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 1.5 }}>
        <Typography sx={{ font: MONO, letterSpacing: 3, color: '#ffce7a' }}>COURSE PLOTTED</Typography>
        <Typography sx={{ font: MONO_SMALL, color: 'text.secondary' }}>
          {hops} hop{hops === 1 ? '' : 's'}
        </Typography>
      </Box>

      {/* The stops down the corridor — current node at top, destination emphasized. */}
      <Stack spacing={0} sx={{ mb: 1.75 }}>
        {route.map((id, i) => {
          const isDest = i === route.length - 1
          const isCurrent = i === 0
          // While scrubbing, a ► rides the list to the stop the ship is nearest.
          const isShip = scrubMode && i === nearIdx
          return (
            <Box key={id} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
              <Box
                sx={{
                  font: MONO_SMALL,
                  color: isShip ? '#7fd4ff' : isDest ? '#ffce7a' : isCurrent ? HUD_TEXT : 'rgba(255, 206, 122, 0.55)',
                  width: 14,
                  flexShrink: 0,
                  lineHeight: '1.5',
                  textAlign: 'center',
                }}
              >
                {isShip ? '►' : isCurrent ? '◉' : isDest ? '◆' : '·'}
              </Box>
              <Typography
                sx={{
                  font: MONO_SMALL,
                  lineHeight: 1.5,
                  textTransform: 'uppercase',
                  color: isDest ? '#ffe6bd' : isCurrent ? HUD_TEXT : 'text.secondary',
                  pb: i === route.length - 1 ? 0 : 0.5,
                }}
              >
                {name(id)}
              </Typography>
            </Box>
          )
        })}
      </Stack>

      {scrubMode ? (
        <>
          {/* Live dock target — its own full-width line so a long node name
              ellipsizes here instead of stretching the Dock button and shoving
              Stop off the panel edge. */}
          <Typography
            sx={{
              font: MONO_SMALL,
              color: '#ffce7a',
              mb: 0.75,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {nearIdx > 0 ? `Dock at: ${name(route[nearIdx])}` : 'Scroll to travel the course'}
          </Typography>
          <Stack direction="row" spacing={1}>
            <CourseButton primary onClick={() => onDock(nearIdx)}>
              ⚓ Dock
            </CourseButton>
            <CourseButton onClick={onToggleScrub}>✕ Stop</CourseButton>
          </Stack>
          <Typography sx={{ font: MONO_SMALL, color: 'text.secondary', mt: 1 }}>
            Scroll to travel the course · Shift+scroll to zoom · Enter to dock.
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 1 }}>
            <Typography sx={{ font: MONO_SMALL, letterSpacing: 1, color: 'text.secondary' }}>STEP</Typography>
            <Typography sx={{ font: MONO_SMALL, color: '#ffce7a' }}>{Math.round(scrubStep * 100)}</Typography>
          </Box>
          <Slider
            size="small"
            min={3}
            max={60}
            step={1}
            value={Math.round(scrubStep * 100)}
            onChange={(_, v) => onScrubStep((v as number) / 100)}
            aria-label="Scroll step"
            sx={{
              mt: -0.5,
              width: 'calc(100% - 14px)',
              color: '#ffce7a',
              '& .MuiSlider-thumb': { width: 12, height: 12 },
            }}
          />
          <Typography sx={{ font: MONO_SMALL, color: 'text.secondary', mt: -0.5 }}>
            How far each scroll jumps along the course. Lower = finer; raise it for
            long, many-hop routes.
          </Typography>
        </>
      ) : (
        <>
          <Stack direction="row" spacing={1}>
            <CourseButton primary onClick={onTravel}>
              ▸ Travel
            </CourseButton>
            <CourseButton onClick={onToggleScrub}>↻ Scrub</CourseButton>
            <CourseButton onClick={onClear}>✕ Clear</CourseButton>
          </Stack>
          <Typography sx={{ font: MONO_SMALL, color: 'text.secondary', mt: 1 }}>
            Destination: {name(destination)}
          </Typography>
        </>
      )}
    </>
  )
}

function CourseButton({
  children,
  onClick,
  primary = false,
}: {
  children: React.ReactNode
  onClick: () => void
  primary?: boolean
}) {
  return (
    <Box
      component="button"
      onClick={onClick}
      sx={{
        flex: primary ? 1 : 'none',
        font: MONO_SMALL,
        letterSpacing: 1,
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        px: 1.5,
        py: 0.6,
        borderRadius: 999,
        color: primary ? '#1a1206' : '#ffce7a',
        background: primary ? '#ffce7a' : 'transparent',
        border: '1px solid rgba(255, 206, 122, 0.5)',
        '&:hover': { borderColor: '#ffce7a', background: primary ? '#ffd98f' : 'rgba(255, 206, 122, 0.14)' },
      }}
    >
      {children}
    </Box>
  )
}
