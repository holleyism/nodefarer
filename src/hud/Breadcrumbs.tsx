import { Box, Typography } from '@mui/material'
import type { Graph } from '../types'
import { HUD_TEXT, MONO, MONO_SMALL } from './hudStyles'

interface Props {
  trail: string[] // visited node ids, in order (last = current)
  graph: Graph
  currentId: string
  onTravel: (id: string) => void
  onPick?: () => void // close the panel after choosing a crumb
}

// The corridor trail as a vertical timeline (DeployPanel content): the chain of
// stops the ship has parked on, oldest at top, current at bottom. Click an
// earlier stop to rewind (travel back to it). Long trails scroll within the
// panel.
export function Breadcrumbs({ trail, graph, currentId, onTravel, onPick }: Props) {
  return (
    <>
      <Typography sx={{ font: MONO, letterSpacing: 3, color: '#aadfff', mb: 1.5 }}>
        CORRIDOR
      </Typography>

      {trail.length < 2 ? (
        <Typography sx={{ font: MONO_SMALL, color: 'text.secondary' }}>
          No journey yet — double-click a node to travel.
        </Typography>
      ) : (
        trail.map((id, i) => {
          const node = graph.nodeById.get(id)
          const isCurrent = id === currentId
          // Rewind only to a stop still present in the current view.
          const clickable = !isCurrent && !!node
          return (
            <Box
              key={id}
              component={clickable ? 'button' : 'div'}
              onClick={
                clickable
                  ? () => {
                      onPick?.()
                      onTravel(id)
                    }
                  : undefined
              }
              title={node?.name ?? id}
              sx={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 1,
                width: '100%',
                textAlign: 'left',
                border: 'none',
                background: isCurrent ? 'rgba(127, 212, 255, 0.12)' : 'transparent',
                borderRadius: '6px',
                px: 0.75,
                py: 0.6,
                cursor: clickable ? 'pointer' : 'default',
                '&:hover': clickable ? { background: 'rgba(127, 212, 255, 0.08)' } : {},
              }}
            >
              {/* timeline marker + connector */}
              <Box
                sx={{
                  flexShrink: 0,
                  width: 12,
                  alignSelf: 'stretch',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                }}
              >
                <Box
                  component="span"
                  sx={{ font: MONO_SMALL, lineHeight: 1.4, color: isCurrent ? '#7fd4ff' : 'rgba(127,212,255,0.6)' }}
                >
                  {isCurrent ? '◉' : '○'}
                </Box>
                {i < trail.length - 1 && (
                  <Box sx={{ flex: 1, width: '1px', minHeight: 8, background: 'rgba(127,212,255,0.25)', mt: 0.25 }} />
                )}
              </Box>
              <Typography
                sx={{
                  font: MONO_SMALL,
                  letterSpacing: 0.5,
                  lineHeight: 1.4,
                  textTransform: 'uppercase',
                  color: isCurrent ? HUD_TEXT : clickable ? '#aadfff' : 'rgba(170,223,255,0.4)',
                }}
              >
                {node?.name ?? id}
              </Typography>
            </Box>
          )
        })
      )}
    </>
  )
}
