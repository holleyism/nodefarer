import { Box, Slider, Typography } from '@mui/material'
import type { Predicate } from '../data/GraphSource'
import type { GraphSchema, SchemaProperty } from '../data/graphSchema'
import { RangePills } from './ValuePill'

const MONO = '11px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace'
const MONO_SMALL = '10px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace'

interface Props {
  schema: GraphSchema
  predicate: Predicate
  onChange: (p: Predicate) => void
}

const fmt = (v: number) => (Math.abs(v) >= 1 || v === 0 ? String(Math.round(v * 100) / 100) : v.toExponential(1))
const stepFor = (lo: number, hi: number) => {
  const span = hi - lo
  if (span <= 1) return span / 100 || 0.001
  if (span < 20) return 0.1
  return 1
}

const SECTION_SX = { font: MONO, letterSpacing: 3, color: '#aadfff', mt: 1.5, mb: 0.5 }
const LABEL_SX = { font: MONO, letterSpacing: 1.5, color: 'text.secondary', mt: 1.25 }
const CHIPS_SX = { display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 } as const

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <Box
      component="button"
      onClick={onClick}
      sx={{
        font: MONO_SMALL,
        letterSpacing: 1,
        textTransform: 'uppercase',
        padding: '3px 8px',
        color: on ? '#02030a' : '#aadfff',
        background: on ? '#7fd4ff' : 'transparent',
        border: '1px solid rgba(127, 212, 255, 0.45)',
        borderRadius: '6px',
        cursor: 'pointer',
        // Wrap long category/field names instead of overflowing past the
        // scrollbar (which would clip them on the right).
        whiteSpace: 'normal',
        textAlign: 'left',
        maxWidth: '100%',
        wordBreak: 'break-word',
      }}
    >
      {label}
    </Box>
  )
}

// Schema-driven view filter, sectioned into NODE and EDGE. Controls are rendered
// by plain functions (NOT inline components) so the <Slider> reconciles in place
// across re-renders — defining a component inline would give it a new identity
// each render and remount the slider mid-drag, dropping the pointer lock.
export function FilterPanel({ schema, predicate, onChange }: Props) {
  const has = (o?: Record<string, unknown>) => o != null && Object.keys(o).length > 0
  const active =
    predicate.nodeTypes != null ||
    predicate.relTypes != null ||
    has(predicate.num) ||
    has(predicate.cat) ||
    has(predicate.edgeNum) ||
    has(predicate.edgeCat)

  const toggleInList = (field: 'nodeTypes' | 'relTypes', value: string, all: string[]) => {
    const current = predicate[field] ?? all
    const next = current.includes(value) ? current.filter((x) => x !== value) : [...current, value]
    const collapse = next.length === all.length || next.length === 0
    onChange({ ...predicate, [field]: collapse ? undefined : next })
  }

  const setNum = (field: 'num' | 'edgeNum', key: string, r: { min?: number; max?: number } | undefined) => {
    const map: Record<string, { min?: number; max?: number }> = { ...predicate[field] }
    if (r) map[key] = r
    else delete map[key]
    onChange({ ...predicate, [field]: Object.keys(map).length ? map : undefined })
  }

  const toggleCat = (field: 'cat' | 'edgeCat', key: string, value: string, all: string[]) => {
    const current = predicate[field]?.[key] ?? all
    const next = current.includes(value) ? current.filter((x) => x !== value) : [...current, value]
    const map: Record<string, string[]> = { ...predicate[field] }
    if (next.length === all.length || next.length === 0) delete map[key]
    else map[key] = next
    onChange({ ...predicate, [field]: Object.keys(map).length ? map : undefined })
  }

  // Plain render helpers — return JSX inline (no new component type per render).
  const renderNum = (p: SchemaProperty, field: 'num' | 'edgeNum') => {
    const [rawLo, hi] = p.range!
    // A sub-1 fractional minimum (e.g. PageRank 5.5e-1) reads as a confusing
    // scientific-notation label — anchor the slider's left at a clean 0 instead.
    const lo = rawLo > 0 && rawLo < 1 ? 0 : rawLo
    const cur = predicate[field]?.[p.key]
    const val: [number, number] = [cur?.min ?? lo, cur?.max ?? hi]
    return (
      <Box key={p.key}>
        <Box sx={{ ...LABEL_SX, display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
          <Typography sx={{ font: MONO, letterSpacing: 1.5, color: 'text.secondary' }}>
            {p.label.toUpperCase()}
          </Typography>
          <RangePills lo={fmt(val[0])} hi={fmt(val[1])} />
        </Box>
        <Slider
          size="small"
          min={lo}
          max={hi}
          step={stepFor(lo, hi)}
          value={val}
          onChange={(_, v) => {
            const [a, b] = v as number[]
            setNum(field, p.key, a <= lo && b >= hi ? undefined : { min: a > lo ? a : undefined, max: b < hi ? b : undefined })
          }}
          aria-label={p.label}
          // Narrower than full so the thumb at max clears the panel scrollbar
          // (padding on a Slider doesn't move its absolutely-positioned rail).
          sx={{ mt: -0.5, mb: 0.5, width: 'calc(100% - 14px)' }}
        />
      </Box>
    )
  }

  const renderCat = (p: SchemaProperty, field: 'cat' | 'edgeCat') => {
    const allowed = predicate[field]?.[p.key] ?? p.categories!
    return (
      <Box key={p.key}>
        <Typography sx={LABEL_SX}>{p.label.toUpperCase()}</Typography>
        <Box sx={CHIPS_SX}>
          {p.categories!.map((c) => (
            <Toggle key={c} label={c} on={allowed.includes(c)} onClick={() => toggleCat(field, p.key, c, p.categories!)} />
          ))}
        </Box>
      </Box>
    )
  }

  const nodeTypeNames = schema.nodeTypes.map((t) => t.name)
  const relTypeNames = schema.relTypes.map((t) => t.name)
  const allowedTypes = predicate.nodeTypes ?? nodeTypeNames
  const allowedRels = predicate.relTypes ?? relTypeNames
  const nodeNum = schema.nodeProperties.filter((p) => p.kind === 'number' && p.range)
  const nodeCat = schema.nodeProperties.filter((p) => p.kind === 'categorical' && p.categories?.length)
  const edgeNum = schema.edgeProperties.filter((p) => p.kind === 'number' && p.range)
  const edgeCat = schema.edgeProperties.filter((p) => p.kind === 'categorical' && p.categories?.length)

  return (
    <>
      <Typography sx={{ font: MONO, letterSpacing: 3, color: '#7fd4ff' }}>FILTER</Typography>

      {/* ── NODES ── */}
      <Typography sx={SECTION_SX}>◆ NODES</Typography>
      {schema.nodeTypes.length > 0 && (
        <>
          <Typography sx={LABEL_SX}>TYPES</Typography>
          <Box sx={CHIPS_SX}>
            {schema.nodeTypes.map((t) => (
              <Toggle
                key={t.name}
                label={t.name}
                on={allowedTypes.includes(t.name)}
                onClick={() => toggleInList('nodeTypes', t.name, nodeTypeNames)}
              />
            ))}
          </Box>
        </>
      )}
      {nodeNum.map((p) => renderNum(p, 'num'))}
      {nodeCat.map((p) => renderCat(p, 'cat'))}

      {/* ── EDGES ── */}
      <Typography sx={SECTION_SX}>↔ EDGES</Typography>
      {schema.relTypes.length > 0 && (
        <>
          <Typography sx={LABEL_SX}>TYPES</Typography>
          <Box sx={CHIPS_SX}>
            {schema.relTypes.map((t) => (
              <Toggle
                key={t.name}
                label={t.name.replace(/_/g, ' ')}
                on={allowedRels.includes(t.name)}
                onClick={() => toggleInList('relTypes', t.name, relTypeNames)}
              />
            ))}
          </Box>
        </>
      )}
      {edgeNum.map((p) => renderNum(p, 'edgeNum'))}
      {edgeCat.map((p) => renderCat(p, 'edgeCat'))}
      {edgeNum.length === 0 && edgeCat.length === 0 && (
        <Typography sx={{ font: MONO_SMALL, color: 'text.secondary', mt: 0.5 }}>
          No edge properties in this graph.
        </Typography>
      )}

      <Box
        component="button"
        onClick={() => onChange({})}
        disabled={!active}
        sx={{
          width: '100%',
          mt: 1.5,
          font: MONO_SMALL,
          letterSpacing: 1.5,
          textTransform: 'uppercase',
          padding: '4px 0',
          color: active ? '#aadfff' : 'rgba(170,223,255,0.3)',
          background: 'transparent',
          border: '1px solid rgba(127, 212, 255, 0.45)',
          borderRadius: '6px',
          cursor: active ? 'pointer' : 'default',
          '&:hover': active ? { borderColor: '#7fd4ff' } : {},
        }}
      >
        ✕ clear filters
      </Box>
    </>
  )
}
