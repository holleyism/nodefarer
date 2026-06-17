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
}

export function ConsoleRail({ items, openId, onOpenChange }: Props) {
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
      {items.map((it) => (
        <DeployPanel
          key={it.id}
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
      ))}
    </Box>
  )
}
