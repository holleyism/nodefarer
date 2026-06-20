import { useEffect, useRef, useState } from 'react'
import { Box, InputBase, Typography } from '@mui/material'
import type { Candidate } from '../data/GraphSource'
import { HUD_TEXT, MONO, MONO_SMALL } from './hudStyles'

interface Props {
  // Returns candidates for a query (text search over the active source).
  onSearch: (query: string) => Promise<Candidate[]>
  // Plot a course: build + fly the shortest path from the CURRENT node to the
  // hit (reveals the connecting corridor). The primary action — discovery by
  // journey, not teleport.
  onPlotCourse: (id: string) => void
  // Jump: re-anchor the universe on the hit (the old behavior — a fresh entry).
  onJump: (id: string) => void
}

// Long-range scanner contents (rendered inside a DeployPanel). Type to find a
// node anywhere in the dataset, then either plot a course to it from where you
// are (the path reveals how they connect) or jump straight to it. Debounced
// text search via the GraphSource; Enter plots a course to the top hit,
// Shift+Enter jumps, ↑/↓ move the cursor, Esc clears.
export function SearchBar({ onSearch, onPlotCourse, onJump }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Candidate[]>([])
  const [cursor, setCursor] = useState(0)
  // Guard against out-of-order async results: only the latest query's win.
  const seq = useRef(0)

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults([])
      return
    }
    const mine = ++seq.current
    const t = setTimeout(async () => {
      const hits = await onSearch(q)
      if (mine === seq.current) {
        setResults(hits)
        setCursor(0)
      }
    }, 180)
    return () => clearTimeout(t)
  }, [query, onSearch])

  const act = (id: string, go: (id: string) => void) => {
    setQuery('')
    setResults([])
    go(id)
  }
  const plot = (id: string) => act(id, onPlotCourse)
  const jump = (id: string) => act(id, onJump)

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setQuery('')
      setResults([])
      ;(e.target as HTMLElement).blur()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => Math.min(c + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(c - 1, 0))
    } else if (e.key === 'Enter' && results[cursor]) {
      // Enter = plot a course (the primary action); Shift+Enter = jump.
      e.shiftKey ? jump(results[cursor].id) : plot(results[cursor].id)
    }
  }

  return (
    <>
      <Typography sx={{ font: MONO, letterSpacing: 3, color: '#aadfff', mb: 1.5 }}>
        SCANNER
      </Typography>

      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.25,
          py: 0.75,
          border: '1px solid rgba(127, 212, 255, 0.45)',
          borderRadius: '6px',
        }}
      >
        <Box component="span" sx={{ font: MONO, color: 'primary.main', opacity: 0.8 }}>
          ⌖
        </Box>
        <InputBase
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="SEARCH NODES…"
          sx={{
            flex: 1,
            font: MONO,
            letterSpacing: 1,
            color: HUD_TEXT,
            '& input': { padding: 0 },
            '& input::placeholder': { color: 'rgba(170, 223, 255, 0.4)', opacity: 1 },
          }}
        />
      </Box>

      {results.length > 0 && (
        <Box sx={{ mt: 1, maxHeight: 280, overflowY: 'auto', mx: -0.5 }}>
          {results.map((r, i) => (
            <Box
              key={r.id}
              onMouseDown={(e) => e.preventDefault()} // keep input focus
              onMouseEnter={() => setCursor(i)}
              sx={{
                px: 1,
                py: 0.75,
                borderRadius: '4px',
                bgcolor: i === cursor ? 'rgba(127, 212, 255, 0.14)' : 'transparent',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1 }}>
                <Box
                  sx={{
                    font: MONO,
                    color: HUD_TEXT,
                    textTransform: 'uppercase',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {r.name}
                </Box>
                {r.score != null && (
                  <Box sx={{ font: MONO_SMALL, color: 'text.secondary', flexShrink: 0 }}>
                    {r.score < 0.01 ? r.score.toExponential(1) : r.score.toFixed(3)}
                  </Box>
                )}
              </Box>
              <Box sx={{ display: 'flex', gap: 0.75, mt: 0.75 }}>
                <ActionChip primary onClick={() => plot(r.id)}>
                  ⇝ Plot course
                </ActionChip>
                <ActionChip onClick={() => jump(r.id)}>⤴ Jump</ActionChip>
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </>
  )
}

// A compact action button used per search hit. `primary` is the plot-course
// call-to-action (filled); the default ghost variant is the secondary jump.
function ActionChip({
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
        font: MONO_SMALL,
        letterSpacing: 1,
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        px: 1,
        py: 0.4,
        borderRadius: 999,
        color: primary ? '#02030a' : '#aadfff',
        background: primary ? '#7fd4ff' : 'transparent',
        border: '1px solid rgba(127, 212, 255, 0.45)',
        '&:hover': { borderColor: '#7fd4ff', background: primary ? '#7fd4ff' : 'rgba(127, 212, 255, 0.14)' },
      }}
    >
      {children}
    </Box>
  )
}
