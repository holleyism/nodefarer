import { useEffect, useRef, useState } from 'react'
import { Box, InputBase, Typography } from '@mui/material'
import type { Candidate } from '../data/GraphSource'
import { HUD_TEXT, MONO, MONO_SMALL } from './hudStyles'

interface Props {
  // Returns candidates for a query (text search over the active source).
  onSearch: (query: string) => Promise<Candidate[]>
  // Land on a chosen candidate (fresh entry / re-anchor).
  onPick: (id: string) => void
}

// Long-range scanner contents (rendered inside a DeployPanel). Type to find a
// node anywhere in the dataset and jump to it. Debounced text search via the
// GraphSource; Enter takes the top hit, ↑/↓ move the cursor, Esc clears.
export function SearchBar({ onSearch, onPick }: Props) {
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

  const pick = (id: string) => {
    setQuery('')
    setResults([])
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
        <Box sx={{ mt: 1, maxHeight: 260, overflowY: 'auto', mx: -0.5 }}>
          {results.map((r, i) => (
            <Box
              key={r.id}
              onMouseDown={(e) => e.preventDefault()} // keep input focus
              onClick={() => pick(r.id)}
              onMouseEnter={() => setCursor(i)}
              sx={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: 1,
                px: 1,
                py: 0.75,
                borderRadius: '4px',
                cursor: 'pointer',
                bgcolor: i === cursor ? 'rgba(127, 212, 255, 0.14)' : 'transparent',
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
        </Box>
      )}
    </>
  )
}
