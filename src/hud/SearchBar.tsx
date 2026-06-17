import { useEffect, useRef, useState } from 'react'
import { Box, InputBase, Paper } from '@mui/material'
import type { Candidate } from '../data/GraphSource'
import { HUD_TEXT, MONO, MONO_SMALL, PANEL_SX } from './hudStyles'

interface Props {
  // Returns candidates for a query (text search over the active source).
  onSearch: (query: string) => Promise<Candidate[]>
  // Land on a chosen candidate (fresh entry / re-anchor).
  onPick: (id: string) => void
}

// Long-range scanner: type to find a node anywhere in the dataset (not just the
// current view) and jump to it. Debounced text search via the GraphSource;
// Enter takes the top hit, ↑/↓ move the cursor, Esc clears.
export function SearchBar({ onSearch, onPick }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Candidate[]>([])
  const [cursor, setCursor] = useState(0)
  const [focused, setFocused] = useState(false)
  // Guard against out-of-order async results: only the latest query's results win.
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

  const pick = (id: string) => {
    setQuery('')
    setResults([])
    setFocused(false)
    onPick(id)
  }

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
      pick(results[cursor].id)
    }
  }

  const open = focused && results.length > 0

  return (
    <Box sx={{ position: 'absolute', top: 28, left: '50%', transform: 'translateX(-50%)', width: 360 }}>
      <Paper
        elevation={4}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 0.5,
          ...PANEL_SX,
          borderRadius: open ? '10px 10px 0 0' : '10px',
        }}
      >
        <Box component="span" sx={{ font: MONO, color: 'primary.main', opacity: 0.8 }}>
          ⌖
        </Box>
        <InputBase
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          // Delay blur so a result click registers before the list unmounts.
          onBlur={() => setTimeout(() => setFocused(false), 120)}
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
      </Paper>

      {open && (
        <Paper
          elevation={6}
          sx={{
            ...PANEL_SX,
            borderTop: 'none',
            borderRadius: '0 0 10px 10px',
            maxHeight: 280,
            overflowY: 'auto',
          }}
        >
          {results.map((r, i) => (
            <Box
              key={r.id}
              onMouseDown={(e) => e.preventDefault()} // keep focus so onBlur doesn't fire first
              onClick={() => pick(r.id)}
              onMouseEnter={() => setCursor(i)}
              sx={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: 1,
                px: 1.5,
                py: 0.75,
                cursor: 'pointer',
                bgcolor: i === cursor ? 'rgba(127, 212, 255, 0.14)' : 'transparent',
                borderTop: i === 0 ? 'none' : '1px solid rgba(127, 212, 255, 0.08)',
              }}
            >
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
          ))}
        </Paper>
      )}
    </Box>
  )
}
