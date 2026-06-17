import { useState } from 'react'
import { Box } from '@mui/material'
import { DeployPanel } from './DeployPanel'
import { PANEL_Z } from './hudStyles'

export interface RailItem {
  id: string
  icon: React.ReactNode
  title: string
  width?: number
  content: React.ReactNode
}

// The activation rail: a stack of DeployPanels down the top-left. One open at a
// time — opening any panel retracts the others.
export function ConsoleRail({ items }: { items: RailItem[] }) {
  const [openId, setOpenId] = useState<string | null>(null)
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
          open={openId === it.id}
          onToggle={() => setOpenId((cur) => (cur === it.id ? null : it.id))}
        >
          {it.content}
        </DeployPanel>
      ))}
    </Box>
  )
}
