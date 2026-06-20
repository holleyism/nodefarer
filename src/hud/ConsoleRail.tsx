import { Box } from '@mui/material'
import { DeployPanel } from './DeployPanel'
import { PANEL_Z } from './hudStyles'

// Content may be a node, or a render fn given a `close` (so a panel like search
// can retract itself after acting).
export interface RailItem {
  id: string
  icon: React.ReactNode
  title: string
  width?: number
  // Identity of the contents; changing it on an open panel cross-fades. Defaults
  // to the item id (stable → no swap animation).
  contentKey?: string
  content: React.ReactNode | ((api: { close: () => void }) => React.ReactNode)
}

// The activation rail: a stack of DeployPanels down the top-left. One open at a
// time — opening any panel retracts the others. Controlled so selection (the
// inspector) and the icons can both drive which panel is open.
interface Props {
  items: RailItem[]
  openId: string | null
  onOpenChange: (id: string | null) => void
  // Dim + disable the whole rail (e.g. while a guided tour drives the view, so
  // manual panels can't desync the narration).
  locked?: boolean
  // When locked, this one panel stays full-opacity and readable (but still
  // inert) instead of dimming with the rest — the inspector a tour opens, so the
  // viewer can read the node it's narrating without being able to click through.
  readOnlyId?: string | null
}

export function ConsoleRail({ items, openId, onOpenChange, locked = false, readOnlyId = null }: Props) {
  return (
    <Box
      sx={{
        position: 'absolute',
        top: 24,
        left: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.25,
        zIndex: PANEL_Z,
      }}
    >
      {items.map((it) => {
        // Locked: everything is inert; the readOnly panel stays bright, the rest dim.
        const dimmed = locked && it.id !== readOnlyId
        return (
          <Box
            key={it.id}
            aria-hidden={dimmed || undefined}
            sx={{
              opacity: dimmed ? 0.3 : 1,
              pointerEvents: locked ? 'none' : 'auto',
              transition: 'opacity 220ms ease',
            }}
          >
            <DeployPanel
              icon={it.icon}
              title={it.title}
              width={it.width}
              contentKey={it.contentKey ?? it.id}
              open={openId === it.id}
              onToggle={() => onOpenChange(openId === it.id ? null : it.id)}
            >
              {typeof it.content === 'function'
                ? it.content({ close: () => onOpenChange(null) })
                : it.content}
            </DeployPanel>
          </Box>
        )
      })}
    </Box>
  )
}
